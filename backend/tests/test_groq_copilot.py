"""Copilot on Groq: the OpenAI-compatible adapter runs the same tool loop and verifier (fake HTTP layer, no network)."""
import json

import pytest

from app.ai.groq_copilot import GroqCopilotClient
from app.ai.llm import LLMClient
from app.main import _copilot_client

from .test_copilot import answer, chat, project  # noqa: F401  (fixture reuse)


class FakeGroq(LLMClient):
    def __init__(self, script):
        super().__init__("test-key", "openai/gpt-oss-120b")
        self.script = list(script)
        self.bodies = []

    def post(self, body):
        self.bodies.append(json.loads(json.dumps(body)))
        step = self.script.pop(0)
        return step(body) if callable(step) else step


def resp(content=None, tool_calls=None, finish="stop"):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {"choices": [{"message": msg, "finish_reason": "tool_calls" if tool_calls else finish}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


def tc(id_, name, args):
    return {"id": id_, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def test_tool_loop_and_final_answer_through_groq(client, project):  # noqa: F811
    fake = FakeGroq([
        resp(tool_calls=[tc("c1", "get_project_designs", {})]),
        resp("```json\n" + json.dumps(answer()) + "\n```"),
    ])
    client.app.state.claude = GroqCopilotClient(fake)
    r = chat(client, project["id"])
    assert r.status_code == 200, r.text
    turn = r.json()["turn"]
    assert turn["model"] == "openai/gpt-oss-120b" and turn["tool_calls"][0]["name"] == "get_project_designs"
    assert turn["structured"]["summary"] == "s"
    second = fake.bodies[1]["messages"]
    assert second[0]["role"] == "system" and "FINAL ANSWER FORMAT" in second[0]["content"]
    assert any(m["role"] == "assistant" and m.get("tool_calls") for m in second)
    assert any(m["role"] == "tool" and m["tool_call_id"] == "c1" for m in second)
    assert fake.bodies[0]["tools"][0]["type"] == "function"


def test_missing_fields_filled_and_prose_repaired(client, project):  # noqa: F811
    partial = {"summary": "only summary", "answer_markdown": "Estimates.", "safety_notice": "Not a certification."}
    fake = FakeGroq([resp("Here is my answer without JSON."), resp(json.dumps(partial))])
    client.app.state.claude = GroqCopilotClient(fake)
    r = chat(client, project["id"])
    assert r.status_code == 200, r.text
    s = r.json()["turn"]["structured"]
    assert s["summary"] == "only summary" and s["claims"] == [] and s["report_sections"] == []
    assert fake.bodies[1]["response_format"] == {"type": "json_object"}


def test_status_reports_groq(client):
    client.app.state.claude = GroqCopilotClient(FakeGroq([]))
    s = client.get("/api/v1/copilot/status").json()
    assert s["configured"] is True and s["provider"] == "groq" and "test-key" not in json.dumps(s)


@pytest.mark.parametrize("env,anthropic,expect", [("auto", False, "groq"), ("auto", True, "anthropic"), ("groq", True, "groq"), ("anthropic", False, "anthropic")])
def test_provider_selection(monkeypatch, env, anthropic, expect):
    monkeypatch.setenv("BATTERYX_COPILOT_PROVIDER", env)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    if anthropic:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    else:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert _copilot_client(LLMClient("k", "m")).provider == expect


def test_mode_tools_and_forced_answer_after_max_rounds(client, project):  # noqa: F811
    rounds = [resp(tool_calls=[tc(f"c{i}", "get_project_designs", {})]) for i in range(4)]
    fake = FakeGroq(rounds + [resp(json.dumps(answer()))])
    client.app.state.claude = GroqCopilotClient(fake)
    r = chat(client, project["id"], mode="safety")
    assert r.status_code == 200, r.text
    names = {t["function"]["name"] for t in fake.bodies[0]["tools"]}
    assert names == {"get_project_designs", "safety_checks"}
    assert "tools" not in fake.bodies[4] and "Do not call more tools" in fake.bodies[4]["messages"][-1]["content"]


def test_nullable_args_filled_and_results_rounded(client, project):  # noqa: F811
    fake = FakeGroq([resp(tool_calls=[tc("c1", "safety_checks", {"design_name": "A - Baseline", "changes": []})]),
                     resp(json.dumps(answer()))])
    client.app.state.claude = GroqCopilotClient(fake)
    r = chat(client, project["id"], mode="safety")
    assert r.status_code == 200 and r.json()["turn"]["tool_calls"][0]["ok"] is True
    params = next(t["function"]["parameters"] for t in fake.bodies[0]["tools"] if t["function"]["name"] == "safety_checks")
    assert "label" not in params["required"]
    tool_msg = next(m for m in fake.bodies[1]["messages"] if m["role"] == "tool")["content"]
    import re
    assert not re.search(r"\d\.\d{6,}", tool_msg)


def test_tool_use_failed_is_retried_with_hint(client, project):  # noqa: F811
    from app.ai.llm import AIProviderError
    bad = AIProviderError("AI provider returned HTTP 400", '{"error":{"message":"Tool call validation failed: missing properties: \'mode\'","code":"tool_use_failed"}}')

    def fail(_):
        raise bad
    fake = FakeGroq([fail, resp(json.dumps(answer()))])
    client.app.state.claude = GroqCopilotClient(fake)
    r = chat(client, project["id"])
    assert r.status_code == 200, r.text
    assert "previous tool call was rejected" in fake.bodies[1]["messages"][-1]["content"]
