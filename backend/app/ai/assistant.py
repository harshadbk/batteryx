"""Assistant use cases: grounded explanation of engine results and requirement extraction."""
from __future__ import annotations

import json
import re

from app.engine.pipeline import METRICS

from .grounding import verify
from .llm import AIProviderError, LLMClient
from .requirements_parser import parse_requirements

AI_LABEL = "AI-generated explanation of model estimates. Verify against the engine results; not engineering approval."

SYSTEM_EXPLAIN = """You are the BatteryX engineering assistant for battery module design.
Rules you must follow:
- Use ONLY numbers that appear in CONTEXT (engine results). Never invent, estimate or recompute values, cell specifications or test results.
- Cite a rule id (e.g. TH-01) or requirement id (e.g. REQ-02) only when you are talking about that exact check or requirement; never attach ids to unrelated statements.
- Do not do arithmetic to produce new numbers (no new ratios, sums or percentages); quote the engine's numbers.
- All values are model estimates, not measurements. Say so when relevant.
- Never state that a design is safe, certified or approved; checks are design-screening only.
- If CONTEXT lacks the information, say what input is missing (use the flags) instead of guessing.
- Explain trade-offs and cause-and-effect (e.g. heat scales with current squared) in plain engineering language.
- Be concise: short paragraphs or bullets, at most about 250 words."""

SYSTEM_EXTRACT = """You convert battery design requirements written in natural language into JSON.
Return {"requirements": [...], "unmapped": [...]}.
Each requirement: {"metric": <one of the allowed metric keys>, "operator": ">=" or "<=", "value": number in the metric's unit,
"source_text": exact phrase from the input, "confidence": "high" | "medium" | "low"}.
Only use numbers stated in the input; convert units (kWh→Wh, minutes→h) but never assume missing values.
Put any statement you cannot map to an allowed metric into "unmapped" as {"text": ..., "reason": ...}.
Allowed metrics (key: label [unit]):
"""


def _compact_design(r: dict, brief: bool = False) -> dict:
    m = r["modules"]
    checks = m["bms"]["values"]["checks"]
    if brief:  # comparisons: keep only what differs from PASS to stay within provider token limits
        checks = [c for c in checks if c["status"] != "PASS"]
    seen, flags = set(), []
    for f in r["flags"]:
        if f["severity"] in ("missing_input", "unsupported", "warning", "assumption") and f["code"] not in seen:
            seen.add(f["code"])
            flags.append({"code": f["code"], "message": f["message"]} if not brief else f["code"])
    out = {
        "design": r["design_name"], "role": r["role"], "topology": r["topology"],
        "cell": r["cell"],
        "kpis": {k: v for k, v in r["kpis"].items() if v is not None},
        "kpi_units": {k: u for k, u in r["kpi_units"].items() if r["kpis"].get(k) is not None},
        "requirements": [{k: q[k] for k in ("id", "metric", "operator", "target", "value", "status")} for q in r["requirements"]],
        "safety_checks" if not brief else "safety_checks_not_pass": [{k: c[k] for k in ("id", "description", "status", "detail")} for c in checks],
        "thermal_model": m["thermal"]["model"]["label"],
        "flags": flags[:20],
    }
    if not brief:
        out["thermal_assumptions"] = m["thermal"]["model"]["assumptions"]
    return out


def design_context(result: dict) -> dict:
    return {"type": "design_evaluation", "result_type": result["result_type"], **_compact_design(result)}


def comparison_context(result: dict) -> dict:
    return {
        "type": "design_comparison", "result_type": result["result_type"],
        "weights": result["weights_used"],
        "ranking": [{k: r.get(k) for k in ("design_name", "topology", "eligible", "score", "rank", "safety_fails",
                                           "safety_warnings", "requirements_not_met", "improves_on_baseline", "worse_than_baseline")}
                    for r in result["ranking"]],
        "recommendation": result["recommendation"],
        "notes": result["notes"],
        "designs": [_compact_design(d, brief=True) for d in result["designs"]],
    }


def explain(llm: LLMClient, context: dict, question: str, history: list[dict]) -> dict:
    ctx_json = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    messages = [{"role": "system", "content": SYSTEM_EXPLAIN},
                {"role": "system", "content": "CONTEXT (authoritative engine results):\n" + ctx_json}]
    messages += [{"role": h["role"], "content": h["content"]} for h in history[-6:]]
    messages.append({"role": "user", "content": question})
    answer = llm.chat(messages).strip()
    return {"answer": answer, "grounding": verify(answer, context, question), "provider": llm.provider,
            "model": llm.model, "label": AI_LABEL}


def extract_requirements(llm: LLMClient, text: str) -> dict:
    allowed = {k: v for k, v in METRICS.items() if v[2] != "info"}
    if llm.configured:
        prompt = SYSTEM_EXTRACT + "\n".join(f"{k}: {l} [{u}]" for k, (l, u, _) in allowed.items())
        raw = llm.chat([{"role": "system", "content": prompt}, {"role": "user", "content": text}], json_mode=True, temperature=0)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", raw, re.S)
            if not m:
                raise AIProviderError("AI returned non-JSON output for requirement extraction") from None
            data = json.loads(m.group(0))
        source, items, unmapped = "ai", data.get("requirements", []), data.get("unmapped", [])
    else:
        source, items, unmapped = "rule_based_parser", parse_requirements(text), []

    valid, rejected = [], []
    stated = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)]
    for i, it in enumerate(items):
        metric, op, val = it.get("metric"), it.get("operator"), it.get("value")
        reason = None
        if metric not in allowed:
            reason = f"unknown metric '{metric}'"
        elif op not in (">=", "<="):
            reason = f"invalid operator '{op}'"
        elif not isinstance(val, (int, float)):
            reason = "value is not a number"
        elif not any(abs(val - s) < 1e-6 or abs(val - s * 1000) < 1e-6 or abs(val - s / 60) < 1e-3 for s in stated):
            reason = "value not found in the input text (possible invention)"
        if reason:
            rejected.append({"item": it, "reason": reason})
            continue
        valid.append({"id": f"REQ-{len(valid) + 1:02d}", "metric": metric, "operator": op, "value": float(val),
                      "unit": allowed[metric][1], "description": f"Proposed from: \"{it.get('source_text', '')}\"",
                      "confidence": it.get("confidence", "medium"), "status": "proposed: confirm before use"})
    return {"source": source, "requirements": valid, "rejected": rejected, "unmapped": unmapped,
            "note": "Proposals only. An engineer must confirm each requirement before it is used."}
