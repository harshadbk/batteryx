"""Energy and power calculations (closed form, nominal-voltage basis).

Equations:
  E_nom        = V_pack,nom · Q_pack                                     [Wh]
  w            = (SOC_max − SOC_min) / 100                               usable window fraction
  E_usable     = E_nom · w                                               [Wh]
  R_total      = S·R0/P + R_interconnect                                 [Ω]
  Discharge at current I:  P_term = V_nom·I − I²·R_total                 [W]
  Discharge at power P:    I = (V_nom − √(V_nom² − 4·R_total·P)) / (2·R_total)   (lower root)
  Ohmic loss  = I²·R_total ;  η_ohmic = 1 − I·R_total / V_nom
  Charge input power at I:  P_in = V_nom·I + I²·R_total
  C-rate       = I / Q_pack
"""
from __future__ import annotations

import math

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, r0_ohm, resistance_type_flag, rnd

MODEL = ModelInfo(
    id="energy.nominal", version="1.0.0", fidelity="closed_form",
    label="Nominal-voltage energy and ohmic power estimate",
    equations=["E_nom = V_nom·Q", "E_usable = E_nom·(SOC_max−SOC_min)/100", "P = V_nom·I − I²R",
               "I(P) = (V − √(V²−4RP))/(2R)", "η = 1 − I·R/V_nom"],
    assumptions=["OCV taken as nominal voltage over the whole SOC window (OCV–SOC curve ignored).",
                 "Resistance constant with SOC and temperature.",
                 "Usable energy excludes conversion losses; see the time-domain simulation for rate-dependent energy."],
)


def energy(cell: CellSpec, d: DesignInput, interconnect_ohm: float = 0.0) -> ModuleResult:
    f = Flags("energy")
    resistance_type_flag(cell, f)
    S, P, op = d.series, d.parallel, d.operating
    v_nom = S * cell.nominal_voltage_v
    q = P * cell.capacity_ah
    e_nom = v_nom * q
    w = (op.soc_max_pct - op.soc_min_pct) / 100.0
    r0 = r0_ohm(cell)
    r_tot = None if r0 is None else S * r0 / P + interconnect_ohm

    v = {
        "nominal_energy_wh": rnd(e_nom, 3),
        "usable_soc_window_pct": rnd(w * 100, 2),
        "usable_energy_wh": rnd(e_nom * w, 3),
        "usable_capacity_ah": rnd(q * w, 4),
        "pack_resistance_total_ohm": rnd(r_tot, 6),
        "interconnect_resistance_ohm": rnd(interconnect_ohm, 6),
    }
    if op.soc_min_pct == 0 and op.soc_max_pct == 100:
        f.assume("FULL_SOC_WINDOW", "Usable window is 0–100 % SOC (default). Set soc_min_pct/soc_max_pct to reflect the intended depth of discharge.", "operating.soc_min_pct")

    # charge
    if op.charge_current_a is not None:
        i = op.charge_current_a
        v["charge_current_a"] = i
        v["charge_c_rate"] = rnd(i / q, 4)
        v["charge_current_per_cell_a"] = rnd(i / P, 4)
        if r_tot is not None:
            v["charge_input_power_w"] = rnd(v_nom * i + i * i * r_tot, 3)
            v["charge_ohmic_loss_w"] = rnd(i * i * r_tot, 4)
    else:
        f.missing("operating.charge_current_a", "charge power and C-rate")

    # discharge
    i_dis = op.discharge_current_a
    if op.discharge_power_w is not None:
        p = op.discharge_power_w
        v["discharge_power_request_w"] = p
        if r_tot is None:
            i_dis = p / v_nom
            f.assume("I_FROM_P_NO_R", "Resistance missing: discharge current estimated as P / V_nom (no ohmic drop).")
        else:
            disc = v_nom ** 2 - 4 * r_tot * p
            if disc < 0:
                f.add("unsupported", "POWER_NOT_DELIVERABLE",
                      f"Requested {p} W exceeds the maximum transferable power V²/(4R) = {v_nom**2/(4*r_tot):.1f} W at nominal voltage.",
                      "operating.discharge_power_w")
                i_dis = None
            else:
                i_dis = (v_nom - math.sqrt(disc)) / (2 * r_tot)
    if i_dis is not None:
        v["discharge_current_a"] = rnd(i_dis, 4)
        v["discharge_c_rate"] = rnd(i_dis / q, 4)
        v["discharge_current_per_cell_a"] = rnd(i_dis / P, 4)
        if r_tot is not None:
            v["discharge_terminal_power_w"] = rnd(v_nom * i_dis - i_dis ** 2 * r_tot, 3)
            v["discharge_ohmic_loss_w"] = rnd(i_dis ** 2 * r_tot, 4)
            v["discharge_ohmic_efficiency_pct"] = rnd(100 * (1 - i_dis * r_tot / v_nom), 3)
        else:
            v["discharge_terminal_power_w"] = rnd(v_nom * i_dis, 3)
            f.missing("cell.internal_resistance_mohm", "ohmic loss and efficiency")
    elif op.discharge_power_w is None:
        f.missing("operating.discharge_current_a", "discharge power and C-rate (or give discharge_power_w)")

    if cell.max_discharge_c_rate is not None:
        i_max = q * cell.max_discharge_c_rate
        v["max_discharge_current_cell_limited_a"] = rnd(i_max, 3)
        v["max_discharge_power_cell_limited_w"] = rnd(v_nom * i_max - (i_max ** 2 * r_tot if r_tot else 0), 2)
    return ModuleResult(module="energy", model=MODEL, values=v, flags=f.items)
