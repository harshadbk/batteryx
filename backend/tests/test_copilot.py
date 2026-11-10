"""Claude copilot: tool loop against the real engine, structured answers, verification of incorrect
AI claims, repair loop, error/rate-limit handling and request shape. Claude itself is replaced by a
scripted fake SDK client (no network, no API key needed)."""
import json
from types import SimpleNamespace as NS

import anthropic
import httpx2
import pytest

from app.ai.claude_client import ClaudeClient

# ---------------------------------------------------------------- fake Claude
USAGE = NS(input_tokens=100, output_tokens=50, cache_read_input_tokens=0)


def tool_use(id_, name, inp):
    return NS(type="tool_use", id=id_, name=name, input=inp)


def final(obj):
    return NS(content=[NS(type="text", text=json.dumps(obj))], stop_reason="end_turn", usage=USAGE)


def calls(*blocks):
    return NS(content=list(blocks), stop_reason="tool_use", usage=USAGE)


def tool_results(kw) -> dict:
    """Map ref → result from every tool_result the backend sent so far."""
    out = {}
    for m in kw["messages"]:
        if m["role"] == "user" and isinstance(m["content"], list):
            for b in m["content"]:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    r = json.loads(b["content"])
                    out[r["ref"]] = r
    return out


class FakeSDK:
    def __init__(self, script):
        self.script = list(script)
        self.requests = []
        self.beta = NS(messages=NS(create=self._create))
        self.messages = NS(create=self._create)

    def _create(self, **kw):
        self.requests.append({**kw, "messages": list(kw["messages"])})  # snapshot, like the real SDK's serialisation
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step(kw) if callable(step) else step


def answer(**over):
    base = {"summary": "s", "answer_markdown": "Results are model estimates.", "claims": [], "recommendations": [],
            "candidate_designs": [], "assumptions": ["Thermal model is simplified."], "uncertainties": ["Illustrative cell data."],
            "missing_inputs": [], "report_sections": [], "safety_notice": "Estimates only; screening checks are not a certification."}
    return {**base, **over}


@pytest.fixture
def project(client, samples):
    ex = client.get("/api/v1/examples/designs").json()
    reqs = ex["designs"][0]["requirements"]
    designs = [{k: v for k, v in d.items() if k != "requirements"} for d in ex["designs"]]
    return client.post("/api/v1/projects", json={"name": "Copilot test", "application": "solar storage", "designs": designs, "requirements": reqs}).json()


def use(client, script, monkeypatch=None):
    sdk = FakeSDK(script)
    client.app.state.claude = ClaudeClient(sdk_client=sdk)
    return sdk


def chat(client, pid, mode="analyst", msg="Explain the thermal behaviour", focus="A - Baseline", conv=None):
    return client.post(f"/api/v1/copilot/projects/{pid}/chat", json={"mode": mode, "message": msg, "focus_design": focus, "conversation_id": conv})


# ---------------------------------------------------------------- happy paths
def test_analyst_turn_uses_real_engine_and_passes_verification(client, project):
    def grounded(kw):
        r = tool_results(kw)
        t = r["T1"]["values"]["cell_temp_peak_c"]
        return final(answer(
            answer_markdown=f"During charge the estimated peak cell temperature is {t} °C (T1); heat follows I²R.",
            claims=[{"statement": "Peak cell temperature during charge", "value": t, "unit": "°C", "source_ref": "T1", "basis": "engine_estimate"},
                    {"statement": "Heat scales with the square of current", "value": None, "unit": None, "source_ref": "none", "basis": "general_engineering_knowledge"}],
            recommendations=[{"action": "Validate thermal resistance by test", "rationale": "R_th is assumed", "priority": "high", "verified": True, "source_refs": ["T2"]}]))
    sdk = use(client, [calls(tool_use("a", "simulate", {"design_name": "A - Baseline", "changes": [], "label": None, "mode": "charge"}),
                             tool_use("b", "evaluate_design", {"design_name": "A - Baseline", "changes": [], "label": None})), grounded])
    r = chat(client, project["id"])
    assert r.status_code == 200, r.text
    t = r.json()["turn"]
    assert t["verification"]["passed"], t["verification"]
    assert [c["name"] for c in t["tool_calls"]] == ["simulate", "evaluate_design"]
    assert t["tool_results"]["T1"]["values"]["cell_temp_peak_c"] == pytest.approx(39.058, abs=1e-3)  # computed by the engine
    # both tool results were returned in ONE user message
    last_user = sdk.requests[1]["messages"][-1]
    assert last_user["role"] == "user" and len(last_user["content"]) == 2


