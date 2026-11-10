"""Audit regressions (defects found in the project audit) and the end-to-end engineering workflow."""
import copy
import json
from types import SimpleNamespace as NS

import pytest

from app.ai.claude_client import ClaudeClient

from .conftest import SYNTHETIC_CELL
from .test_copilot import FakeSDK, answer, calls, final, tool_results, tool_use


# ---------------------------------------------------------------- audit regressions
def test_cell_used_by_a_design_cannot_be_deleted(client):
    client.post("/api/v1/cells", json=SYNTHETIC_CELL)
    p = client.post("/api/v1/projects", json={"name": "P", "designs": [{"name": "d", "cell_id": "TEST-SYNTHETIC", "series": 2, "parallel": 1}]}).json()
    r = client.delete("/api/v1/cells/TEST-SYNTHETIC")
    assert r.status_code == 409 and "P / d" in r.json()["error"]["message"]
    client.delete(f"/api/v1/projects/{p['id']}")
    assert client.delete("/api/v1/cells/TEST-SYNTHETIC").status_code == 204


def test_project_delete_removes_its_conversations(client):
    p = client.post("/api/v1/projects", json={"name": "P"}).json()
    client.app.state.conversations.create(p["id"], "t")
    client.delete(f"/api/v1/projects/{p['id']}")
    assert client.app.state.conversations.list(p["id"]) == []


def test_constant_power_discharge_delivers_requested_power_with_busbars(client):
    d = {"name": "cp", "cell": SYNTHETIC_CELL, "series": 4, "parallel": 2,
         "operating": {"soc_min_pct": 10, "soc_max_pct": 90, "discharge_power_w": 100},
         "mechanical": {"busbar": {"material": "copper", "current_density_a_per_mm2": 1, "thickness_mm": 0.2}}}
    v = client.post("/api/v1/simulate/discharge", json=d).json()["values"]
    r_ic = client.post("/api/v1/mechanical", json=d).json()["values"]["interconnect_resistance_ohm"]
    assert r_ic > 0
    assert all(p == pytest.approx(100, rel=1e-6) for p in v["timeseries"]["pack_power_w"])


@pytest.mark.parametrize("sim", [{"max_duration_h": 200, "time_step_s": 0.1}, {"max_duration_h": 120, "time_step_s": 1}])
def test_simulation_step_budget_is_enforced(client, sim):
    r = client.post("/api/v1/simulate/charge", json={"name": "x", "cell_id": "EXAMPLE-LFP-20AH", "series": 1, "parallel": 1, "simulation": sim})
    assert r.status_code == 422 and "400,000" in json.dumps(r.json())


def test_variation_size_is_enforced(client):
    d = {"name": "x", "cell_id": "EXAMPLE-LFP-20AH", "series": 32, "parallel": 16}
    r = client.post("/api/v1/variation", json={"design": d, "variation": {"samples": 20000, "capacity_tolerance_pct": 3, "resistance_tolerance_pct": 10}})
    assert r.status_code == 422


def test_ai_endpoints_are_rate_limited(client, monkeypatch):
    from app.ai.llm import LLMClient
    monkeypatch.setenv("BATTERYX_AI_RATE_PER_MIN", "2")
    client.app.state.__dict__.pop("ai_limiter", None)
    client.app.state.llm = LLMClient(None, "offline")  # rule-based parser: tests our limiter, not the provider's quota
    codes = [client.post("/api/v1/ai/extract-requirements", json={"text": "at least 200 Wh"}).status_code for _ in range(3)]
    assert codes[:2] == [200, 200] and codes[2] == 429


def test_evaluation_traces_inputs_and_models(client, samples):
    r = client.post("/api/v1/designs/evaluate", json=samples("evaluate_baseline.json")).json()
    assert r["inputs"]["thermal"]["cooling"]["r_th_cell_to_ambient_k_per_w"] == 6
    assert r["inputs"]["operating"]["charge_current_a"] == 10
    t = r["kpi_trace"]["peak_cell_temp_charge_c"]
    assert t["model_id"] == "electrical.ecm_1rc" and t["module"] == "charge_simulation"
    assert r["kpi_trace"]["module_mass_kg"]["model_id"] == "mechanical.grid_envelope"
    assert set(r["kpi_trace"]) == {k for k, v in r["kpis"].items() if v is not None}


