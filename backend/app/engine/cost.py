"""Estimated cost (bill-of-materials roll-up) and relative cost index.

Currency estimate (only when a cell unit cost is known):
  C = N·(c_cell + c_cooling) + c_BMS + c_housing + c_other ;  C/kWh = C / (E_nom/1000)
Relative index (stage-1 prototype basis, always available):
  index = N·(1 + k_cooling) + k_BMS      (one cell = 1.0; NOT a price)
"""
from __future__ import annotations

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, rnd

MODEL = ModelInfo(
    id="cost.bom_rollup", version="1.0.0", fidelity="closed_form",
    label="Bill-of-materials cost roll-up and relative cost index",
    equations=["C = N·(c_cell + c_cool) + c_BMS + c_housing + c_other", "index = N·(1 + k_cool) + k_BMS"],
    assumptions=["Component prices are user inputs; no market prices are built in.",
                 "Assembly labour, testing, logistics, taxes and volume discounts excluded."],
)


def cost(cell: CellSpec, d: DesignInput, nominal_energy_wh: float) -> ModuleResult:
    f = Flags("cost")
    c = d.cost
    n = d.series * d.parallel
    cool = d.thermal.cooling
    v: dict = {}
    unit = c.cell_unit_cost if c.cell_unit_cost is not None else cell.unit_cost
    currency = c.currency or (cell.currency if c.cell_unit_cost is None else None)
    if c.cell_unit_cost is None and cell.unit_cost is not None and c.currency and cell.currency and c.currency != cell.currency:
        f.add("unsupported", "CURRENCY_MISMATCH", f"Cell cost is in {cell.currency} but design cost inputs are in {c.currency}; no conversion is performed.")
        unit = None
    if unit is None:
        f.missing("cost.cell_unit_cost", "currency cost estimate (relative index still given)")
    elif not currency:
        f.missing("cost.currency", "currency cost estimate")
        unit = None
    if unit is not None:
        parts = {"cells": n * unit, "cooling": n * cool.added_cost_per_cell,
                 "bms": c.bms_cost, "housing": c.housing_cost, "other": c.other_cost}
        excluded = [k for k, x in parts.items() if x is None]
        total = sum(x for x in parts.values() if x is not None)
        v.update({"currency": currency, "estimated_cost": rnd(total, 2),
                  "cost_breakdown": {k: rnd(x, 2) for k, x in parts.items()},
                  "cost_per_kwh_nominal": rnd(total / (nominal_energy_wh / 1000), 2), "cost_excludes": excluded})
        if excluded:
            f.add("warning", "COST_INCOMPLETE", f"Cost excludes: {', '.join(excluded)} (not provided).")
    k_bms = c.relative_bms_cost
    if k_bms is None:
        k_bms = 0.0
        f.assume("REL_BMS_ZERO", "relative_bms_cost not given: BMS excluded from the relative index.", "cost.relative_bms_cost")
    v["relative_cost_index"] = rnd(n * (1 + cool.relative_cost_per_cell) + k_bms, 4)
    v["relative_cost_index_note"] = "Relative index: one cell = 1.0. Not a price."
    return ModuleResult(module="cost", model=MODEL, values=v, flags=f.items)
