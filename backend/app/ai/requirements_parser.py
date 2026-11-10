"""Rule-based requirement parser (port of the stage-1 prototype's parseRequirements in
frontend/src/simulator/model/engine.js). Used when the AI provider is unavailable."""
from __future__ import annotations

import re

NUM = r"(\d+(?:\.\d+)?)"


def parse_requirements(text: str) -> list[dict]:
    t = text.lower()
    out: list[dict] = []

    def add(pattern: str, make):
        m = re.search(pattern, t)
        if m:
            out.append({**make(float(m.group(1)), m.group(2) if m.lastindex and m.lastindex >= 2 else None), "source_text": m.group(0)})

    add(rf"(?:at least|minimum|min\.?|>=?|store|stores|hold|holds)\s*{NUM}\s*(wh|kwh)",
        lambda x, u: {"metric": "usable_energy_wh", "operator": ">=", "value": x * 1000 if u == "kwh" else x, "unit": "Wh", "confidence": "high"})
    add(rf"(?:under|below|at most|max(?:imum)?|less than|lighter than|<=?)\s*{NUM}\s*(kg)",
        lambda x, u: {"metric": "module_mass_kg", "operator": "<=", "value": x, "unit": "kg", "confidence": "high"})
    add(rf"(?:charge|charging)[^.]*?(?:within|in|under|below)\s*{NUM}\s*(h|hr|hrs|hour|hours|min|mins|minutes)\b",
        lambda x, u: {"metric": "charge_time_cc_estimate_h", "operator": "<=", "value": round(x / 60, 3) if u.startswith("m") else x,
                      "unit": "h", "confidence": "medium"})
    add(rf"(?:below|under|at most|max(?:imum)?|keep[^.]*?under)\s*{NUM}\s*(°c|deg|c)\b",
        lambda x, u: {"metric": "peak_cell_temp_charge_c", "operator": "<=", "value": x, "unit": "°C", "confidence": "needs engineer"})
    return out
