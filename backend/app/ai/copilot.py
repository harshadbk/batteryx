"""BatteryX engineering copilot on Claude: five capabilities over one tool-using loop.

Workflow per turn:  user request → Claude interprets → Claude calls engine/database tools → backend computes
→ Claude analyses tool results → structured JSON answer → deterministic verification against the
tool results → (one automatic repair round if verification fails) → stored in the project conversation.
"""
from __future__ import annotations

import json
import time
from typing import Any

from .claude_client import ClaudeClient, ClaudeProviderError
from .copilot_tools import TOOLS, ToolContext, result_json
from .verifier import verify_answer
from app.schemas.project import complete_requirements

MAX_TOOL_ROUNDS = 10
MAX_REPAIRS = 1
HISTORY_TURNS = 6

MODES = {
    "design_copilot": {
        "label": "AI Design Copilot",
        "instruction": (
            "Interpret the natural-language requirements: map each one to an engine metric and say which ones cannot be mapped. "
            "Choose cells ONLY from list_cells/get_cell results and report each chosen cell's data_status and missing fields. "
            "Propose up to three configurations as changes to an existing project design (the base supplies operating conditions and "
            "the user's thermal/mechanical assumptions; thermal values can only be copied from another project design). "
            "Evaluate every candidate with evaluate_design (or compare_designs) BEFORE presenting it, and return them in candidate_designs "
            "with evaluated_ref. Explain which requirement each candidate meets or misses."),
    },
    "analyst": {
        "label": "AI Engineering Analyst",
        "instruction": (
            "Interpret the electrical and thermal behaviour of the focus design. Call simulate for charge and discharge and evaluate_design. "
            "Explain the drivers using the engine's own numbers (e.g. heat scales with current squared, CC vs CV time, end condition, efficiency, "
            "peak temperature vs limit). Use get_model_documentation to state the fidelity limits of the thermal and electrical models."),
    },
    "safety": {
        "label": "AI Safety Assistant",
        "instruction": (
            "Call safety_checks for the focus design. Explain every WARN, FAIL and NOT_EVALUATED check: what it means physically, the possible "
            "risk, the constraint involved, and which input or test would resolve it. Report the max safe charge current and its binding "
            "constraint. Never call the design safe, certified or compliant; checks are design screening only."),
    },
    "optimizer": {
        "label": "AI Optimization Advisor",
        "instruction": (
            "Translate the user's stated priorities into explicit metric weights (state the mapping in assumptions). Use compare_designs on the "
            "project designs and, where useful, sweep_parameter or evaluated variants to find improvements. Every recommended change must be "
            "evaluated by the engine and listed in candidate_designs; describe trade-offs using the engine's deltas."),
    },
    "report": {
        "label": "AI Report Generator",
        "instruction": (
            "Write an engineering summary in report_sections with these titles: Executive summary; Design basis and assumptions; Results; "
            "Safety screening; Comparison and recommendation; Limitations and next steps. Run the tools needed (get_project_designs, "
            "evaluate_design, compare_designs, safety_checks, get_model_documentation). Every number must come from a tool result and every "
            "section must list its source_refs. State clearly that results are model estimates and that illustrative data is not a real product."),
    },
}

