"""Design comparison engine: baseline vs alternatives.

Method (constraint-first, then preference):
  1. Evaluate every design with the full pipeline (same requirements for all).
  2. Eligibility: any BMS/safety check with status FAIL → design is not eligible for recommendation.
  3. Normalised score per metric across designs (1 = best):
       higher-is-better:  s = (x − min) / (max − min)
       lower-is-better:   s = (max − x) / (max − min)       (s = 1 for all if max = min)
     preference score = Σ w·s / Σ w   over metrics available for every design
  4. Rank = score − 0.5 · (number of requirements NOT_MET)     (penalty retained from stage-1 prototype)
  5. Recommend the highest-ranked eligible design; list its trade-offs, risks and limitations.
"""
from __future__ import annotations

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput, Requirement
from app.schemas.results import DISCLAIMER, RESULT_TYPE, ModelInfo

from .common import rnd
from .pipeline import METRICS, evaluate_design

MODEL = ModelInfo(
    id="comparison.constraint_first_weighted", version="1.0.0", fidelity="aggregation",
    label="Constraint-first, weighted normalised multi-criteria comparison",
    equations=["s = (x−min)/(max−min) or (max−x)/(max−min)", "score = Σw·s/Σw", "rank = score − 0.5·N_not_met"],
    assumptions=["Min–max normalisation is relative to the compared set only; adding a design can change scores.",
                 "Weights express user preference and are not engineering facts.",
                 "Scores inherit every limitation of the underlying simplified models."],
)

DEFAULT_WEIGHTS = {
    "usable_energy_wh": 1.0,
    "charge_time_cc_estimate_h": 1.0,
    "peak_cell_temp_charge_c": 1.0,
    "module_mass_kg": 1.0,
    "module_volume_l": 1.0,
    "relative_cost_index": 1.0,
}
REQ_MISS_PENALTY = 0.5


class ComparisonError(ValueError):
    pass