def test_request_shape_model_tools_schema_cache_fallback(client, project):
    sdk = use(client, [final(answer())])
    chat(client, project["id"])
    kw = sdk.requests[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["betas"] == ["server-side-fallback-2026-07-01"] and kw["fallbacks"] == "default"
    assert kw["output_config"]["effort"] == "medium"
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["cache_control"] == {"type": "ephemeral"}
    assert all(t["strict"] for t in kw["tools"])
    assert "thinking" not in kw  # Opus 5.5: adaptive by default; disabling would 400
    assert "Never invent battery or cell specifications" in kw["system"][0]["text"]


def test_design_copilot_candidate_evaluated_by_engine(client, project):
    def propose(kw):
        r = tool_results(kw)
        e = r["T2"]["kpis"]["usable_energy_wh"]
        return final(answer(
            answer_markdown=f"Option 4S2P stores {e} Wh usable (T2).",
            claims=[{"statement": "Usable energy of 4S2P", "value": e, "unit": "Wh", "source_ref": "T2", "basis": "engine_estimate"}],
            candidate_designs=[{"name": "A + 4S2P", "base_design": "A - Baseline", "changes": [{"path": "parallel", "value": 2}], "evaluated_ref": "T2", "verdict": "meets energy"}]))
    use(client, [calls(tool_use("a", "list_cells", {"chemistry": "LFP"})),
                 calls(tool_use("b", "evaluate_design", {"design_name": "A - Baseline", "changes": [{"path": "parallel", "value": 2}], "label": "A + 4S2P"})),
                 propose])
    t = chat(client, project["id"], mode="design_copilot", msg="I need at least 400 Wh", focus=None).json()["turn"]
    assert t["verification"]["passed"], t["verification"]["issues"]
    assert t["tool_results"]["T2"]["kpis"]["usable_energy_wh"] == pytest.approx(409.6)
    assert t["tool_results"]["T1"]["cells"][0]["data_status"] == "illustrative_example"


def test_conversation_is_project_scoped_and_carries_history(client, project):
    sdk = use(client, [final(answer(summary="first")), final(answer(summary="second"))])
    r1 = chat(client, project["id"]).json()
    r2 = chat(client, project["id"], msg="And during discharge?", conv=r1["conversation_id"]).json()
    assert r1["conversation_id"] == r2["conversation_id"]
    msgs = sdk.requests[1]["messages"]
    assert msgs[0]["content"].startswith("[analyst] Explain the thermal behaviour") and '"first"' in msgs[1]["content"]
    convs = client.get(f"/api/v1/copilot/projects/{project['id']}/conversations").json()
    assert convs[0]["turn_count"] == 2
    other = client.post("/api/v1/projects", json={"name": "other"}).json()
    r = client.post(f"/api/v1/copilot/projects/{other['id']}/chat", json={"mode": "analyst", "message": "x", "conversation_id": r1["conversation_id"]})
    assert r.status_code == 409


# ---------------------------------------------------------------- incorrect AI claims are caught
EVAL_A = calls(tool_use("a", "evaluate_design", {"design_name": "A - Baseline", "changes": [], "label": None}))
BAD = {
    "invented_number": (answer(answer_markdown="The LFP cells will last 6000 cycles at this rate."), "ungrounded_number"),
    "value_mismatch": (answer(claims=[{"statement": "peak temp", "value": 41.7, "unit": "°C", "source_ref": "T1", "basis": "engine_estimate"}]), "value_mismatch"),
    "invalid_reference": (answer(claims=[{"statement": "x", "value": None, "unit": None, "source_ref": "T9", "basis": "engine_estimate"}]), "invalid_reference"),
    "unsourced_number": (answer(claims=[{"statement": "typical LFP specific energy", "value": 160, "unit": "Wh/kg", "source_ref": "none", "basis": "general_engineering_knowledge"}]), "unsourced_number"),
    "certification": (answer(answer_markdown="Design B is safe and complies with IEC 62619."), "certification_claim"),
    "measured": (answer(answer_markdown="The measured peak temperature confirms the design."), "measurement_claim"),
    "invented_cell": (answer(answer_markdown="Switch to the CATL-LF280K cell for more capacity."), "unknown_cell"),
    "invented_datasheet": (answer(answer_markdown="See the datasheet at https://example.com/lfp-ds.pdf for limits."), "unverified_reference"),
    "candidate_not_evaluated": (answer(candidate_designs=[{"name": "A 4S3P", "base_design": "A - Baseline", "changes": [{"path": "parallel", "value": 3}], "evaluated_ref": None, "verdict": "better"}]), "candidate_not_evaluated"),
    "candidate_wrong_inputs": (answer(candidate_designs=[{"name": "A 4S3P", "base_design": "A - Baseline", "changes": [{"path": "parallel", "value": 3}], "evaluated_ref": "T1", "verdict": "better"}]), "candidate_not_evaluated"),
}


@pytest.mark.parametrize("case", sorted(BAD))
def test_incorrect_claims_are_flagged(client, project, case):
    bad, issue = BAD[case]
    sdk = use(client, [EVAL_A, final(bad), final(bad)])  # the model repeats the mistake after the repair request
    t = chat(client, project["id"]).json()["turn"]
    v = t["verification"]
    assert not v["passed"]
    assert issue in {i["type"] for i in v["issues"]}, v["issues"]
    assert v["repair_rounds"] == 1
    repair_msg = sdk.requests[2]["messages"][-1]["content"]
    assert repair_msg.startswith("VERIFICATION FAILED") and issue in repair_msg


def test_negated_statements_are_not_flagged(client, project):
    ok = answer(answer_markdown="These are estimates, not measured values. This is not a certification and the design is not certified.")
    use(client, [final(ok)])
    assert chat(client, project["id"]).json()["turn"]["verification"]["passed"]


def test_repair_round_fixes_answer(client, project):
    def good(kw):
        t = tool_results(kw)["T1"]["kpis"]["peak_cell_temp_charge_c"]
        return final(answer(claims=[{"statement": "peak", "value": t, "unit": "°C", "source_ref": "T1", "basis": "engine_estimate"}]))
    use(client, [EVAL_A, final(BAD["value_mismatch"][0]), good])
    v = chat(client, project["id"]).json()["turn"]["verification"]
    assert v["passed"] and v["repair_rounds"] == 1


# ---------------------------------------------------------------- tool guardrails
def test_ai_cannot_set_assumptions_or_use_unknown_cells(client, project):
    use(client, [calls(tool_use("a", "evaluate_design", {"design_name": "A - Baseline", "changes": [{"path": "thermal.cooling.r_th_cell_to_ambient_k_per_w", "value": 1}], "label": None}),
                       tool_use("b", "evaluate_design", {"design_name": "A - Baseline", "changes": [{"path": "cell_id", "value": "MADE-UP-CELL-1"}], "label": None}),
                       tool_use("c", "evaluate_design", {"design_name": "Z", "changes": [], "label": None})),
                 final(answer())])
    tcs = chat(client, project["id"]).json()["turn"]["tool_calls"]
    assert [c["ok"] for c in tcs] == [False, False, False]
    assert "not allowed" in tcs[0]["error"] and "not found" in tcs[1]["error"] and "No project design" in tcs[2]["error"]


def test_copy_cooling_from_other_design(client, project):
    use(client, [calls(tool_use("a", "evaluate_design", {"design_name": "A - Baseline", "changes": [{"path": "copy_cooling_from", "value": "B - Fast charge + spreader"}], "label": "A+spreader"})),
                 final(answer())])
    r = chat(client, project["id"]).json()["turn"]["tool_results"]["T1"]
    assert r["design"]["r_th_cell_to_ambient_k_per_w"] == 3 and r["design"]["cooling"] == "heat_spreader"


# ---------------------------------------------------------------- failures and configuration
REQ = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


@pytest.mark.parametrize("exc,status,code", [
    (anthropic.RateLimitError("rate", response=httpx2.Response(429, request=REQ, headers={"retry-after": "7"}), body=None), 429, "ai_rate_limited"),
    (anthropic.AuthenticationError("bad key", response=httpx2.Response(401, request=REQ), body=None), 503, "ai_unavailable"),
    (anthropic.InternalServerError("overloaded", response=httpx2.Response(529, request=REQ), body=None), 502, "ai_provider_error"),
    (anthropic.APIConnectionError(request=REQ), 502, "ai_provider_error"),
])
def test_api_failures_map_to_clear_errors(client, project, exc, status, code):
    use(client, [exc])
    r = chat(client, project["id"])
    assert r.status_code == status and r.json()["error"]["code"] == code
    if code == "ai_rate_limited":
        assert r.json()["error"]["details"]["retry_after_s"] == "7"


def test_refusal_is_not_treated_as_answer(client, project):
    use(client, [NS(content=[], stop_reason="refusal", usage=USAGE, stop_details=NS(category="cyber"))])
    r = chat(client, project["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "ai_refused"


def test_unconfigured_without_key_and_status_hides_key(client, project, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    client.app.state.claude = ClaudeClient()
    s = client.get("/api/v1/copilot/status").json()
    assert s["configured"] is False and "key" not in json.dumps(s).lower().replace("api_key", "")
    r = chat(client, project["id"])
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["error"]["message"]


def test_report_mode_sections_with_refs(client, project):
    def rep(kw):
        e = tool_results(kw)["T1"]["kpis"]["usable_energy_wh"]
        return final(answer(report_sections=[{"title": "Executive summary", "body_markdown": f"Baseline usable energy is {e} Wh (estimate).", "source_refs": ["T1"]},
                                             {"title": "Limitations and next steps", "body_markdown": "Thermal model is simplified.", "source_refs": []}]))
    use(client, [EVAL_A, rep])
    t = chat(client, project["id"], mode="report", msg="Write the summary").json()["turn"]
    assert t["verification"]["passed"] and len(t["structured"]["report_sections"]) == 2
