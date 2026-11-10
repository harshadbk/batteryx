"""Verification of closed-form engineering calculations against hand calculations."""
import math

import pytest

from app.engine.ageing import ageing
from app.engine.configuration import configure
from app.engine.cost import cost
from app.engine.energy import energy
from app.engine.estimates import estimates
from app.engine.mechanical import mechanical
from app.engine.thermal import ThermalParams, cell_surface_area_m2, temp_at, thermal, time_to_limit_s
from app.schemas.cell import CellSpec

from .conftest import SYNTHETIC_CELL, make_design

approx = pytest.approx


# ---------------------------------------------------------------- configuration
def test_series_parallel_scaling(cell):
    v = configure(cell, 4, 2).values
    assert v["cell_count"] == 8
    assert v["pack_voltage_nominal_v"] == approx(12.0)      # 4 × 3.0
    assert v["pack_voltage_max_v"] == approx(14.0)          # 4 × 3.5
    assert v["pack_voltage_min_v"] == approx(10.0)
    assert v["pack_capacity_ah"] == approx(20.0)            # 2 × 10
    assert v["pack_resistance_cells_ohm"] == approx(0.02)   # 4 × 0.010 / 2
    assert v["max_charge_current_cell_limited_a"] == approx(20.0)
    assert v["max_discharge_current_cell_limited_a"] == approx(40.0)


def test_missing_cell_fields_are_flagged_not_invented():
    raw = {k: SYNTHETIC_CELL[k] for k in ("id", "chemistry", "nominal_voltage_v", "capacity_ah", "data_status")}
    r = configure(CellSpec.model_validate(raw), 2, 1)
    assert r.values["pack_voltage_max_v"] is None
    assert r.values["pack_resistance_cells_ohm"] is None
    fields = {f.field for f in r.flags if f.severity == "missing_input"}
    assert {"cell.max_voltage_v", "cell.internal_resistance_mohm", "cell.max_charge_c_rate"} <= fields


def test_illustrative_cell_flagged():
    raw = {**SYNTHETIC_CELL, "data_status": "illustrative_example"}
    r = configure(CellSpec.model_validate(raw), 1, 1)
    assert any(f.code == "ILLUSTRATIVE_CELL" for f in r.flags)


def test_cell_validation_rules():
    with pytest.raises(ValueError):
        CellSpec.model_validate({**SYNTHETIC_CELL, "max_voltage_v": 2.9})
    with pytest.raises(ValueError):
        CellSpec.model_validate({**SYNTHETIC_CELL, "data_status": "datasheet", "datasheet_ref": None})
    with pytest.raises(ValueError):
        CellSpec.model_validate({**SYNTHETIC_CELL, "ocv_curve": [{"soc": 0.5, "ocv_v": 3}, {"soc": 0.2, "ocv_v": 3.1}]})


# ---------------------------------------------------------------- energy
def test_energy_nominal_and_usable(cell):
    v = energy(cell, make_design()).values
    assert v["nominal_energy_wh"] == approx(240.0)      # 12 V × 20 Ah
    assert v["usable_energy_wh"] == approx(192.0)       # × 0.8
    assert v["charge_c_rate"] == approx(0.5)
    assert v["discharge_terminal_power_w"] == approx(12 * 10 - 10 ** 2 * 0.02)   # 118 W
    assert v["discharge_ohmic_efficiency_pct"] == approx(100 * (1 - 10 * 0.02 / 12), abs=1e-3)


def test_constant_power_current_solves_quadratic(cell):
    d = make_design(operating={"discharge_current_a": None, "discharge_power_w": 200})
    v = energy(cell, d).values
    i, r = v["discharge_current_a"], 0.02
    assert 12 * i - i * i * r == approx(200, rel=1e-4)


def test_power_not_deliverable_flagged(cell):
    d = make_design(operating={"discharge_current_a": None, "discharge_power_w": 5000})  # > V²/4R = 1800 W
    r = energy(cell, d)
    assert any(f.code == "POWER_NOT_DELIVERABLE" for f in r.flags)
    assert "discharge_current_a" not in r.values


# ---------------------------------------------------------------- estimates
def test_charge_and_discharge_time_estimates(cell):
    d = make_design()
    en = energy(cell, d)
    v = estimates(cell, d, en.values).values
    assert v["charge_time_cc_h"] == approx((80 - 20) / 100 / 0.5)  # 1.2 h
    assert v["discharge_time_h"] == approx(20 * 0.8 / 10)          # 1.6 h


# ---------------------------------------------------------------- thermal
def test_lumped_thermal_closed_form():
    tp = ThermalParams(r_th=5, m_eff=0.5, cp=1000)
    assert tp.tau_s == approx(2500)
    assert temp_at(25, 2.0, tp, 1e9) == approx(35.0)                       # ΔT_ss = q·R
    assert temp_at(25, 2.0, tp, 2500) == approx(25 + 10 * (1 - math.exp(-1)))
    t = time_to_limit_s(25, 2.0, tp, 30)
    assert temp_at(25, 2.0, tp, t) == approx(30.0)
    assert time_to_limit_s(25, 2.0, tp, 40) is None  # steady state below limit


def test_thermal_module_values(cell):
    d = make_design()
    est = estimates(cell, d, energy(cell, d).values).values
    v = thermal(cell, d, est).values
    q = 5.0 ** 2 * 0.010  # per-cell current 5 A
    assert v["charge"]["heat_per_cell_w"] == approx(q)
    assert v["charge"]["peak_temp_c"] == approx(25 + q * 5 * (1 - math.exp(-1.2 * 3600 / 2500)), abs=1e-3)