def compare(designs: list[tuple[DesignInput, CellSpec]], requirements: list[Requirement] | None,
            weights: dict[str, float] | None) -> dict:
    names = [d.name for d, _ in designs]
    if len(set(names)) != len(names):
        raise ComparisonError("Design names must be unique within a comparison")
    weights = dict(weights) if weights else dict(DEFAULT_WEIGHTS)
    for k, w in weights.items():
        if k not in METRICS:
            raise ComparisonError(f"Unknown metric in weights: '{k}'. Valid: {sorted(METRICS)}")
        if METRICS[k][2] == "info":
            raise ComparisonError(f"Metric '{k}' has no better/worse direction and cannot be weighted")
        if w < 0:
            raise ComparisonError("Weights must be ≥ 0")
    if sum(weights.values()) <= 0:
        raise ComparisonError("At least one weight must be > 0")

    reqs = requirements if requirements is not None else designs[0][0].requirements
    results = [evaluate_design(cell, d, reqs) for d, cell in designs]
    notes: list[str] = []
    if len(designs) < 3:
        notes.append("The case study asks for at least two design options compared against a baseline; only "
                     f"{len(designs) - 1} alternative provided.")

    # normalised scores
    used, skipped = [], []
    for k in weights:
        if weights[k] == 0:
            continue
        xs = [r["kpis"].get(k) for r in results]
        (used if all(x is not None for x in xs) else skipped).append(k)
    if skipped:
        notes.append(f"Metrics excluded from scoring because at least one design lacks them: {', '.join(skipped)}.")
    wsum = sum(weights[k] for k in used)
    rows = []
    for r in results:
        parts = {}
        for k in used:
            xs = [q["kpis"][k] for q in results]
            lo, hi, x = min(xs), max(xs), r["kpis"][k]
            better = METRICS[k][2]
            parts[k] = 1.0 if hi - lo < 1e-12 else ((x - lo) / (hi - lo) if better == "high" else (hi - x) / (hi - lo))
        score = sum(weights[k] * parts[k] for k in used) / wsum if wsum else None
        checks = r["modules"]["bms"]["values"]["checks"]
        fails = [c for c in checks if c["status"] == "FAIL"]
        warns = [c for c in checks if c["status"] == "WARN"]
        not_eval = [c for c in checks if c["status"] == "NOT_EVALUATED"]
        not_met = [q for q in r["requirements"] if q["status"] == "NOT_MET"]
        req_ne = [q for q in r["requirements"] if q["status"] == "NOT_EVALUATED"]
        rank = None if score is None else score - REQ_MISS_PENALTY * len(not_met)
        rows.append({
            "design_name": r["design_name"], "role": r["role"], "topology": r["topology"], "cell_id": r["cell"]["id"],
            "eligible": not fails, "score": rnd(score, 4), "rank_value": rnd(rank, 4),
            "score_parts": {k: rnd(v, 4) for k, v in parts.items()},
            "safety_fails": [f"{c['id']}: {c['description']} ({c['detail']})" for c in fails],
            "safety_warnings": [f"{c['id']}: {c['description']} ({c['detail']})" for c in warns],
            "checks_not_evaluated": [c["id"] for c in not_eval],
            "requirements_not_met": [f"{q['id']}: {q['detail']}" for q in not_met],
            "requirements_not_evaluated": [q["id"] for q in req_ne],
        })

    # deltas vs baseline
    base = results[0]["kpis"]
    for row, r in zip(rows, results):
        deltas, better, worse = {}, [], []
        for k, (label, unit, direction) in METRICS.items():
            x, b = r["kpis"].get(k), base.get(k)
            if x is None or b is None:
                continue
            dx = x - b
            deltas[k] = {"value": x, "baseline": b, "delta": rnd(dx, 4), "delta_pct": rnd(100 * dx / b, 2) if b else None}
            if direction != "info" and abs(dx) > 1e-9 and row["role"] != "baseline":
                good = (dx > 0) == (direction == "high")
                (better if good else worse).append(f"{label}: {b:.4g} → {x:.4g} {unit}")
        row["delta_vs_baseline"] = deltas
        row["improves_on_baseline"] = better
        row["worse_than_baseline"] = worse

    ranked = sorted([r for r in rows if r["eligible"] and r["rank_value"] is not None], key=lambda r: -r["rank_value"])
    for i, r in enumerate(ranked, 1):
        r["rank"] = i
    rec = None
    if ranked:
        best = ranked[0]
        res = next(x for x in results if x["design_name"] == best["design_name"])
        def ran(m: dict) -> bool:
            vals = m["values"]
            if m["module"] == "ageing":
                return bool(vals.get("evaluated"))
            if m["module"].endswith("_simulation"):
                return "end_reason" in vals
            return True
        limitations = sorted({m["model"]["label"] for m in res["modules"].values()
                              if m["model"]["fidelity"] != "closed_form" and ran(m)}
                             | {res["modules"]["thermal"]["model"]["label"]})
        flag_risks = list(dict.fromkeys(f"{f['code']}: {f['message']}" for f in res["flags"] if f["severity"] in ("unsupported", "warning")))
        rec = {
            "design_name": best["design_name"],
            "topology": best["topology"],
            "why": best["improves_on_baseline"] or ["Best available preference score among eligible designs."],
            "trade_offs": best["worse_than_baseline"],
            "risks": best["safety_warnings"] + best["requirements_not_met"]
                     + ([f"{len(best['checks_not_evaluated'])} safety checks not evaluated: {', '.join(best['checks_not_evaluated'])}"] if best["checks_not_evaluated"] else [])
                     + flag_risks,
            "model_limitations": limitations,
            "recommended_next_step": "Replace any example/assumed inputs with datasheet values, then verify the estimated "
                                     "peak temperature and charge time of this design with a supervised low-voltage test "
                                     "before relying on the comparison.",
        }
    else:
        notes.append("No design is eligible for recommendation: every design has at least one safety check FAIL.")

    if any(r["cell"]["data_status"] == "illustrative_example" for r in results):
        notes.append("At least one design uses an illustrative example cell; the comparison demonstrates the method, not a real product decision.")
    return {
        "result_type": RESULT_TYPE,
        "disclaimer": DISCLAIMER,
        "model": MODEL.model_dump(),
        "weights_used": {k: weights[k] for k in used},
        "metrics": {k: {"label": l, "unit": u, "better": b} for k, (l, u, b) in METRICS.items()},
        "ranking": rows,
        "recommendation": rec,
        "notes": notes,
        "designs": results,
    }
