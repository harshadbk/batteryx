"""Time-domain electrical simulation: 1-RC equivalent-circuit model (ECM) with CC-CV charge
and constant-current / constant-power discharge, coupled to the simplified lumped thermal node.

Sign convention: cell current I > 0 is discharge, I < 0 is charge. A representative cell is
simulated (all cells identical, current shared equally across P parallel cells).

Equations per time step Δt (exact zero-order-hold discretisation of the linear parts):
  SOC_{k+1} = SOC_k − I·Δt / (3600·Q_cell)
  V1_{k+1}  = V1·e^(−Δt/τ1) + R1·I·(1 − e^(−Δt/τ1)),  τ1 = R1·C1      (0 if R1/C1 not given)
  V_cell    = OCV(SOC) − I·R0 − V1
  q_cell    = I²·R0 + V1²/R1                                           [W]
  T_{k+1}   = T_amb + q·R_th + (T_k − T_amb − q·R_th)·e^(−Δt/τ_th)
  CV phase: I = (OCV − V1 − V_max) / R0   (holds V_cell = V_max), ends when |I| ≤ I_cutoff
  CP discharge: r_eff·I² − (OCV − V1)·I + P_cell = 0, r_eff = R0 + R_ic·P/S  →  lower root
  Pack: V_pack = S·V_cell − I_pack·R_ic ;  I_pack = P·I ;  P_pack = V_pack·I_pack
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Literal

import numpy as np

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, r0_ohm, rnd
from .thermal import ThermalParams, thermal_params

MODEL = ModelInfo(
    id="electrical.ecm_1rc", version="1.0.1", fidelity="simplified_time_domain",
    label="1-RC equivalent-circuit model with CC-CV charge, coupled lumped thermal node",
    equations=["SOC' = −I/(3600·Q)", "V1' = −V1/(R1C1) + I/C1", "V = OCV(SOC) − I·R0 − V1",
               "q = I²R0 + V1²/R1", "m·cp·T' = q − (T−T_amb)/R_th",
               "CV: I = (OCV − V1 − V_max)/R0", "CP: r_eff·I² − (OCV−V1)·I + P_cell = 0, r_eff = R0 + R_ic·P/S"],
    assumptions=["All cells identical; equal current sharing in parallel groups.",
                 "R0, R1, C1 constant with SOC, temperature and current direction.",
                 "OCV from the cell's OCV–SOC table (linear interpolation); hysteresis ignored.",
                 "100 % coulombic efficiency; no self-discharge.",
                 "Thermal: single lumped node per cell (see thermal model limitations)."],
)

EndReason = Literal["target_soc", "cv_current_cutoff", "min_voltage", "soc_window_limit", "max_duration", "power_not_deliverable"]


@dataclass
class CellModel:
    q_ah: float
    r0: float
    r1: float
    c1: float
    ocv: Callable[[float], float]
    v_max: float | None
    v_min: float | None
    has_ocv_curve: bool


def build_cell_model(cell: CellSpec, f: Flags, capacity_factor: float = 1.0, resistance_factor: float = 1.0) -> CellModel | None:
    r0 = r0_ohm(cell)
    if r0 is None:
        f.missing("cell.internal_resistance_mohm", "time-domain voltage, losses and heat")
        return None
    r1 = (cell.rc_r1_mohm or 0) / 1000.0
    c1 = cell.rc_c1_f or 0.0
    if not cell.rc_r1_mohm:
        f.assume("NO_RC_BRANCH", "R1/C1 not provided: polarisation (RC) dynamics omitted; model reduces to OCV − I·R0.", "cell.rc_r1_mohm")
    if cell.ocv_curve:
        socs = np.array([p.soc for p in cell.ocv_curve])
        vs = np.array([p.ocv_v for p in cell.ocv_curve])
        if socs[0] > 0 or socs[-1] < 1:
            f.add("warning", "OCV_EXTRAPOLATED", "OCV table does not span 0–1 SOC; end values are held constant outside the table.", "cell.ocv_curve")

        def ocv(s: float) -> float:
            return float(np.interp(s, socs, vs))
        has = True
    else:
        vn = cell.nominal_voltage_v

        def ocv(s: float) -> float:
            return vn
        has = False
        f.add("unsupported", "NO_OCV_CURVE",
              "OCV–SOC table not provided: OCV held at nominal voltage. The CV charge phase and voltage-based "
              "cut-offs are NOT modelled; voltage traces only show the ohmic offset.", "cell.ocv_curve")
    return CellModel(q_ah=cell.capacity_ah * capacity_factor, r0=r0 * resistance_factor, r1=r1 * resistance_factor, c1=c1,
                     ocv=ocv, v_max=cell.max_voltage_v if has else None, v_min=cell.min_voltage_v if has else None,
                     has_ocv_curve=has)


def simulate(mode: Literal["charge", "discharge"], m: CellModel, S: int, P: int, *,
             soc_start: float, soc_stop: float, current_pack_a: float | None = None, power_pack_w: float | None = None,
             cv_cutoff_cell_a: float | None = None, tp: ThermalParams | None = None, ambient_c: float | None = None,
             r_interconnect: float = 0.0, dt: float = 1.0, max_duration_h: float = 24.0, output_points: int = 200) -> dict:
    """Run one charge or discharge. Returns summary + downsampled time series (numpy-free JSON)."""
    n_max = int(max_duration_h * 3600 / dt) + 1
    t_arr = np.empty(n_max); soc_a = np.empty(n_max); v_a = np.empty(n_max); i_a = np.empty(n_max)
    q_a = np.empty(n_max); temp_a = np.empty(n_max); phase_a = np.zeros(n_max, dtype=np.int8)

    soc, v1 = soc_start, 0.0
    temp = ambient_c if ambient_c is not None else float("nan")
    use_thermal = tp is not None and ambient_c is not None
    a1 = math.exp(-dt / (m.r1 * m.c1)) if m.r1 > 0 and m.c1 > 0 else 0.0
    b_th = math.exp(-dt / tp.tau_s) if use_thermal else 0.0
    cv = False
    reason: EndReason = "max_duration"
    t_cv_start = None
    k = 0
    for k in range(n_max):
        ocv = m.ocv(soc)
        if mode == "charge":
            i = -current_pack_a / P
            if m.v_max is not None:
                if not cv and ocv - i * m.r0 - v1 >= m.v_max:
                    cv, t_cv_start = True, k * dt
                if cv:
                    i = min((ocv - v1 - m.v_max) / m.r0, 0.0)
        else:
            if power_pack_w is not None:
                # pack terminal power P = S·P·I·(OCV − V1 − I·r_eff) with r_eff = R0 + R_ic·P/S (interconnect share per cell)
                p_cell = power_pack_w / (S * P)
                r_eff = m.r0 + r_interconnect * P / S
                e = ocv - v1
                disc = e * e - 4 * r_eff * p_cell
                if disc < 0:
                    reason = "power_not_deliverable"
                    break
                i = (e - math.sqrt(disc)) / (2 * r_eff)
            else:
                i = current_pack_a / P
        v_cell = ocv - i * m.r0 - v1
        q = i * i * m.r0 + (v1 * v1 / m.r1 if m.r1 > 0 else 0.0)
        t_arr[k], soc_a[k], v_a[k], i_a[k], q_a[k], temp_a[k], phase_a[k] = k * dt, soc, v_cell, i, q, temp, 1 if cv else 0

        # stop conditions evaluated on the current state
        if mode == "charge":
            if soc >= soc_stop:
                reason = "target_soc"; break
            if cv and cv_cutoff_cell_a is not None and abs(i) <= cv_cutoff_cell_a:
                reason = "cv_current_cutoff"; break
        else:
            if m.v_min is not None and v_cell <= m.v_min:
                reason = "min_voltage"; break
            if soc <= soc_stop:
                reason = "soc_window_limit"; break
        # advance
        soc -= i * dt / (3600.0 * m.q_ah)
        v1 = v1 * a1 + m.r1 * i * (1 - a1) if a1 > 0 else 0.0
        if use_thermal:
            tss = ambient_c + q * tp.r_th
            temp = tss + (temp - tss) * b_th
    n = k + 1 if reason != "power_not_deliverable" else k
    if n == 0:
        return {"end_reason": reason, "duration_h": 0.0, "points": 0}
    t_arr, soc_a, v_a, i_a, q_a, temp_a, phase_a = (x[:n] for x in (t_arr, soc_a, v_a, i_a, q_a, temp_a, phase_a))

    i_pack = i_a * P
    v_pack = S * v_a - i_pack * r_interconnect
    p_pack = v_pack * i_pack  # >0 delivered (discharge), <0 absorbed (charge)
    q_pack = S * P * q_a + i_pack ** 2 * r_interconnect
    hrs = dt / 3600.0
    e_term = float(np.sum(np.abs(p_pack)) * hrs)
    e_loss = float(np.sum(q_pack) * hrs)
    e_chem = float(np.sum(S * P * np.abs(i_a * np.array([m.ocv(s) for s in soc_a]))) * hrs)

    out = {
        "end_reason": reason,
        "duration_h": rnd(n * dt / 3600, 5),
        "soc_start_pct": rnd(soc_start * 100, 3),
        "soc_end_pct": rnd(float(soc_a[-1]) * 100, 3),
        "ah_throughput_pack": rnd(float(np.sum(np.abs(i_pack)) * hrs), 4),
        "terminal_energy_wh": rnd(e_term, 3),
        "ohmic_and_polarisation_loss_wh": rnd(e_loss, 4),
        "cell_voltage_min_v": rnd(float(v_a.min()), 4),
        "cell_voltage_max_v": rnd(float(v_a.max()), 4),
        "pack_voltage_min_v": rnd(float(v_pack.min()), 4),
        "pack_voltage_max_v": rnd(float(v_pack.max()), 4),
        "pack_current_max_a": rnd(float(np.abs(i_pack).max()), 4),
        "pack_power_peak_w": rnd(float(np.abs(p_pack).max()), 3),
        "pack_heat_peak_w": rnd(float(q_pack.max()), 4),
    }
    if mode == "discharge":
        out["efficiency_pct"] = rnd(100 * e_term / e_chem if e_chem else None, 3)
    else:
        out["efficiency_pct"] = rnd(100 * e_chem / e_term if e_term else None, 3)
        out["cc_duration_h"] = rnd((t_cv_start if t_cv_start is not None else n * dt) / 3600, 5)
        out["cv_duration_h"] = rnd(((n * dt) - t_cv_start) / 3600 if t_cv_start is not None else 0.0, 5)
    if use_thermal:
        out["cell_temp_peak_c"] = rnd(float(np.nanmax(temp_a)), 3)
        out["cell_temp_end_c"] = rnd(float(temp_a[-1]), 3)
    idx = np.unique(np.linspace(0, n - 1, min(output_points, n)).astype(int))
    out["timeseries"] = {
        "time_s": [rnd(x, 2) for x in t_arr[idx]],
        "soc_pct": [rnd(x * 100, 3) for x in soc_a[idx]],
        "cell_voltage_v": [rnd(x, 4) for x in v_a[idx]],
        "pack_voltage_v": [rnd(x, 4) for x in v_pack[idx]],
        "pack_current_a": [rnd(x, 4) for x in i_pack[idx]],
        "pack_power_w": [rnd(x, 3) for x in p_pack[idx]],
        "pack_heat_w": [rnd(x, 4) for x in q_pack[idx]],
        "cell_temp_c": [rnd(x, 3) for x in temp_a[idx]] if use_thermal else None,
        "phase": ["CV" if x else ("CC" if mode == "charge" else ("CP" if power_pack_w else "CC")) for x in phase_a[idx]],
    }
    return out


def run_simulation(mode: Literal["charge", "discharge"], cell: CellSpec, d: DesignInput, r_interconnect: float = 0.0,
                   capacity_factor: float = 1.0, resistance_factor: float = 1.0) -> ModuleResult:
    f = Flags(f"{mode}_simulation")
    m = build_cell_model(cell, f, capacity_factor, resistance_factor)
    op = d.operating
    v: dict = {"mode": mode}
    if capacity_factor != 1.0 or resistance_factor != 1.0:
        v["aged_state"] = {"capacity_factor": rnd(capacity_factor, 4), "resistance_factor": rnd(resistance_factor, 4)}
    if m is None:
        f.add("unsupported", "SIM_NOT_RUN", f"{mode} simulation not run (missing inputs).")
        return ModuleResult(module=f"{mode}_simulation", model=MODEL, values=v, flags=f.items)

    tf = Flags("thermal")
    tp = thermal_params(cell, d, tf)
    if tp is None:
        f.add("warning", "SIM_NO_THERMAL", "Thermal inputs incomplete: simulation runs without temperature output.")
    sim = d.simulation
    kw = dict(tp=tp, ambient_c=op.ambient_c, r_interconnect=r_interconnect, dt=sim.time_step_s,
              max_duration_h=sim.max_duration_h, output_points=sim.output_points)
    if mode == "charge":
        if op.charge_current_a is None:
            f.missing("operating.charge_current_a", "charge simulation")
            return ModuleResult(module="charge_simulation", model=MODEL, values=v, flags=f.items)
        start = (op.charge_start_soc_pct if op.charge_start_soc_pct is not None else op.soc_min_pct) / 100
        target = (op.charge_target_soc_pct if op.charge_target_soc_pct is not None else op.soc_max_pct) / 100
        cutoff_c = op.cv_cutoff_c_rate
        if cutoff_c is None and m.v_max is not None:
            cutoff_c = 0.05
            f.assume("CV_CUTOFF_DEFAULT", "CV termination current not given: 0.05C assumed (common practice; use the datasheet value).", "operating.cv_cutoff_c_rate")
        if m.v_max is None and cell.max_voltage_v is None:
            f.missing("cell.max_voltage_v", "CV charge phase")
        res = simulate("charge", m, d.series, d.parallel, soc_start=start, soc_stop=target,
                       current_pack_a=op.charge_current_a,
                       cv_cutoff_cell_a=None if cutoff_c is None else cutoff_c * m.q_ah, **kw)
    else:
        if op.discharge_current_a is None and op.discharge_power_w is None:
            f.missing("operating.discharge_current_a", "discharge simulation")
            return ModuleResult(module="discharge_simulation", model=MODEL, values=v, flags=f.items)
        res = simulate("discharge", m, d.series, d.parallel, soc_start=op.soc_max_pct / 100, soc_stop=op.soc_min_pct / 100,
                       current_pack_a=op.discharge_current_a, power_pack_w=op.discharge_power_w, **kw)
    if res["end_reason"] == "max_duration":
        f.add("warning", "MAX_DURATION_REACHED", f"Simulation stopped at max_duration_h = {sim.max_duration_h} h before its end condition.")
    if res["end_reason"] == "power_not_deliverable":
        f.add("unsupported", "POWER_NOT_DELIVERABLE", "Requested discharge power cannot be delivered by the cell model at this state.")
    v.update(res)
    return ModuleResult(module=f"{mode}_simulation", model=MODEL, values=v, flags=f.items)