def test_rth_from_convection_coefficient(cell):
    area = cell_surface_area_m2(cell)
    assert area == approx(2 * (0.1 * 0.02 + 0.1 * 0.1 + 0.02 * 0.1))
    d = make_design(thermal={"cooling": {"type": "natural_convection", "h_w_per_m2k": 10, "exposed_area_fraction": 0.5}})
    v = thermal(cell, d, {"charge_current_per_cell_a": 5, "charge_time_cc_h": 1}).values
    assert v["thermal_resistance_k_per_w"] == approx(1 / (10 * area * 0.5), rel=1e-3)


def test_thermal_missing_inputs_flagged(cell):
    d = make_design(thermal={"cooling": {"type": "custom"}})
    r = thermal(cell, d, {})
    assert any(f.code == "THERMAL_NOT_EVALUATED" for f in r.flags)
    assert "charge" not in r.values


# ---------------------------------------------------------------- ageing
def test_linear_cycle_life_ageing(cell):
    d = make_design(ageing={"method": "linear_cycle_life", "cycles": 1000})
    r = ageing(cell, d)
    assert r.values["capacity_retention_pct"] == approx(90.0)        # 1 − 0.2·1000/2000
    assert r.values["usable_energy_aged_wh"] == approx(192 * 0.9)
    assert r.model.label.startswith("SIMPLIFIED")
    assert any(f.code == "R_GROWTH_NOT_MODELLED" for f in r.flags)


def test_user_rate_ageing_and_beyond_life(cell):
    d = make_design(ageing={"method": "user_rates", "cycles": 500, "capacity_fade_pct_per_100_cycles": 1,
                            "resistance_growth_pct_per_100_cycles": 4})
    v = ageing(cell, d).values
    assert v["capacity_retention_pct"] == approx(95.0)
    assert v["resistance_factor"] == approx(1.2)
    d2 = make_design(ageing={"method": "linear_cycle_life", "cycles": 3000})
    assert any(f.code == "BEYOND_RATED_LIFE" for f in ageing(cell, d2).flags)


# ---------------------------------------------------------------- mechanical
def test_mechanical_envelope_and_mass(cell):
    d = make_design(mechanical={"cell_gap_mm": 2, "wall_thickness_mm": 3, "top_clearance_mm": 10,
                                "housing_mass_kg": 0.4, "bms_mass_kg": 0.1, "interconnect_mass_per_cell_kg": 0.01})
    v = mechanical(cell, d).values
    # 4 rows (series) × 2 cols; prismatic footprint x = width 20, y = length 100
    assert v["envelope_length_mm"] == approx(2 * 20 + 1 * 2 + 6)      # 48
    assert v["envelope_width_mm"] == approx(4 * 100 + 3 * 2 + 6)       # 412
    assert v["envelope_height_mm"] == approx(100 + 10 + 6)             # 116
    assert v["envelope_volume_l"] == approx(48 * 412 * 116 / 1e6, rel=1e-4)
    assert v["module_mass_kg"] == approx(8 * 0.5 + 8 * 0.01 + 0.4 + 0.1)
    assert v["mass_excludes"] == ["busbars_kg"]


def test_busbar_sizing(cell):
    d = make_design(mechanical={"cell_gap_mm": 0, "busbar": {"material": "copper", "current_density_a_per_mm2": 5, "thickness_mm": 1}})
    b = mechanical(cell, d).values["busbar"]
    assert b["cross_section_mm2"] == approx(2.0)                        # 10 A / 5 A/mm²
    r_link = 1.724e-8 * 0.1 / 2e-6
    assert b["resistance_total_ohm"] == approx(3 * r_link, rel=1e-4)
    assert b["mass_kg"] == approx(3 * 8960 * 2e-6 * 0.1, rel=1e-3)


def test_volume_fallback_without_dimensions():
    raw = {**SYNTHETIC_CELL}
    raw.pop("dimensions")
    c = CellSpec.model_validate(raw)
    d = make_design(mechanical={"volume_packing_factor": 1.3})
    r = mechanical(c, d)
    assert r.values["module_volume_l"] == approx(8 * 0.2 * 1.3)
    assert any(f.code == "NO_CELL_DIMENSIONS" for f in r.flags)


# ---------------------------------------------------------------- cost
def test_cost_rollup_and_relative_index(cell):
    d = make_design(cost={"currency": "XTS", "bms_cost": 20, "relative_bms_cost": 1.0},
                    thermal={"cooling": {"type": "custom", "r_th_cell_to_ambient_k_per_w": 5, "added_cost_per_cell": 1, "relative_cost_per_cell": 0.15}})
    v = cost(cell, d, 240).values
    assert v["estimated_cost"] == approx(8 * (10 + 1) + 20)
    assert v["cost_per_kwh_nominal"] == approx(108 / 0.24)
    assert set(v["cost_excludes"]) == {"housing", "other"}
    assert v["relative_cost_index"] == approx(8 * 1.15 + 1)


def test_cost_unknown_without_price():
    raw = {**SYNTHETIC_CELL, "unit_cost": None, "currency": None}
    r = cost(CellSpec.model_validate(raw), make_design(), 240)
    assert "estimated_cost" not in r.values
    assert any(f.field == "cost.cell_unit_cost" for f in r.flags)
