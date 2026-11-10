"""Series-parallel configuration calculator (closed form).

Equations (identical cells, ideal interconnect):
  N_cells        = S · P
  V_pack,nom     = S · V_cell,nom              [V]
  V_pack,max/min = S · V_cell,max/min          [V]
  Q_pack         = P · Q_cell                  [Ah]
  R_pack,cells   = S · R0 / P                  [Ω]   (cells only, interconnect excluded)
  I_pack,max     = P · Q_cell · C_max          [A]   (charge and discharge separately)
"""
from __future__ import annotations

from app.schemas.cell import CellSpec
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, cell_provenance_flags, r0_ohm, rnd

MODEL = ModelInfo(
    id="configuration.series_parallel", version="1.0.0", fidelity="closed_form",
    label="Ideal series-parallel scaling of identical cells",
    equations=["N = S·P", "V_pack = S·V_cell", "Q_pack = P·Q_cell", "R_pack = S·R0/P", "I_max = P·Q_cell·C_max"],
    assumptions=["All cells identical (cell-to-cell variation is handled separately in the variation module).",
                 "Interconnect resistance excluded here; see mechanical busbar estimate."],
)


def configure(cell: CellSpec, series: int, parallel: int) -> ModuleResult:
    f = Flags("configuration")
    cell_provenance_flags(cell, f)
    S, P = series, parallel
    r0 = r0_ohm(cell)

    def scale(x, k):
        return None if x is None else x * k

    v = {
        "topology": f"{S}S{P}P",
        "series": S,
        "parallel": P,
        "cell_count": S * P,
        "pack_voltage_nominal_v": rnd(S * cell.nominal_voltage_v),
        "pack_voltage_max_v": rnd(scale(cell.max_voltage_v, S)),
        "pack_voltage_min_v": rnd(scale(cell.min_voltage_v, S)),
        "pack_capacity_ah": rnd(P * cell.capacity_ah),
        "pack_resistance_cells_ohm": rnd(None if r0 is None else S * r0 / P, 6),
        "max_charge_current_cell_limited_a": rnd(None if cell.max_charge_c_rate is None else P * cell.capacity_ah * cell.max_charge_c_rate),
        "max_discharge_current_cell_limited_a": rnd(None if cell.max_discharge_c_rate is None else P * cell.capacity_ah * cell.max_discharge_c_rate),
    }
    if cell.max_voltage_v is None:
        f.missing("cell.max_voltage_v", "pack maximum (charge) voltage")
    if cell.min_voltage_v is None:
        f.missing("cell.min_voltage_v", "pack minimum (cut-off) voltage")
    if r0 is None:
        f.missing("cell.internal_resistance_mohm", "pack resistance, I²R heat and voltage drop")
    if cell.max_charge_c_rate is None:
        f.missing("cell.max_charge_c_rate", "cell-limited maximum charge current")
    if cell.max_discharge_c_rate is None:
        f.missing("cell.max_discharge_c_rate", "cell-limited maximum discharge current")
    return ModuleResult(module="configuration", model=MODEL, values=v, flags=f.items)
