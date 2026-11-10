"""Deterministic verification of copilot answers against the tool results of the same turn.

Errors (answer fails verification):
  invalid_reference       a claim/recommendation/section cites a ref that no tool call produced
  value_mismatch          a claim's number is not in the tool result it cites
  unsourced_number        a claim states a number with no engine/database source
  ungrounded_number       free text contains a number that appears in no tool result, project context or question
  candidate_not_evaluated a proposed design was never run through the engine with those changes
  unknown_cell            a referenced cell id is not in the cell database
  unverified_reference    a URL / document reference that no tool result contains (possible invented datasheet ref)
  certification_claim     wording that certifies or guarantees safety / standards compliance
  measurement_claim       wording that presents estimates as measured or validated
Warnings: unverified recommendation (no engine evidence), missing disclosure of assumptions.
"""
from __future__ import annotations

import re
from typing import Any

from .copilot_tools import ToolCall
from .grounding import _matches, collect_numbers, verify as ground_text

ENGINE_TOOLS = {"evaluate_design", "simulate", "safety_checks", "compare_designs", "sweep_parameter"}
SOURCED_BASES = {"engine_estimate", "cell_database", "model_documentation"}

_NEG = r"(?:not|no|never|cannot|can't|isn't|aren't|without|nor|neither)\b[\w\s,/-]{0,40}?"
_CERT = re.compile(r"\b(certif(?:y|ied|ies|ication)|guarantee[sd]?\s+(?:to be\s+)?safe|is\s+(?:fully\s+|completely\s+)?safe\b|are\s+(?:fully\s+|completely\s+)?safe\b|"
                   r"complies\s+with|compliant\s+with|approved\s+for\s+use|meets\s+(?:IEC|UL|UN|ISO)\b)", re.I)
_MEAS = re.compile(r"\b(measured|test(?:ed)?\s+data\s+(?:shows|show|confirms)|experimentally\s+(?:verified|confirmed)|validated\s+(?:by|with|against)\s+(?:test|measure))", re.I)
_URL = re.compile(r"https?://[^\s)\]>\"']+")
_CELL_TOKEN = re.compile(r"\b[A-Z][A-Z0-9]*(?:[-_.][A-Z0-9]+){1,}\b")
_NOT_CELL = re.compile(r"^(?:[A-Z]{2}-\d{2}|REQ-\d+|ASM-\d+|CC-CV|IEC-\d+|UL-\d+|T\d+|\d+S\d+P)$")


def _negated(text: str, start: int) -> bool:
    window = text[max(0, start - 60):start]
    return re.search(_NEG + r"$", window, re.I) is not None or re.search(r"\b(not|no|never|cannot|neither|nor)\b", window[-30:], re.I) is not None


def _flag_phrases(text: str, pattern: re.Pattern, kind: str, where: str) -> list[dict]:
    out = []
    for m in pattern.finditer(text):
        if not _negated(text, m.start()):
            out.append({"type": kind, "severity": "error", "where": where, "detail": f"\"{text[max(0, m.start() - 40):m.end() + 30].strip()}\""})
    return out


def _texts(s: dict) -> list[tuple[str, str]]:
    out = [("summary", s.get("summary", "")), ("answer_markdown", s.get("answer_markdown", "")), ("safety_notice", s.get("safety_notice", ""))]
    out += [(f"recommendations[{i}]", f"{r.get('action', '')} {r.get('rationale', '')}") for i, r in enumerate(s.get("recommendations", []))]
    out += [(f"report_sections[{i}]", f"{r.get('title', '')}\n{r.get('body_markdown', '')}") for i, r in enumerate(s.get("report_sections", []))]
    out += [(f"candidate_designs[{i}]", f"{c.get('name', '')} {c.get('verdict', '')}") for i, c in enumerate(s.get("candidate_designs", []))]
    out += [("claims", " ".join(c.get("statement", "") for c in s.get("claims", [])))]
    return out


