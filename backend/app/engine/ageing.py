"""SIMPLIFIED ageing ASSUMPTIONS. This is not a degradation model.

Methods:
  none               capacity_factor = 1, resistance_factor = 1
  linear_cycle_life  retention(N) = 1 − (1 − EOL/100) · N / N_life     (datasheet cycle life + EOL %)
                     resistance growth only if the user gives resistance_growth_pct_per_100_cycles
  user_rates         retention(N) = 1 − fade/100 · N/100 ;  R factor = 1 + growth/100 · N/100
Aged values: Q_aged = Q · retention ; R0_aged = R0 · R factor
Ignores calendar ageing, temperature, C-rate and depth-of-discharge dependence, knee points and
lithium plating. Use the results only to see how sensitive a design is to capacity or resistance change.
"""
from __future__ import annotations

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, r0_ohm, rnd
from .thermal import scenario, thermal_params

MODEL = ModelInfo(
    id="ageing.simplified_assumption", version="1.0.0", fidelity="simplified_assumption",
    label="SIMPLIFIED linear ageing assumption (not a degradation model)",
    equations=["retention = 1 − (1 − EOL)·N/N_life", "retention = 1 − fade·N/100", "R_factor = 1 + growth·N/100",
               "Q_aged = Q·retention", "R0_aged = R0·R_factor"],
    assumptions=["Linear fade with cycle count; real fade is non-linear and condition-dependent.",
                 "Datasheet cycle life applies only under the datasheet's own test conditions.",
                 "Calendar ageing, temperature, C-rate and DoD effects are not modelled."],
)


def ageing_factors(cell: CellSpec, d: DesignInput, f: Flags) -> tuple[float, float, bool]:
    """Returns (capacity_factor, resistance_factor, evaluated)."""
    a = d.ageing
    if a.method == "none":
        return 1.0, 1.0, False
    if a.cycles is None:
        f.missing("ageing.cycles", "aged-state estimate")
        return 1.0, 1.0, False
    n = a.cycles
    r_fac = 1.0
    if a.resistance_growth_pct_per_100_cycles is not None:
        r_fac = 1 + a.resistance_growth_pct_per_100_cycles / 100 * n / 100
    if a.method == "linear_cycle_life":
        if cell.cycle_life_cycles is None or cell.cycle_life_eol_capacity_pct is None:
            f.missing("cell.cycle_life_cycles / cell.cycle_life_eol_capacity_pct", "linear cycle-life ageing")
            return 1.0, 1.0, False
        ret = 1 - (1 - cell.cycle_life_eol_capacity_pct / 100) * n / cell.cycle_life_cycles
        if n > cell.cycle_life_cycles:
            f.add("warning", "BEYOND_RATED_LIFE", "Cycle count exceeds rated cycle life: linear extrapolation is unreliable.", "ageing.cycles")
        if cell.cycle_life_conditions:
            f.add("info", "CYCLE_LIFE_CONDITIONS", f"Datasheet cycle life conditions: {cell.cycle_life_conditions}")
        else:
            f.add("warning", "CYCLE_LIFE_CONDITIONS_UNKNOWN", "Datasheet cycle-life test conditions not recorded; applicability unknown.", "cell.cycle_life_conditions")
    else:
        if a.capacity_fade_pct_per_100_cycles is None:
            f.missing("ageing.capacity_fade_pct_per_100_cycles", "user-rate ageing")
            return 1.0, 1.0, False
        ret = 1 - a.capacity_fade_pct_per_100_cycles / 100 * n / 100
    if a.resistance_growth_pct_per_100_cycles is None:
        f.add("unsupported", "R_GROWTH_NOT_MODELLED", "Resistance growth not given: aged heat and voltage drop assume fresh-cell resistance.", "ageing.resistance_growth_pct_per_100_cycles")
    if ret <= 0:
        f.add("unsupported", "NON_PHYSICAL_RETENTION", "Linear assumption gives ≤ 0 % capacity; result clipped to 0.")
        ret = 0.0
    return ret, r_fac, True


def ageing(cell: CellSpec, d: DesignInput) -> ModuleResult:
    f = Flags("ageing")
    cap_f, r_f, ok = ageing_factors(cell, d, f)
    v: dict = {"method": d.ageing.method, "cycles": d.ageing.cycles, "evaluated": ok}
    if not ok:
        if d.ageing.method == "none":
            f.add("info", "AGEING_NOT_REQUESTED", "Ageing method 'none': fresh-cell values only.")
        return ModuleResult(module="ageing", model=MODEL, values=v, flags=f.items)
    S, P, op = d.series, d.parallel, d.operating
    q_fresh = P * cell.capacity_ah
    w = (op.soc_max_pct - op.soc_min_pct) / 100
    e_fresh = S * cell.nominal_voltage_v * q_fresh * w
    v.update({
        "capacity_retention_pct": rnd(cap_f * 100, 3),
        "resistance_factor": rnd(r_f, 4),
        "pack_capacity_fresh_ah": rnd(q_fresh, 4),
        "pack_capacity_aged_ah": rnd(q_fresh * cap_f, 4),
        "usable_energy_fresh_wh": rnd(e_fresh, 3),
        "usable_energy_aged_wh": rnd(e_fresh * cap_f, 3),
    })
    r0 = r0_ohm(cell)
    if r0 is not None:
        v["cell_resistance_aged_mohm"] = rnd(r0 * r_f * 1000, 4)
    if op.charge_current_a is not None and cap_f > 0:
        # Same pack current on a smaller capacity: higher C-rate, shorter CC time, more I²R heat if R grows.
        c_aged = op.charge_current_a / (q_fresh * cap_f)
        start = op.charge_start_soc_pct if op.charge_start_soc_pct is not None else op.soc_min_pct
        target = op.charge_target_soc_pct if op.charge_target_soc_pct is not None else op.soc_max_pct
        v["charge_c_rate_aged"] = rnd(c_aged, 4)
        v["charge_time_cc_aged_h"] = rnd((target - start) / 100 / c_aged, 5)
        tf = Flags("ageing")
        tp = thermal_params(cell, d, tf)
        if tp is not None and r0 is not None:
            aged_cell = cell.model_copy(update={"internal_resistance_mohm": cell.internal_resistance_mohm * r_f})
            lim = d.limits.max_cell_temp_charge_c if d.limits.max_cell_temp_charge_c is not None else cell.charge_temp_max_c
            v["charge_thermal_aged"] = scenario("charge_cc_aged", op.charge_current_a / P, v["charge_time_cc_aged_h"],
                                                aged_cell, tp, op.ambient_c, lim)
    return ModuleResult(module="ageing", model=MODEL, values=v, flags=f.items)