SYSTEM_PROMPT = """You are the BatteryX engineering copilot, a decision-support assistant for battery module design used by students and engineers.

You work through tools that run the BatteryX engine and read the BatteryX cell database. The engine computes; you interpret.

Engineering rules (non-negotiable):
1. Never compute, estimate or guess engineering values yourself. Every number you state must come from a tool result of this turn, from the project context, or from the user's message. If a value is not available, say which input is missing.
2. Never invent battery or cell specifications. Cell data comes only from list_cells/get_cell. Fields that are null are missing; report them as missing.
3. Never invent datasheet references, URLs, standards clauses or test reports. Quote datasheet_ref exactly as the database gives it, or say none is recorded.
4. All engine outputs are model ESTIMATES, not measurements. Never describe them as measured, tested or validated.
5. Disclose assumptions and uncertainty: engine assumptions and flags, simplified-model labels, illustrative data, and the assumptions you made in interpreting the request.
6. Never certify, approve or guarantee safety or standards compliance. Safety checks are design screening only; physical testing to the applicable standards is required.
7. Tool results from earlier turns are not available as references; re-run tools when you need numbers.

How to answer:
- Call tools first, then answer. Cite sources: each claim's source_ref is the ref ("T1", "T2", ...) of the tool result that contains its number. Use basis "general_engineering_knowledge" only for qualitative statements, with value null.
- candidate_designs: only configurations you evaluated this turn, with evaluated_ref pointing to that tool call and the exact changes used.
- recommendations: mark verified=true only when an engine tool result (evaluate_design, simulate, safety_checks, compare_designs, sweep_parameter) supports it, and list those refs.
- answer_markdown: concise engineering explanation for the user (markdown allowed). Do not introduce numbers that are not in claims or tool results.
- report_sections: fill only in report mode, otherwise return an empty list.
- safety_notice: one sentence reminding that results are estimates and checks are not certification.
Your final message must be the JSON object required by the response format."""

ANSWER_SCHEMA: dict = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "answer_markdown", "claims", "recommendations", "candidate_designs", "assumptions",
                 "uncertainties", "missing_inputs", "report_sections", "safety_notice"],
    "properties": {
        "summary": {"type": "string"},
        "answer_markdown": {"type": "string"},
        "claims": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["statement", "value", "unit", "source_ref", "basis"],
            "properties": {
                "statement": {"type": "string"},
                "value": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                "unit": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                "source_ref": {"type": "string"},
                "basis": {"type": "string", "enum": ["engine_estimate", "cell_database", "model_documentation", "project_input", "general_engineering_knowledge"]},
            }}},
        "recommendations": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["action", "rationale", "priority", "verified", "source_refs"],
            "properties": {"action": {"type": "string"}, "rationale": {"type": "string"},
                           "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                           "verified": {"type": "boolean"}, "source_refs": {"type": "array", "items": {"type": "string"}}}}},
        "candidate_designs": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["name", "base_design", "changes", "evaluated_ref", "verdict"],
            "properties": {"name": {"type": "string"}, "base_design": {"type": "string"},
                           "changes": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["path", "value"],
                                                                  "properties": {"path": {"type": "string"}, "value": {"anyOf": [{"type": "number"}, {"type": "string"}]}}}},
                           "evaluated_ref": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                           "verdict": {"type": "string"}}}},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "uncertainties": {"type": "array", "items": {"type": "string"}},
        "missing_inputs": {"type": "array", "items": {"type": "string"}},
        "report_sections": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["title", "body_markdown", "source_refs"],
            "properties": {"title": {"type": "string"}, "body_markdown": {"type": "string"}, "source_refs": {"type": "array", "items": {"type": "string"}}}}},
        "safety_notice": {"type": "string"},
    },
}


def project_context(project: dict, cells: list[dict]) -> dict:
    return {
        "project": {"name": project.get("name"), "application": project.get("application"), "description": project.get("description")},
        "requirements": complete_requirements(project.get("requirements")),
        "designs": [{"name": d.get("name"), "role": d.get("role"), "cell_id": d.get("cell_id") or (d.get("cell") or {}).get("id"),
                     "topology": f"{d.get('series')}S{d.get('parallel')}P", "description": d.get("description")} for d in project.get("designs", [])],
        "cells_in_database": [{"id": c["id"], "chemistry": c["chemistry"], "data_status": c["data_status"]} for c in cells],
    }


def _history_messages(turns: list[dict]) -> list[dict]:
    msgs = []
    for t in turns[-HISTORY_TURNS:]:
        msgs.append({"role": "user", "content": f"[{t['mode']}] {t['message']}"})
        s = t.get("structured") or {}
        msgs.append({"role": "assistant", "content": json.dumps({"summary": s.get("summary"), "answer_markdown": s.get("answer_markdown")}, ensure_ascii=False)})
    return msgs


