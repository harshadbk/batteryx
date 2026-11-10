"""SIMPLIFIED thermal estimation: one lumped thermal node per cell.

Model (each cell identical, no cell-to-cell conduction):
  m_eff · c_p · dT/dt = q − (T − T_amb) / R_th
  q        = I_cell² · R0                              [W]   irreversible ohmic heat
  m_eff    = m_cell + m_cooling,per cell               [kg]
  R_th     = given, or 1 / (h · A_exposed)             [K/W]
  τ        = m_eff · c_p · R_th                        [s]
  ΔT_ss    = q · R_th                                  [K]
  T(t)     = T_amb + ΔT_ss · (1 − e^(−t/τ))            constant q, starting at ambient
  t_limit  = −τ · ln(1 − (T_lim − T_amb)/ΔT_ss)        if ΔT_ss > T_lim − T_amb

This is a first-order screening estimate. It ignores reversible (entropic) heat, temperature
dependence of R0, temperature gradients inside a cell and the hotter centre cells of a module.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from app.schemas.cell import CellSpec, FormFactor
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, r0_ohm, rnd

MODEL = ModelInfo(
    id="thermal.lumped_single_node", version="1.0.0", fidelity="closed_form",
    label="SIMPLIFIED lumped single-node thermal model per cell",
    equations=["m·cp·dT/dt = q − (T−T_amb)/R_th", "q = I_cell²·R0", "τ = m·cp·R_th", "ΔT_ss = q·R_th",
               "T(t) = T_amb + ΔT_ss·(1 − e^(−t/τ))", "R_th = 1/(h·A_exposed)"],
    assumptions=["Each cell is one isothermal node; no cell-to-cell heat sharing, so centre/edge spread is not modelled.",
                 "Only irreversible I²R0 heat; entropic heat and RC polarisation heat excluded in the closed form.",
                 "R0 constant with temperature and SOC.",
                 "Cooling reduced to one lumped thermal resistance to ambient; ambient constant.",
                 "Cells start at ambient temperature."],
)


@dataclass
class ThermalParams:
    r_th: float  # K/W
    m_eff: float  # kg
    cp: float  # J/kgK

    @property
    def tau_s(self) -> float:
        return self.m_eff * self.cp * self.r_th


def cell_surface_area_m2(cell: CellSpec) -> float | None:
    dm = cell.dimensions
    if dm is None:
        return None
    if cell.form_factor == FormFactor.CYLINDRICAL and dm.diameter_mm and dm.height_mm:
        d, h = dm.diameter_mm / 1000, dm.height_mm / 1000
        return math.pi * d * h + 2 * math.pi * d * d / 4
    if cell.form_factor in (FormFactor.PRISMATIC, FormFactor.POUCH) and dm.length_mm and dm.width_mm and dm.height_mm:
        l, w, h = dm.length_mm / 1000, dm.width_mm / 1000, dm.height_mm / 1000
        return 2 * (l * w + l * h + w * h)
    return None


def thermal_params(cell: CellSpec, d: DesignInput, f: Flags) -> ThermalParams | None:
    c = d.thermal.cooling
    ok = True
    r_th = c.r_th_cell_to_ambient_k_per_w
    if r_th is None and c.h_w_per_m2k is not None:
        area = cell_surface_area_m2(cell)
        if area is None:
            f.add("unsupported", "R_TH_NO_AREA", "Convection coefficient given but cell dimensions/form factor missing, so surface area and R_th cannot be computed.", "cell.dimensions")
            ok = False
        else:
            frac = c.exposed_area_fraction
            if frac is None:
                frac = 1.0
                f.assume("FULL_AREA_EXPOSED", "exposed_area_fraction not given: whole cell surface assumed exposed to the coolant (optimistic for packed cells).", "thermal.cooling.exposed_area_fraction")
            r_th = 1.0 / (c.h_w_per_m2k * area * frac)
    elif r_th is None:
        f.missing("thermal.cooling.r_th_cell_to_ambient_k_per_w", "temperature estimates (or give h_w_per_m2k)")
        ok = False
    if cell.mass_kg is None:
        f.missing("cell.mass_kg", "thermal mass and temperature transient")
        ok = False
    cp = d.thermal.cell_specific_heat_j_per_kgk or cell.specific_heat_j_per_kgk
    if cp is None:
        f.missing("thermal.cell_specific_heat_j_per_kgk", "thermal mass and temperature transient")
        ok = False
    elif d.thermal.cell_specific_heat_j_per_kgk is not None and cell.specific_heat_j_per_kgk is None:
        f.assume("CP_USER", f"Cell specific heat {cp} J/kg·K is a design-level assumption, not from the cell datasheet.", "thermal.cell_specific_heat_j_per_kgk")
    if d.operating.ambient_c is None:
        f.missing("operating.ambient_c", "temperature estimates")
        ok = False
    if r0_ohm(cell) is None:
        f.missing("cell.internal_resistance_mohm", "heat generation")
        ok = False
    if not ok:
        return None
    return ThermalParams(r_th=r_th, m_eff=cell.mass_kg + c.added_mass_per_cell_kg, cp=cp)


def temp_at(ambient: float, q_w: float, tp: ThermalParams, t_s: float) -> float:
    return ambient + q_w * tp.r_th * (1 - math.exp(-t_s / tp.tau_s))


def time_to_limit_s(ambient: float, q_w: float, tp: ThermalParams, limit_c: float) -> float | None:
    dtss = q_w * tp.r_th
    head = limit_c - ambient
    if head <= 0:
        return 0.0
    if dtss <= head:
        return None  # never reaches the limit at constant heat
    return -tp.tau_s * math.log(1 - head / dtss)


def scenario(label: str, i_cell: float, duration_h: float | None, cell: CellSpec, tp: ThermalParams,
             ambient: float, limit_c: float | None) -> dict:
    q = i_cell ** 2 * r0_ohm(cell)
    out = {
        "scenario": label,
        "current_per_cell_a": rnd(i_cell, 4),
        "heat_per_cell_w": rnd(q, 5),
        "steady_state_rise_k": rnd(q * tp.r_th, 4),
        "steady_state_temp_c": rnd(ambient + q * tp.r_th, 3),
        "duration_h": rnd(duration_h, 4),
        "peak_temp_c": rnd(temp_at(ambient, q, tp, duration_h * 3600) if duration_h else None, 3),
    }
    if limit_c is not None:
        t = time_to_limit_s(ambient, q, tp, limit_c)
        out["limit_c"] = limit_c
        out["time_to_limit_min"] = None if t is None else rnd(t / 60, 2)
        out["reaches_limit_within_duration"] = bool(t is not None and duration_h and t <= duration_h * 3600)
    return out


def thermal(cell: CellSpec, d: DesignInput, estimates: dict) -> ModuleResult:
    f = Flags("thermal")
    tp = thermal_params(cell, d, f)
    v: dict = {"cooling_type": d.thermal.cooling.type.value}
    if tp is None:
        f.add("unsupported", "THERMAL_NOT_EVALUATED", "Thermal estimate not run because required inputs are missing.")
        return ModuleResult(module="thermal", model=MODEL, values=v, flags=f.items)
    amb = d.operating.ambient_c
    v.update({
        "thermal_resistance_k_per_w": rnd(tp.r_th, 4),
        "thermal_mass_per_cell_kg": rnd(tp.m_eff, 4),
        "specific_heat_j_per_kgk": tp.cp,
        "time_constant_min": rnd(tp.tau_s / 60, 3),
        "ambient_c": amb,
    })
    lim_c = d.limits.max_cell_temp_charge_c if d.limits.max_cell_temp_charge_c is not None else cell.charge_temp_max_c
    lim_d = d.limits.max_cell_temp_discharge_c if d.limits.max_cell_temp_discharge_c is not None else cell.discharge_temp_max_c
    if estimates.get("charge_current_per_cell_a") is not None:
        v["charge"] = scenario("charge_cc", estimates["charge_current_per_cell_a"], estimates.get("charge_time_cc_h"), cell, tp, amb, lim_c)
    if estimates.get("discharge_current_per_cell_a") is not None:
        v["discharge"] = scenario("discharge", estimates["discharge_current_per_cell_a"], estimates.get("discharge_time_h"), cell, tp, amb, lim_d)
    if "charge" not in v and "discharge" not in v:
        f.add("unsupported", "NO_LOAD_CASE", "No charge or discharge current available, so no heat load to evaluate.")
    return ModuleResult(module="thermal", model=MODEL, values=v, flags=f.items)
