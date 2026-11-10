"""Mechanical mass and dimension estimates (closed form).

Layout: rectangular grid, rows × cols (default one row per series group, P cells per row).
Cell footprint: cylindrical d × d ; prismatic/pouch width(thickness) × length.
  L_env = cols·f_x + (cols−1)·gap + 2·wall
  W_env = rows·f_y + (rows−1)·gap + 2·wall
  H_env = h_cell + top_clearance + 2·wall
  V_env = L·W·H ;  packing efficiency = N·V_cell / V_env
Fallback when dimensions are missing (stage-1 prototype basis):
  V_module = N · V_cell · packing_factor · cooling_volume_factor
Busbars (series links only; parallel collectors excluded):
  I_design = max(charge, discharge current) ;  A = I_design / J_allow   [mm²]
  L_link = cell pitch between rows (f_y + gap) ;  R_link = ρ·L/A ;  m_link = ρ_m·A·L
  R_interconnect = (S − 1)·R_link
Mass:  m = N·(m_cell + m_cooling) + N·m_interconnect + m_busbar + m_housing + m_BMS
"""
from __future__ import annotations

import math

from app.schemas.cell import CellSpec, FormFactor
from app.schemas.design import DesignInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import MATERIALS, Flags, rnd

MODEL = ModelInfo(
    id="mechanical.grid_envelope", version="1.0.0", fidelity="closed_form",
    label="Rectangular-grid envelope, mass roll-up and busbar sizing",
    equations=["L = cols·f_x + (cols−1)·gap + 2·wall", "W = rows·f_y + (rows−1)·gap + 2·wall", "H = h + clearance + 2·wall",
               "V = N·V_cell·k_pack (fallback)", "A_busbar = I/J", "R = ρL/A", "m = Σ components"],
    assumptions=["Rectangular grid, no honeycomb nesting; housing modelled as uniform walls.",
                 "Busbars: series links between adjacent rows only; parallel collectors, terminals and wiring excluded.",
                 "Material properties at 20 °C; busbar temperature rise not checked."],
)


