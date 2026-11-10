"""Projects API, grounding verifier and AI endpoints (AI calls are stubbed: no network)."""
import json

import pytest

from app.ai.grounding import verify
from app.ai.llm import LLMClient
from app.ai.requirements_parser import parse_requirements


class StubLLM(LLMClient):
    def __init__(self, reply: str, configured: bool = True):
        super().__init__("stub-key" if configured else None, "stub-model", provider="stub")
        self.reply = reply
        self.last_messages = None

    def chat(self, messages, **kw):
        if not self.configured:
            return super().chat(messages, **kw)  # raises AIUnavailable like the real client
        self.last_messages = messages
        return self.reply


# ---------------------------------------------------------------- projects
def test_project_crud(client, samples):
    a = samples("evaluate_baseline.json")
    r = client.post("/api/v1/projects", json={"name": "Solar module", "application": "stationary storage", "designs": [a]})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert client.get("/api/v1/projects").json()[0]["design_count"] == 1
    draft = {"name": "Draft without cell", "series": 4, "parallel": 1}  # drafts may be incomplete
    r = client.put(f"/api/v1/projects/{pid}", json={"name": "Solar module v2", "designs": [a, draft]})
    assert r.status_code == 200 and r.json()["name"] == "Solar module v2"
    assert len(client.get(f"/api/v1/projects/{pid}").json()["designs"]) == 2
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 204
    assert client.get(f"/api/v1/projects/{pid}").status_code == 404


def test_project_rejects_duplicate_design_names(client):
    r = client.post("/api/v1/projects", json={"name": "P", "designs": [{"name": "A"}, {"name": "A"}]})
    assert r.status_code == 422


# ---------------------------------------------------------------- grounding
def test_grounding_accepts_context_numbers_and_rounding():
    ctx = {"kpis": {"peak_cell_temp_charge_c": 42.632, "charge_time_cc_estimate_h": 0.7}, "checks": [{"id": "TH-01"}]}
    g = verify("TH-01 passes: peak 42.6 °C after 42 min (0.7 h) for the 4S1P design.", ctx)
    assert g["passed"], g


def test_grounding_flags_invented_numbers():
    ctx = {"kpis": {"peak_cell_temp_charge_c": 42.632}}
    g = verify("Peak is 42.6 °C and the cycle life will be 3500 cycles.", ctx)
    assert g["ungrounded_numbers"] == ["3500"] and not g["passed"]


# ---------------------------------------------------------------- AI endpoints
def test_ai_status_and_unconfigured(client):
    client.app.state.llm = StubLLM("", configured=False)
    assert client.get("/api/v1/ai/status").json()["configured"] is False
    r = client.post("/api/v1/ai/explain", json={"question": "why?", "context_type": "design",
                                                "design": {"name": "x", "cell_id": "EXAMPLE-LFP-20AH", "series": 4, "parallel": 1}})
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"


def test_ai_explain_uses_server_computed_context(client, samples):
    stub = StubLLM("TH-01 passes with an estimated peak of 39.06 °C; this is a model estimate.")
    client.app.state.llm = stub
    r = client.post("/api/v1/ai/explain", json={"question": "Does it overheat?", "context_type": "design",
                                                "design": samples("evaluate_baseline.json")})
    assert r.status_code == 200
    body = r.json()
    assert body["grounding"]["passed"] is True
    ctx = json.loads(stub.last_messages[1]["content"].split("\n", 1)[1])
    assert ctx["kpis"]["peak_cell_temp_charge_c"] == pytest.approx(39.058, abs=1e-3)  # engine value, not client-supplied


def test_ai_explain_comparison_context(client, samples):
    client.app.state.llm = StubLLM("B ranks first.")
    r = client.post("/api/v1/ai/explain", json={"question": "Which is best?", "context_type": "comparison",
                                                "comparison": samples("compare_abc.json")})
    assert r.status_code == 200 and r.json()["answer"] == "B ranks first."


def test_extract_requirements_validates_ai_output(client):
    reply = json.dumps({"requirements": [
        {"metric": "usable_energy_wh", "operator": ">=", "value": 200, "source_text": "at least 200 Wh"},
        {"metric": "module_mass_kg", "operator": "<=", "value": 2.5, "source_text": "invented"},      # 2.5 not in text
        {"metric": "made_up_metric", "operator": "<=", "value": 3, "source_text": "x"}], "unmapped": []})
    client.app.state.llm = StubLLM(reply)
    r = client.post("/api/v1/ai/extract-requirements", json={"text": "Store at least 200 Wh, weigh under 3 kg"})
    body = r.json()
    assert [q["metric"] for q in body["requirements"]] == ["usable_energy_wh"]
    assert {x["reason"].split(" ")[0] for x in body["rejected"]} == {"value", "unknown"}


def test_extract_requirements_rule_based_fallback(client):
    client.app.state.llm = StubLLM("", configured=False)
    body = client.post("/api/v1/ai/extract-requirements",
                       json={"text": "Must store at least 0.2 kWh, weigh under 3 kg and charge within 45 minutes."}).json()
    assert body["source"] == "rule_based_parser"
    got = {q["metric"]: q["value"] for q in body["requirements"]}
    assert got == {"usable_energy_wh": 200, "module_mass_kg": 3, "charge_time_cc_estimate_h": 0.75}


def test_parser_matches_prototype_patterns():
    out = parse_requirements("keep cells under 45 C")
    assert out[0]["metric"] == "peak_cell_temp_charge_c" and out[0]["confidence"] == "needs engineer"
