"""Closed-form charging / discharging time estimates (quick view, same basis as stage-1 prototype).

Equations:
  C-rate_charge  = I_charge / Q_pack
  t_charge,CC    = (SOC_target − SOC_start)/100 / C-rate        [h]   CC phase only, CV tail ignored
  t_discharge    = Q_pack · w / I_discharge                     [h]   w = usable SOC window fraction
  (power mode)   = E_usable / P_discharge                       [h]
The time-domain simulation (electrical module) refines these with OCV, resistance and CC-CV.
"""
from __future__ import annotations

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, rnd

MODEL = ModelInfo(
    id="estimates.closed_form_time", version="1.0.0", fidelity="closed_form",
    label="Ideal coulomb-counting time estimates",
    equations=["t_charge = ΔSOC / C-rate", "t_discharge = Q·w / I", "t_discharge = E_usable / P"],
    assumptions=["Charge time covers the constant-current phase only; the constant-voltage tail is ignored.",
                 "100 % coulombic efficiency; capacity independent of rate and temperature."],
)


def estimates(cell: CellSpec, d: DesignInput, energy_values: dict) -> ModuleResult:
    f = Flags("estimates")
    op = d.operating
    q = d.parallel * cell.capacity_ah
    w = (op.soc_max_pct - op.soc_min_pct) / 100.0
    v: dict = {}
    start = op.charge_start_soc_pct if op.charge_start_soc_pct is not None else op.soc_min_pct
    target = op.charge_target_soc_pct if op.charge_target_soc_pct is not None else op.soc_max_pct
    if op.charge_start_soc_pct is None or op.charge_target_soc_pct is None:
        f.assume("CHARGE_WINDOW_DEFAULT", f"Charge window defaults to the usable SOC window ({start}–{target} %).", "operating.charge_start_soc_pct")
    if op.charge_current_a is not None:
        c = op.charge_current_a / q
        v.update({
            "charge_start_soc_pct": start, "charge_target_soc_pct": target,
            "charge_current_a": op.charge_current_a,
            "charge_current_per_cell_a": rnd(op.charge_current_a / d.parallel, 5),
            "charge_c_rate": rnd(c, 5),
            "charge_time_cc_h": rnd((target - start) / 100.0 / c, 5),
        })
        v["charge_time_cc_min"] = rnd(v["charge_time_cc_h"] * 60, 2)
    else:
        f.missing("operating.charge_current_a", "charge time")
    i_dis = energy_values.get("discharge_current_a")
    if i_dis:
        v["discharge_current_a"] = i_dis
        v["discharge_current_per_cell_a"] = rnd(i_dis / d.parallel, 5)
        if op.discharge_power_w is not None:
            v["discharge_time_h"] = rnd(energy_values["usable_energy_wh"] / op.discharge_power_w, 5)
            f.assume("RUNTIME_E_OVER_P", "Runtime at constant power = E_usable / P, ignoring ohmic losses.")
        else:
            v["discharge_time_h"] = rnd(q * w / i_dis, 5)
    else:
        f.missing("operating.discharge_current_a", "discharge time")
    return ModuleResult(module="estimates", model=MODEL, values=v, flags=f.items)
