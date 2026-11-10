"""Parity with the stage-1 BatteryWeave JS engine, plus REST API behaviour.

Parity reference values were produced by running the stage-1 engine (now frontend/src/simulator/model/engine.js)
(evaluate() and maxSafeCurrent() on OPTIONS A/B/C with default parameters) under Node 22.
They are outputs of the prototype's model, not measurements.
"""
import copy

import pytest

approx = pytest.approx

JS_REFERENCE = {
    "A - Baseline": {"usable_energy_wh": 204.8, "charge_time_cc_estimate_h": 1.4, "peak_cell_temp_charge_c": 39.05773633016358,
                     "module_mass_kg": 2.3, "module_volume_l": 2.6, "relative_cost_index": 5.0, "max_safe_charge_current_a": 15.4048},
    "B - Fast charge + spreader": {"usable_energy_wh": 204.8, "charge_time_cc_estimate_h": 0.7, "peak_cell_temp_charge_c": 42.63231556422748,
                                   "module_mass_kg": 2.62, "module_volume_l": 2.86, "relative_cost_index": 5.6, "max_safe_charge_current_a": 20.0},
    "C - Parallel 4S2P": {"usable_energy_wh": 409.6, "charge_time_cc_estimate_h": 1.4, "peak_cell_temp_charge_c": 39.05773633016358,
                          "module_mass_kg": 4.3, "module_volume_l": 5.2, "relative_cost_index": 9.0, "max_safe_charge_current_a": 25.0},
}
JS_CHECKS = {"A - Baseline": {"EL-01": "PASS", "TH-01": "PASS", "PR-01": "PASS", "PR-02": "PASS", "SE-01": "PASS"},
             "B - Fast charge + spreader": {"EL-01": "WARN", "TH-01": "PASS", "PR-01": "PASS", "PR-02": "PASS", "SE-01": "PASS"},
             "C - Parallel 4S2P": {"EL-01": "PASS", "TH-01": "PASS", "PR-01": "PASS", "PR-02": "PASS", "SE-01": "PASS"}}


def test_parity_with_stage1_prototype(client, samples):
    r = client.post("/api/v1/designs/compare", json=samples("compare_abc.json"))
    assert r.status_code == 200
    for d in r.json()["designs"]:
        ref = JS_REFERENCE[d["design_name"]]
        for k, x in ref.items():
            assert d["kpis"][k] == approx(x, abs=2e-3), (d["design_name"], k)
        checks = {c["id"]: c["status"] for c in d["modules"]["bms"]["values"]["checks"]}
        for cid, st in JS_CHECKS[d["design_name"]].items():
            assert checks[cid] == st, (d["design_name"], cid)


def test_results_are_labelled_estimates(client, samples):
    j = client.post("/api/v1/designs/evaluate", json=samples("evaluate_baseline.json")).json()
    assert j["result_type"] == "ESTIMATE"
    assert "not measured" in j["disclaimer"]
    assert j["modules"]["thermal"]["model"]["label"].startswith("SIMPLIFIED")
    assert j["modules"]["ageing"]["model"]["label"].startswith("SIMPLIFIED")
    assert any(f["code"] == "ILLUSTRATIVE_CELL" for f in j["flags"])
    assert "certification" in j["modules"]["bms"]["values"]["safety_disclaimer"]


def test_health_models_metrics(client):
    assert client.get("/health").json()["status"] == "ok"
    models = client.get("/api/v1/models").json()
    assert all(m["equations"] and m["assumptions"] for m in models)
    assert "usable_energy_wh" in client.get("/api/v1/metrics").json()


def test_cell_crud(client):
    from .conftest import SYNTHETIC_CELL
    ids = [c["id"] for c in client.get("/api/v1/cells").json()]
    assert ids == ["EXAMPLE-LFP-20AH"]
    assert client.post("/api/v1/cells", json=SYNTHETIC_CELL).status_code == 201
    assert client.post("/api/v1/cells", json=SYNTHETIC_CELL).status_code == 409
    assert client.get("/api/v1/cells/TEST-SYNTHETIC").json()["capacity_ah"] == 10
    assert client.delete("/api/v1/cells/TEST-SYNTHETIC").status_code == 204
    assert client.get("/api/v1/cells/TEST-SYNTHETIC").status_code == 404
    assert client.delete("/api/v1/cells/EXAMPLE-LFP-20AH").status_code == 409  # seed protected


def test_validation_error_format(client, samples):
    bad = copy.deepcopy(samples("evaluate_baseline.json"))
    bad["series"] = 0
    r = client.post("/api/v1/designs/evaluate", json=bad)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"][0]["loc"][-1] == "series"


def test_datasheet_cell_requires_reference(client):
    from .conftest import SYNTHETIC_CELL
    r = client.post("/api/v1/cells", json={**SYNTHETIC_CELL, "id": "X1", "data_status": "datasheet"})
    assert r.status_code == 422


def test_unknown_cell_404(client, samples):
    d = samples("evaluate_baseline.json")
    d["cell_id"] = "NOPE"
    r = client.post("/api/v1/designs/evaluate", json=d)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("path", ["configuration", "energy", "estimates", "thermal", "simulate/charge",
                                  "simulate/discharge", "ageing", "bms", "mechanical", "cost"])
def test_module_endpoints(client, samples, path):
    r = client.post(f"/api/v1/{path}", json=samples("evaluate_baseline.json"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result_type"] == "ESTIMATE" and body["model"]["equations"]


def test_variation_endpoint(client, samples):
    r = client.post("/api/v1/variation", json=samples("variation.json"))
    assert r.status_code == 200
    assert r.json()["values"]["worst_cell_temp_charge_c"]["p95"] >= r.json()["values"]["worst_cell_temp_charge_c"]["p5"]


def test_compare_duplicate_names_rejected(client, samples):
    req = samples("compare_abc.json")
    req["alternatives"][0]["name"] = req["baseline"]["name"]
    r = client.post("/api/v1/designs/compare", json=req)
    assert r.status_code == 422 and r.json()["error"]["code"] == "engine_input_error"


def test_inline_cell_and_both_cell_sources_rejected(client, samples):
    from .conftest import SYNTHETIC_CELL
    d = samples("evaluate_baseline.json")
    d["cell"] = SYNTHETIC_CELL
    assert client.post("/api/v1/designs/evaluate", json=d).status_code == 422  # both cell_id and cell
    d.pop("cell_id")
    assert client.post("/api/v1/designs/evaluate", json=d).status_code == 200