def _final_json(resp) -> dict:
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
    if text is None:
        raise ClaudeProviderError("The AI finished without a final answer.")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise ClaudeProviderError("The AI's final answer was not valid JSON.") from None


def run_turn(client: ClaudeClient, *, project: dict, cell_store, mode: str, message: str,
             focus_design: str | None, history: list[dict]) -> dict:
    if mode not in MODES:
        raise ValueError(f"unknown mode {mode}")
    cells = cell_store.list()
    ctx_data = project_context(project, cells)
    tools_ctx = ToolContext(project=project, cells=cell_store)
    user_text = (
        f"<project_context>\n{json.dumps(ctx_data, ensure_ascii=False)}\n</project_context>\n"
        f"<capability>{MODES[mode]['label']}: {MODES[mode]['instruction']}</capability>\n"
        + (f"<focus_design>{focus_design}</focus_design>\n" if focus_design else "")
        + f"<user_request>\n{message}\n</user_request>"
    )
    messages = _history_messages(history) + [{"role": "user", "content": user_text}]
    usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0, "api_calls": 0}
    t0 = time.time()
    repairs = 0
    rounds = 0
    known_cells = {c["id"] for c in cells}

    while True:
        resp = client.create(
            system=[{"type": "text", "text": SYSTEM_PROMPT}],
            tools=TOOLS,
            messages=messages,
            output_config={"format": {"type": "json_schema", "schema": ANSWER_SCHEMA}},
            cache_control={"type": "ephemeral"},  # caches the stable tools + system + history prefix
        )
        usage["api_calls"] += 1
        u = getattr(resp, "usage", None)
        for k in ("input_tokens", "output_tokens", "cache_read_input_tokens"):
            usage[k] += int(getattr(u, k, 0) or 0)
        messages.append({"role": "assistant", "content": resp.content})

        if resp.stop_reason == "pause_turn":
            continue
        if resp.stop_reason == "max_tokens":
            raise ClaudeProviderError("The AI's answer was cut off (output token limit). Ask a narrower question.")
        if resp.stop_reason == "tool_use":
            rounds += 1
            if rounds > MAX_TOOL_ROUNDS:
                raise ClaudeProviderError(f"Stopped after {MAX_TOOL_ROUNDS} tool rounds without a final answer.")
            results = []
            for block in resp.content:
                if getattr(block, "type", None) == "tool_use":
                    call = tools_ctx.execute(block.name, dict(block.input))
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": result_json(call), "is_error": not call.ok})
            messages.append({"role": "user", "content": results})  # all results in one message
            continue

        structured = _final_json(resp)
        verification = verify_answer(structured, tools_ctx.calls, ctx_data, message, known_cells)
        if verification["passed"] or repairs >= MAX_REPAIRS:
            break
        repairs += 1
        problems = "\n".join(f"- {i['type']} at {i['where']}: {i['detail']}" for i in verification["issues"] if i["severity"] == "error")
        messages.append({"role": "user", "content":
                         "VERIFICATION FAILED. The BatteryX verifier found these problems in your answer:\n" + problems +
                         "\nRevise the answer: remove or correct every flagged item, cite only refs from this turn's tool results "
                         "(call tools again if you need numbers), and return the full JSON answer again."})

    return {
        "mode": mode,
        "capability": MODES[mode]["label"],
        "structured": structured,
        "verification": {**verification, "repair_rounds": repairs},
        "tool_calls": [{"ref": c.ref, "name": c.name, "input": c.input, "ok": c.ok,
                        "error": c.result.get("error") if not c.ok else None} for c in tools_ctx.calls],
        "tool_results": {c.ref: c.result for c in tools_ctx.calls},
        "model": client.model,
        "usage": usage,
        "latency_s": round(time.time() - t0, 2),
        "label": "AI-generated engineering explanation of model estimates. Verified against engine results by the backend; not engineering approval.",
    }
