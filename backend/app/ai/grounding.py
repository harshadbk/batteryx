"""Number-grounding verifier: every number the AI writes must appear in the engine context
(within rounding tolerance) or in the user's question. Unmatched numbers are reported, not hidden."""
from __future__ import annotations

import re
from typing import Any

# Identifiers that contain digits but are not quantities: rule ids, requirement ids, topologies, C-rates as labels.
_ID = re.compile(r"\b(?:[A-Z]{2,4}-\d{1,3}|REQ-\d+|ASM-\d+|\d+S\d+P|[A-Z]+-[A-Z0-9-]*\d[A-Z0-9-]*)\b")
_NUM = re.compile(r"(?<![\w.])-?\d+(?:[.,]\d+)?(?![\w])")


def collect_numbers(obj: Any, out: list[float] | None = None) -> list[float]:
    out = [] if out is None else out
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        out.append(float(obj))
    elif isinstance(obj, str):
        out.extend(float(m.replace(",", "")) for m in _NUM.findall(_ID.sub(" ", obj)))
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            collect_numbers(v, out)
    return out


def _matches(x: float, ref: list[float]) -> bool:
    for r in ref:
        if abs(x - r) <= max(0.051, 0.01 * abs(r)):  # rounding to 1 decimal or 1 %
            return True
        if r != 0 and abs(abs(x) - abs(r)) <= max(0.051, 0.01 * abs(r)):  # sign-free (e.g. charge current shown negative)
            return True
    return False


def verify(answer: str, context: Any, question: str = "") -> dict:
    ref = collect_numbers(context) + collect_numbers(question)
    # derived conversions an explanation commonly uses: h→min, fraction→%
    ref += [r * 60 for r in ref] + [r * 100 for r in ref] + [r / 1000 for r in ref]
    cleaned = _ID.sub(" ", answer)
    found = [m for m in _NUM.findall(cleaned)]
    ungrounded = []
    for s in found:
        x = float(s.replace(",", ""))
        if abs(x) <= 10 and float(x).is_integer():  # small counts / list numbering
            continue
        if not _matches(x, ref):
            ungrounded.append(s)
    return {"numbers_checked": len(found), "ungrounded_numbers": sorted(set(ungrounded), key=found.index),
            "passed": not ungrounded}