def verify_answer(s: dict, calls: list[ToolCall], context: Any, question: str, known_cell_ids: set[str]) -> dict:
    issues: list[dict] = []
    refs = {c.ref: c for c in calls}
    ok_refs = {c.ref for c in calls if c.ok}

    # 1. claims
    claim_status = []
    for i, c in enumerate(s.get("claims", [])):
        status, ref, val, basis = "verified", c.get("source_ref"), c.get("value"), c.get("basis")
        if basis in SOURCED_BASES and ref not in ok_refs:
            issues.append({"type": "invalid_reference", "severity": "error", "where": f"claims[{i}]", "detail": f"cites '{ref}', which is not a successful tool call this turn"})
            status = "invalid_reference"
        elif val is not None:
            if basis == "general_engineering_knowledge" or (basis not in SOURCED_BASES and basis != "project_input"):
                issues.append({"type": "unsourced_number", "severity": "error", "where": f"claims[{i}]", "detail": f"number {val} has no engine or database source"})
                status = "unsourced"
            elif basis == "project_input":
                if not _matches(float(val), collect_numbers(context) + collect_numbers(question)):
                    issues.append({"type": "value_mismatch", "severity": "error", "where": f"claims[{i}]", "detail": f"{val} not found in the project inputs"})
                    status = "mismatch"
            elif not _matches(float(val), collect_numbers(refs[ref].result) + [n * f for n in collect_numbers(refs[ref].result) for f in (60, 100, 1000, 0.001)]):
                issues.append({"type": "value_mismatch", "severity": "error", "where": f"claims[{i}]", "detail": f"{val} {c.get('unit') or ''} is not in the result of {ref} ({refs[ref].name})"})
                status = "mismatch"
        claim_status.append({**c, "verification": status})

    # 2. references in recommendations / sections
    for field in ("recommendations", "report_sections"):
        for i, r in enumerate(s.get(field, [])):
            bad = [x for x in r.get("source_refs", []) if x not in ok_refs]
            if bad:
                issues.append({"type": "invalid_reference", "severity": "error", "where": f"{field}[{i}]", "detail": f"unknown refs {bad}"})
    for i, r in enumerate(s.get("recommendations", [])):
        if r.get("verified") and not any(refs.get(x) and refs[x].ok and refs[x].name in ENGINE_TOOLS for x in r.get("source_refs", [])):
            issues.append({"type": "unverified_recommendation", "severity": "warning", "where": f"recommendations[{i}]", "detail": "marked verified but cites no engine run"})

    # 3. candidate designs must have been evaluated with the same changes
    for i, cd in enumerate(s.get("candidate_designs", [])):
        ref = cd.get("evaluated_ref")
        call = refs.get(ref) if ref else None
        if not call or not call.ok or call.name not in ENGINE_TOOLS:
            issues.append({"type": "candidate_not_evaluated", "severity": "error", "where": f"candidate_designs[{i}]", "detail": f"'{cd.get('name')}' has no successful engine evaluation"})
            continue
        if not _same_design(cd, call):
            issues.append({"type": "candidate_not_evaluated", "severity": "error", "where": f"candidate_designs[{i}]", "detail": f"{ref} evaluated different inputs than '{cd.get('name')}' proposes"})
        for ch in cd.get("changes", []):
            if ch.get("path") == "cell_id" and ch.get("value") not in known_cell_ids:
                issues.append({"type": "unknown_cell", "severity": "error", "where": f"candidate_designs[{i}]", "detail": f"cell '{ch.get('value')}' is not in the database"})

    # 4. free text: numbers, references, forbidden claims, invented identifiers
    all_results = [c.result for c in calls if c.ok]
    numbers_checked = 0
    ref_strings = " ".join(str(c.result) for c in calls)
    for where, text in _texts(s):
        if not text:
            continue
        g = ground_text(text, [all_results, context], question)
        numbers_checked += g["numbers_checked"]
        if g["ungrounded_numbers"]:
            issues.append({"type": "ungrounded_number", "severity": "error", "where": where, "detail": f"numbers not found in any tool result or input: {g['ungrounded_numbers']}"})
        for url in _URL.findall(text):
            if url.rstrip(".,") not in ref_strings and url.rstrip(".,") not in str(context):
                issues.append({"type": "unverified_reference", "severity": "error", "where": where, "detail": f"{url} does not come from the database or tools"})
        issues += _flag_phrases(text, _CERT, "certification_claim", where)
        issues += _flag_phrases(text, _MEAS, "measurement_claim", where)
        for tok in set(_CELL_TOKEN.findall(text)):
            if not _NOT_CELL.match(tok) and any(ch.isdigit() for ch in tok) and tok not in known_cell_ids and tok not in ref_strings and tok not in str(context):
                issues.append({"type": "unknown_cell", "severity": "error", "where": where, "detail": f"identifier '{tok}' is not a known cell or result"})

    # 5. disclosure
    if not s.get("assumptions") and not s.get("uncertainties"):
        issues.append({"type": "missing_disclosure", "severity": "warning", "where": "assumptions", "detail": "no assumptions or uncertainties disclosed"})

    errors = [x for x in issues if x["severity"] == "error"]
    return {"passed": not errors, "error_count": len(errors), "warning_count": len(issues) - len(errors),
            "numbers_checked": numbers_checked, "issues": issues, "claims": claim_status}


def _same_design(cd: dict, call: ToolCall) -> bool:
    inp = call.input
    if call.name == "sweep_parameter":
        candidates = [{**inp, "changes": [*(inp.get("changes") or []), {"path": inp["parameter"], "value": v}]} for v in inp.get("values", [])]
    elif "design_name" in inp:
        candidates = [inp]
    else:
        candidates = [inp.get("baseline", {}), *inp.get("alternatives", [])]
    want = {(c.get("path"), _norm(c.get("value"))) for c in cd.get("changes", [])}
    for c in candidates:
        if c.get("design_name") != cd.get("base_design"):
            continue
        have = {(x.get("path"), _norm(x.get("value"))) for x in c.get("changes") or []}
        if want <= have:
            return True
    return False


def _norm(v):
    try:
        return round(float(v), 6)
    except (TypeError, ValueError):
        return v