def mechanical(cell: CellSpec, d: DesignInput) -> ModuleResult:
    f = Flags("mechanical")
    mc = d.mechanical
    S, P = d.series, d.parallel
    n = S * P
    rows = mc.arrangement_rows or S
    cols = math.ceil(n / rows)
    v: dict = {"cell_count": n, "grid_rows": rows, "grid_cols": cols}
    if mc.arrangement_rows and rows * cols != n:
        f.add("info", "GRID_NOT_FULL", f"{rows}×{cols} grid has {rows*cols - n} empty positions.")

    # footprint
    fx = fy = h = None
    dm = cell.dimensions
    if dm and cell.form_factor == FormFactor.CYLINDRICAL and dm.diameter_mm and dm.height_mm:
        fx = fy = dm.diameter_mm; h = dm.height_mm
    elif dm and cell.form_factor in (FormFactor.PRISMATIC, FormFactor.POUCH) and dm.length_mm and dm.width_mm and dm.height_mm:
        fx, fy, h = dm.width_mm, dm.length_mm, dm.height_mm

    gap = mc.cell_gap_mm
    wall = mc.wall_thickness_mm
    clear = mc.top_clearance_mm
    vol_factor = d.thermal.cooling.added_volume_factor
    if fx is not None:
        if gap is None:
            gap = 0.0; f.assume("GAP_ZERO", "cell_gap_mm not given: cells assumed touching (0 mm).", "mechanical.cell_gap_mm")
        if wall is None:
            wall = 0.0; f.assume("WALL_ZERO", "wall_thickness_mm not given: envelope is the bare cell block (no housing).", "mechanical.wall_thickness_mm")
        if clear is None:
            clear = 0.0; f.assume("CLEARANCE_ZERO", "top_clearance_mm not given: no space allowed for busbars/BMS above cells.", "mechanical.top_clearance_mm")
        L = cols * fx + (cols - 1) * gap + 2 * wall
        W = rows * fy + (rows - 1) * gap + 2 * wall
        H = h + clear + 2 * wall
        vol_l = L * W * H / 1e6
        v.update({"envelope_length_mm": rnd(L, 2), "envelope_width_mm": rnd(W, 2), "envelope_height_mm": rnd(H, 2),
                  "envelope_volume_l": rnd(vol_l, 4), "volume_basis": "envelope_from_dimensions"})
        if cell.volume_l:
            v["packing_efficiency_pct"] = rnd(100 * n * cell.volume_l / vol_l, 2)
        if vol_factor != 1.0:
            f.add("info", "COOLING_VOLUME_FACTOR_IGNORED", "added_volume_factor is only used in the fallback volume estimate; model cooling hardware via gap/clearance instead.")
    elif cell.volume_l is not None:
        k = mc.volume_packing_factor
        if k is None:
            f.missing("mechanical.volume_packing_factor", "module volume (cell dimensions also missing)")
        else:
            vol_l = n * cell.volume_l * k * vol_factor
            v.update({"module_volume_l": rnd(vol_l, 4), "volume_basis": "cell_volume_x_packing_factor"})
            f.add("unsupported", "NO_CELL_DIMENSIONS", "Cell dimensions missing: envelope L×W×H not calculated; volume uses cell volume × packing factor (assumption).", "cell.dimensions")
    else:
        f.missing("cell.dimensions (or cell.volume_l)", "module dimensions and volume")

    # busbars
    r_ic = 0.0
    busbar_mass = 0.0
    if mc.busbar is not None:
        i_design = max(d.operating.charge_current_a or 0, d.operating.discharge_current_a or 0)
        if i_design == 0 and d.operating.discharge_power_w:
            i_design = d.operating.discharge_power_w / (S * cell.nominal_voltage_v)
            f.assume("BUSBAR_I_FROM_P", "Busbar design current estimated as P / V_nom.")
        if i_design == 0:
            f.missing("operating.charge_current_a / discharge_current_a", "busbar sizing")
        elif fy is None:
            f.add("unsupported", "BUSBAR_NO_PITCH", "Cell dimensions missing: busbar length (cell pitch) unknown, busbar not sized.", "cell.dimensions")
        else:
            mat = MATERIALS[mc.busbar.material.value]
            area_mm2 = i_design / mc.busbar.current_density_a_per_mm2
            pitch_m = (fy + (gap or 0)) / 1000
            links = S - 1
            r_link = mat["resistivity_ohm_m"] * pitch_m / (area_mm2 * 1e-6)
            m_link = mat["density_kg_m3"] * area_mm2 * 1e-6 * pitch_m
            r_ic = links * r_link
            busbar_mass = links * m_link
            v["busbar"] = {"material": mc.busbar.material.value, "design_current_a": rnd(i_design, 3),
                           "cross_section_mm2": rnd(area_mm2, 3), "width_mm": rnd(area_mm2 / mc.busbar.thickness_mm, 3),
                           "series_links": links, "link_length_mm": rnd(pitch_m * 1000, 2),
                           "resistance_total_ohm": rnd(r_ic, 7), "mass_kg": rnd(busbar_mass, 5),
                           "loss_at_design_current_w": rnd(i_design ** 2 * r_ic, 4)}
    v["interconnect_resistance_ohm"] = rnd(r_ic, 7)

    # mass roll-up
    parts: dict[str, float | None] = {}
    if cell.mass_kg is None:
        f.missing("cell.mass_kg", "module mass")
        parts["cells_kg"] = None
    else:
        parts["cells_kg"] = n * cell.mass_kg
    parts["cooling_kg"] = n * d.thermal.cooling.added_mass_per_cell_kg
    parts["interconnect_fixings_kg"] = None if mc.interconnect_mass_per_cell_kg is None else n * mc.interconnect_mass_per_cell_kg
    parts["busbars_kg"] = busbar_mass if mc.busbar is not None else None
    parts["housing_kg"] = mc.housing_mass_kg
    parts["bms_kg"] = mc.bms_mass_kg
    excluded = [k for k, x in parts.items() if x is None]
    v["mass_breakdown_kg"] = {k: rnd(x, 4) for k, x in parts.items()}
    if parts["cells_kg"] is not None:
        total = sum(x for x in parts.values() if x is not None)
        v["module_mass_kg"] = rnd(total, 4)
        v["mass_excludes"] = excluded
        if excluded:
            f.add("warning", "MASS_INCOMPLETE", f"Module mass excludes: {', '.join(excluded)} (not provided).")
    return ModuleResult(module="mechanical", model=MODEL, values=v, flags=f.items)
