"""Verification of the time-domain ECM simulation against analytical solutions and conservation laws."""
import math

import pytest

from app.engine.electrical import CellModel, run_simulation, simulate
from app.engine.thermal import ThermalParams, temp_at
from app.schemas.cell import CellSpec

from .conftest import SYNTHETIC_CELL, make_design

approx = pytest.approx


def linear_model(r1=0.0, c1=0.0):
    return CellModel(q_ah=10, r0=0.01, r1=r1, c1=c1, ocv=lambda s: 2.6 + 0.8 * s, v_max=3.5, v_min=2.5, has_ocv_curve=True)


def test_initial_terminal_voltage_is_ocv_minus_ir():
    res = simulate("discharge", linear_model(), 1, 1, soc_start=0.9, soc_stop=0.1, current_pack_a=10)
    assert res["timeseries"]["cell_voltage_v"][0] == approx(2.6 + 0.8 * 0.9 - 10 * 0.01, abs=1e-4)


def test_cc_discharge_duration_matches_coulomb_counting():
    res = simulate("discharge", linear_model(), 1, 1, soc_start=0.9, soc_stop=0.1, current_pack_a=10)
    assert res["end_reason"] == "soc_window_limit"
    assert res["duration_h"] == approx(0.8 * 10 / 10, abs=2 / 3600)


def test_discharge_energy_balance():
    """Chemical energy released = terminal energy delivered + losses (conservation)."""
    m = linear_model()
    res = simulate("discharge", m, 2, 1, soc_start=0.9, soc_stop=0.1, current_pack_a=10)
    e_chem = 2 * 10 * 0.8 * 3.0  # S · Q · ΔSOC · mean OCV (linear OCV, mean over 0.1..0.9 = 3.0 V)
    assert res["terminal_energy_wh"] + res["ohmic_and_polarisation_loss_wh"] == approx(e_chem, rel=2e-3)


def test_rc_branch_reaches_analytical_value():
    r1, c1 = 0.005, 2000.0  # τ1 = 10 s
    res = simulate("discharge", linear_model(r1, c1), 1, 1, soc_start=0.9, soc_stop=0.1, current_pack_a=10, output_points=5000)
    ts = res["timeseries"]
    k = next(i for i, t in enumerate(ts["time_s"]) if t >= 50)  # 5 τ
    ocv = 2.6 + 0.8 * ts["soc_pct"][k] / 100
    v1 = ocv - 10 * 0.01 - ts["cell_voltage_v"][k]
    assert v1 == approx(10 * r1 * (1 - math.exp(-ts["time_s"][k] / 10)), abs=2e-4)


def test_cc_cv_charge_respects_vmax_and_terminates():
    m = linear_model()
    m.v_max = 3.3
    res = simulate("charge", m, 1, 1, soc_start=0.2, soc_stop=1.0, current_pack_a=10, cv_cutoff_cell_a=0.5)
    assert res["end_reason"] == "cv_current_cutoff"
    assert res["cell_voltage_max_v"] <= 3.3 + 1e-6
    assert res["cv_duration_h"] > 0
    # CV starts when OCV + I·R0 = V_max  →  2.6 + 0.8·SOC + 0.1 = 3.3  →  SOC = 0.75
    assert res["cc_duration_h"] == approx((0.75 - 0.2) * 10 / 10, abs=2 / 3600)
    # CV ends when |I| = (V_max − OCV)/R0 ≤ 0.5 A  →  OCV ≥ 3.295  →  SOC ≥ 0.86875
    assert res["soc_end_pct"] == approx(86.875, abs=0.05)


def test_constant_power_discharge_holds_power():
    res = simulate("discharge", linear_model(), 4, 1, soc_start=0.9, soc_stop=0.1, power_pack_w=100)
    powers = res["timeseries"]["pack_power_w"]
    assert min(powers) == approx(100, rel=1e-6) and max(powers) == approx(100, rel=1e-6)


def test_coupled_thermal_matches_closed_form_for_constant_heat():
    tp = ThermalParams(r_th=6, m_eff=0.45, cp=1000)
    m = CellModel(q_ah=20, r0=0.008, r1=0, c1=0, ocv=lambda s: 3.2, v_max=None, v_min=None, has_ocv_curve=False)
    res = simulate("charge", m, 4, 1, soc_start=0.2, soc_stop=0.9, current_pack_a=10, tp=tp, ambient_c=35)
    expected = temp_at(35, 10 ** 2 * 0.008, tp, 1.4 * 3600)
    assert res["cell_temp_peak_c"] == approx(expected, abs=0.01)


def test_no_ocv_curve_flags_cv_unsupported():
    raw = {**SYNTHETIC_CELL, "ocv_curve": None}
    r = run_simulation("charge", CellSpec.model_validate(raw), make_design())
    assert any(f.code == "NO_OCV_CURVE" for f in r.flags)
    assert r.values["cv_duration_h"] == 0


def test_missing_resistance_means_no_simulation():
    raw = {**SYNTHETIC_CELL, "internal_resistance_mohm": None}
    r = run_simulation("discharge", CellSpec.model_validate(raw), make_design())
    assert "end_reason" not in r.values
    assert any(f.code == "SIM_NOT_RUN" for f in r.flags)


def test_simulation_is_repeatable(cell):
    d = make_design()
    a = run_simulation("charge", cell, d).values
    b = run_simulation("charge", cell, d).values
    assert a == b
