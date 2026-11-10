"""BMS rule checks, variation sweep and comparison engine."""
import pytest

from app.engine.bms import bms, max_safe_charge_current
from app.engine.comparison import ComparisonError, compare
from app.engine.energy import energy
from app.engine.estimates import estimates
from app.engine.thermal import temp_at, thermal_params
from app.engine.common import Flags
from app.engine.variation import variation
from app.schemas.design import VariationInput

from .conftest import make_design

approx = pytest.approx


def run_bms(cell, d):
    est = estimates(cell, d, energy(cell, d).values).values
    return bms(cell, d, est, {}, {}).values


def status(v, cid):
    return next(c for c in v["checks"] if c["id"] == cid)["status"]


def test_all_pass_for_conservative_design(cell):
    v = run_bms(cell, make_design())
    for cid in ("EL-01", "EL-02", "TH-01", "TH-03", "PR-01", "PR-02", "PR-03", "PR-04", "PR-05", "SE-01", "SE-02"):
        assert status(v, cid) == "PASS", cid


def test_overcurrent_and_sensor_failures(cell):
    d = make_design(operating={"charge_current_a": 35}, limits={"temp_sensors_fitted": 1})
    v = run_bms(cell, d)
    assert status(v, "PR-01") == "FAIL"   # 35 A > 30 A fuse
    assert status(v, "PR-02") == "FAIL"   # > 20 A BMS
    assert status(v, "EL-01") == "FAIL"   # 1.75C > 1C
    assert status(v, "SE-01") == "FAIL"   # 1 < ceil(8/2)


def test_warn_thresholds(cell):
    v = run_bms(cell, make_design(operating={"charge_current_a": 19}))
    assert status(v, "EL-01") == "WARN"   # 0.95C > 0.9 × 1C
    assert status(v, "PR-02") == "WARN"   # 19 > 0.9 × 20


def test_fuse_coordination_warning(cell):
    v = run_bms(cell, make_design(limits={"fuse_rating_a": 15}))
    assert status(v, "PR-04") == "WARN"   # fuse below BMS limits
    v2 = run_bms(cell, make_design(limits={"fuse_rating_a": 60}))
    assert status(v2, "PR-05") == "WARN"  # fuse above 40 A cell-group capability


def test_missing_limits_are_not_evaluated(cell):
    d = make_design(limits={"fuse_rating_a": None, "temp_sensors_fitted": None})
    v = run_bms(cell, d)
    assert status(v, "PR-01") == "NOT_EVALUATED"
    assert status(v, "SE-01") == "NOT_EVALUATED"


def test_max_safe_current_hits_temperature_limit(cell):
    # 41 °C ambient leaves only 2 K headroom to (45 − 2) °C, so temperature, not C-rate, binds.
    d = make_design(operating={"ambient_c": 41}, thermal={"cooling": {"type": "custom", "r_th_cell_to_ambient_k_per_w": 10}},
                    limits={"bms_max_charge_current_a": 100, "fuse_rating_a": 200})
    tp = thermal_params(cell, d, Flags("t"))
    i, binding = max_safe_charge_current(cell, d, tp, 45, 2)
    assert binding == ["peak temperature limit − margin"]
    assert i < 20  # below the 1C cell limit
    t_h = 0.6 / (i / 20)
    assert temp_at(41, (i / 2) ** 2 * 0.010, tp, t_h * 3600) == approx(43.0, abs=1e-4)


def test_variation_zero_tolerance_equals_deterministic(cell):
    d = make_design()
    v = variation(cell, d, VariationInput(samples=50, capacity_tolerance_pct=0, resistance_tolerance_pct=0)).values
    assert v["usable_energy_wh"]["min"] == approx(192.0)
    assert v["usable_energy_wh"]["max"] == approx(192.0)
    assert v["max_cell_current_share_pct"]["max"] == approx(50.0)


def test_variation_seeded_repeatable(cell):
    d = make_design()
    vi = VariationInput(samples=200, capacity_tolerance_pct=3, resistance_tolerance_pct=15, seed=11)
    assert variation(cell, d, vi).values == variation(cell, d, vi).values
    assert variation(cell, d, vi).values["max_cell_current_share_pct"]["p50"] > 50.0


def test_comparison_excludes_failing_design(cell):
    a = make_design(name="A")
    b = make_design(name="B", operating={"charge_current_a": 35})  # fails protection
    c = make_design(name="C", parallel=1, role="alternative")
    out = compare([(a, cell), (b, cell), (c, cell)], None, None)
    rows = {r["design_name"]: r for r in out["ranking"]}
    assert rows["B"]["eligible"] is False
    assert out["recommendation"]["design_name"] != "B"
    assert rows["C"]["delta_vs_baseline"]["pack_capacity_ah"]["delta"] == approx(-10.0)


def test_comparison_input_validation(cell):
    a = make_design(name="A")
    with pytest.raises(ComparisonError):
        compare([(a, cell), (make_design(name="A"), cell)], None, None)
    with pytest.raises(ComparisonError):
        compare([(a, cell), (make_design(name="B"), cell)], None, {"not_a_metric": 1})
    with pytest.raises(ComparisonError):
        compare([(a, cell), (make_design(name="B"), cell)], None, {"charge_c_rate": 1})


def test_comparison_warns_with_single_alternative(cell):
    out = compare([(make_design(name="A"), cell), (make_design(name="B"), cell)], None, None)
    assert any("at least two design options" in n for n in out["notes"])