# ---------------------------------------------------------------- end-to-end workflow
def test_full_engineering_workflow(client):
    # 1. create project
    p = client.post("/api/v1/projects", json={"name": "Workflow", "application": "12 V outdoor solar storage"}).json()
    pid = p["id"]
    # 2. requirements from text (rule-based path, no AI key needed in this test)
    client.app.state.llm.api_key = None
    reqs = client.post("/api/v1/ai/extract-requirements", json={"text": "store at least 200 Wh, weigh under 3 kg, charge within 1 hour"}).json()["requirements"]
    assert {q["metric"] for q in reqs} == {"usable_energy_wh", "module_mass_kg", "charge_time_cc_estimate_h"}
    # 3. configure battery: baseline + two alternatives
    ex = client.get("/api/v1/examples/designs").json()["designs"]
    designs = [{k: v for k, v in d.items() if k != "requirements"} for d in ex]
    p = client.put(f"/api/v1/projects/{pid}", json={"name": "Workflow", "application": p["application"], "designs": designs, "requirements": reqs}).json()
    A = dict(p["designs"][0], requirements=reqs)
    # 4. run simulation
    ch = client.post("/api/v1/simulate/charge", json=A).json()
    assert ch["values"]["end_reason"] == "target_soc" and ch["result_type"] == "ESTIMATE"
    # 5. identify safety warnings (B charges at the cell's maximum C-rate)
    B = dict(p["designs"][1], requirements=reqs)
    checks = {c["id"]: c for c in client.post("/api/v1/bms", json=B).json()["values"]["checks"]}
    assert checks["EL-01"]["status"] == "WARN" and checks["EL-01"]["limit_source"] == "cell datasheet"
    hot = copy.deepcopy(A); hot["operating"]["ambient_c"] = 44
    hot_checks = {c["id"]: c["status"] for c in client.post("/api/v1/bms", json=hot).json()["values"]["checks"]}
    assert hot_checks["TH-01"] in ("WARN", "FAIL")
    # 6. compare alternatives
    cmp = client.post("/api/v1/designs/compare", json={"baseline": A, "alternatives": [dict(d, requirements=reqs) for d in p["designs"][1:]]}).json()
    assert cmp["recommendation"]["design_name"] == "B - Fast charge + spreader"
    assert any("illustrative" in n for n in cmp["notes"])
    # 7. AI recommendation (Claude replaced by a scripted client; tools run the real engine; answer verified)
    def rec(kw):
        r = tool_results(kw)["T1"]
        name = r["recommendation"]["design_name"]
        return final(answer(answer_markdown=f"The engine recommends {name} (T1).",
                            recommendations=[{"action": f"Prototype {name} first", "rationale": "Best eligible score", "priority": "high", "verified": True, "source_refs": ["T1"]}]))
    sdk = FakeSDK([calls(tool_use("x", "compare_designs", {"baseline": {"design_name": "A - Baseline", "changes": [], "label": None},
                                                          "alternatives": [{"design_name": "B - Fast charge + spreader", "changes": [], "label": None},
                                                                           {"design_name": "C - Parallel 4S2P", "changes": [], "label": None}], "weights": []})), rec])
    client.app.state.claude = ClaudeClient(sdk_client=sdk)
    turn = client.post(f"/api/v1/copilot/projects/{pid}/chat", json={"mode": "optimizer", "message": "Which design?"}).json()["turn"]
    assert turn["verification"]["passed"] and turn["tool_results"]["T1"]["recommendation"]["design_name"] == cmp["recommendation"]["design_name"]
    # 8. report inputs: every value traceable to inputs, models, assumptions and sources
    ev = client.post("/api/v1/designs/evaluate", json=A).json()
    assert ev["cell"]["data_status"] == "illustrative_example"
    assert ev["inputs"] and ev["kpi_trace"] and any(f["severity"] == "assumption" for f in ev["flags"])
    models = {m["id"] for m in client.get("/api/v1/models").json()}
    assert {t["model_id"] for t in ev["kpi_trace"].values()} <= models
