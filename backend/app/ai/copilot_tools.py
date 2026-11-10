"""Copilot tools: deterministic BatteryX engine and database functions that Claude may call.

Claude never computes engineering values. It names a project design and a whitelisted set of
changes; the backend builds the design, runs the real engine and returns the results. Every call is
registered under a reference id (T1, T2, ...) so the answer can cite its sources and the verifier
can check every number against them.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from app.engine.comparison import ComparisonError, compare
from app.engine.electrical import run_simulation
from app.engine.mechanical import mechanical
from app.engine.pipeline import METRICS, evaluate_design
from app.engine.registry import MODELS
from app.errors import AppError
from app.schemas.design import DesignInput
from app.schemas.project import complete_requirements

# Design paths Claude may change. Thermal/mechanical ASSUMPTIONS can only be copied from another
# project design (copy_cooling_from / copy_mechanical_from), never typed in by the AI.
ALLOWED_CHANGES = {
    "series": "int", "parallel": "int", "cell_id": "str",
    "operating.charge_current_a": "num", "operating.discharge_current_a": "num", "operating.discharge_power_w": "num",
    "operating.soc_min_pct": "num", "operating.soc_max_pct": "num",
    "operating.charge_start_soc_pct": "num", "operating.charge_target_soc_pct": "num",
    "limits.temp_sensors_fitted": "int", "limits.voltage_sense_channels": "int",
    "copy_cooling_from": "str", "copy_mechanical_from": "str",
}
SWEEP_PARAMS = ["series", "parallel", "operating.charge_current_a", "operating.discharge_current_a"]


class ToolInputError(Exception):
    pass


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required if required is not None else list(props), "additionalProperties": False}


_CHANGES = {"type": "array", "description": "Changes to apply to the base design (may be empty). Only whitelisted paths are allowed.",
            "items": _obj({"path": {"type": "string", "enum": sorted(ALLOWED_CHANGES)},
                           "value": {"anyOf": [{"type": "number"}, {"type": "string"}]}})}
_DESIGN_REF = {"design_name": {"type": "string", "description": "Name of an existing project design used as the base."},
               "changes": _CHANGES,
               "label": {"anyOf": [{"type": "string"}, {"type": "null"}], "description": "Short name for this variant, e.g. 'A + 4S2P'."}}

TOOLS: list[dict] = [
    {"name": "list_cells", "strict": True,
     "description": "List cells in the BatteryX cell database with key datasheet fields, data_status (datasheet / user_entered / illustrative_example), datasheet_ref and which fields are missing. The ONLY source of cell specifications.",
     "input_schema": _obj({"chemistry": {"anyOf": [{"type": "string"}, {"type": "null"}], "description": "Filter, e.g. LFP; null for all."}})},
    {"name": "get_cell", "strict": True,
     "description": "Full record of one database cell, including provenance and the list of fields not provided by the datasheet.",
     "input_schema": _obj({"cell_id": {"type": "string"}})},
    {"name": "get_project_designs", "strict": True,
     "description": "The project's design inputs (baseline and alternatives), operating conditions, cooling assumptions, limits and the shared requirements.",
     "input_schema": _obj({})},
    {"name": "evaluate_design", "strict": True,
     "description": "Run the full BatteryX engine (sizing, energy, CC-CV/discharge simulation, simplified thermal, ageing, BMS checks, mechanical, cost) on a project design, optionally with changes. Returns KPIs with units, requirement status, safety-check status and model flags. Use this to evaluate every candidate before recommending it.",
     "input_schema": _obj(_DESIGN_REF)},
    {"name": "simulate", "strict": True,
     "description": "Time-domain charge (CC-CV) or discharge simulation of a design: duration, end condition, energy, efficiency, voltage range, peak temperature and a coarse time series.",
     "input_schema": _obj({**_DESIGN_REF, "mode": {"type": "string", "enum": ["charge", "discharge"]}})},
    {"name": "safety_checks", "strict": True,
     "description": "BMS/safety rule checks for a design: every check with status (PASS/WARN/FAIL/NOT_EVALUATED), value, limit, limit source, basis; max safe charge current and its binding constraint. Screening only, not certification.",
     "input_schema": _obj(_DESIGN_REF)},
    {"name": "compare_designs", "strict": True,
     "description": "Constraint-first comparison of a baseline and alternatives (each a project design plus optional changes) using user-priority weights. Returns ranking, eligibility, score parts, deltas vs baseline and the engine's recommendation.",
     "input_schema": _obj({
         "baseline": _obj(_DESIGN_REF),
         "alternatives": {"type": "array", "items": _obj(_DESIGN_REF)},
         "weights": {"type": "array", "description": "Metric weights reflecting the user's stated priorities; empty for engine defaults.",
                     "items": _obj({"metric": {"type": "string", "enum": [k for k, v in METRICS.items() if v[2] != "info"]}, "weight": {"type": "number"}})},
     })},
    {"name": "sweep_parameter", "strict": True,
     "description": "Evaluate a design at several values of one parameter (max 8 values) and return the chosen KPIs for each value.",
     "input_schema": _obj({**_DESIGN_REF, "parameter": {"type": "string", "enum": SWEEP_PARAMS},
                           "values": {"type": "array", "items": {"type": "number"}},
                           "metrics": {"type": "array", "items": {"type": "string", "enum": sorted(METRICS)}}})},
    {"name": "get_model_documentation", "strict": True,
     "description": "Equations, assumptions and fidelity label of the engine's models (cite these when explaining limitations).",
     "input_schema": _obj({"model_id": {"anyOf": [{"type": "string"}, {"type": "null"}], "description": "e.g. thermal.lumped_single_node; null for all."}})},
]


@dataclass
class ToolCall:
    ref: str
    name: str
    input: dict
    result: Any
    ok: bool


@dataclass
class ToolContext:
    project: dict
    cells: Any  # CellStore
    calls: list[ToolCall] = field(default_factory=list)

    # ------------------------------------------------------------ design resolution
    def _base(self, name: str) -> dict:
        for d in self.project.get("designs", []):
            if d.get("name") == name:
                return copy.deepcopy(d)
        raise ToolInputError(f"No project design named '{name}'. Available: {[d.get('name') for d in self.project.get('designs', [])]}")

    def build_design(self, ref: dict) -> tuple[DesignInput, Any, dict]:
        d = self._base(ref["design_name"])
        applied = {}
        for ch in ref.get("changes") or []:
            path, val = ch["path"], ch["value"]
            kind = ALLOWED_CHANGES.get(path)
            if kind is None:
                raise ToolInputError(f"Change path '{path}' is not allowed")
            if path in ("copy_cooling_from", "copy_mechanical_from"):
                src = self._base(str(val))
                key = "thermal" if path == "copy_cooling_from" else "mechanical"
                d[key] = copy.deepcopy(src.get(key) or {})
                applied[path] = val
                continue
            if kind in ("int", "num") and not isinstance(val, (int, float)):
                raise ToolInputError(f"'{path}' needs a number")
            if kind == "int":
                if float(val) != int(val):
                    raise ToolInputError(f"'{path}' must be a whole number")
                val = int(val)
            if path == "cell_id":
                self.cells.get(str(val))  # raises NotFound if the AI names a cell that is not in the database
                d.pop("cell", None)
            node = d
            *parents, leaf = path.split(".")
            for p in parents:
                if not isinstance(node.get(p), dict):
                    node[p] = {}
                node = node[p]
            node[leaf] = val
            applied[path] = val
        d["name"] = ref.get("label") or (ref["design_name"] if not applied else f"{ref['design_name']} (variant)")
        d["requirements"] = complete_requirements(self.project.get("requirements"))
        d = _strip_nulls(d)
        try:
            design = DesignInput.model_validate(d)
        except ValidationError as e:
            raise ToolInputError("Design is not valid for evaluation: " + "; ".join(
                f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:6])) from None
        cell = design.cell if design.cell is not None else self.cells.get(design.cell_id)
        return design, cell, applied

    # ------------------------------------------------------------ execution
    def execute(self, name: str, inp: dict) -> ToolCall:
        ref = f"T{len(self.calls) + 1}"
        try:
            fn = getattr(self, f"_t_{name}", None)
            if fn is None:
                raise ToolInputError(f"Unknown tool '{name}'")
            result = {"ref": ref, **fn(inp)}
            call = ToolCall(ref, name, inp, result, True)
        except (ToolInputError, AppError, ComparisonError) as e:
            call = ToolCall(ref, name, inp, {"ref": ref, "error": str(getattr(e, "message", e))}, False)
        self.calls.append(call)
        return call

    def _t_list_cells(self, inp):
        cells = self.cells.list(inp.get("chemistry"))
        return {"cells": [_cell_summary(c) for c in cells], "count": len(cells)}

    def _t_get_cell(self, inp):
        rec = self.cells.get_record(inp["cell_id"])
        return {"cell": rec, "missing_fields": _missing(rec)}

    def _t_get_project_designs(self, inp):
        p = self.project
        return {"project": {"name": p.get("name"), "application": p.get("application")},
                "requirements": complete_requirements(p.get("requirements")), "designs": p.get("designs", [])}

    def _t_evaluate_design(self, inp):
        design, cell, applied = self.build_design(inp)
        return {"design": _design_echo(design, applied, inp["design_name"]), **_compact_eval(evaluate_design(cell, design))}

    def _t_simulate(self, inp):
        design, cell, applied = self.build_design(inp)
        r_ic = mechanical(cell, design).values.get("interconnect_resistance_ohm") or 0.0
        sim = run_simulation(inp["mode"], cell, design, r_ic)
        v = {k: x for k, x in sim.values.items() if k != "timeseries"}
        ts = sim.values.get("timeseries")
        if ts:
            n = len(ts["time_s"])
            idx = sorted({round(i * (n - 1) / 9) for i in range(10)})
            v["timeseries_coarse"] = {k: [ts[k][i] for i in idx] for k in ("time_s", "soc_pct", "pack_voltage_v", "pack_current_a", "cell_temp_c") if ts.get(k)}
        return {"design": _design_echo(design, applied, inp["design_name"]), "model": sim.model.label, "values": v,
                "flags": _flags(sim.flags), "result_type": "ESTIMATE"}

    def _t_safety_checks(self, inp):
        design, cell, applied = self.build_design(inp)
        r = evaluate_design(cell, design)
        b = r["modules"]["bms"]["values"]
        return {"design": _design_echo(design, applied, inp["design_name"]), "checks": b["checks"], "summary": b["summary"],
                "max_safe_charge_current_a": b.get("max_safe_charge_current_a"),
                "binding_constraints": b.get("max_safe_charge_binding_constraints"), "balancing": b.get("balancing"),
                "disclaimer": b["safety_disclaimer"], "flags": _flags(r["modules"]["bms"]["flags"]), "result_type": "ESTIMATE"}

    def _t_compare_designs(self, inp):
        refs = [inp["baseline"], *inp["alternatives"]]
        designs = []
        for i, ref in enumerate(refs):
            design, cell, applied = self.build_design(ref)
            design.role = "baseline" if i == 0 else "alternative"
            designs.append((design, cell))
        names = [d.name for d, _ in designs]
        if len(set(names)) != len(names):
            raise ToolInputError("Each compared design needs a unique label")
        weights = {w["metric"]: w["weight"] for w in inp.get("weights") or []} or None
        c = compare(designs, None, weights)
        return {"weights_used": c["weights_used"], "notes": c["notes"], "recommendation": c["recommendation"],
                "ranking": [{k: r.get(k) for k in ("design_name", "topology", "cell_id", "eligible", "score", "rank", "safety_fails",
                                                    "safety_warnings", "requirements_not_met", "improves_on_baseline", "worse_than_baseline")} for r in c["ranking"]],
                "kpis": {d["design_name"]: {k: v for k, v in d["kpis"].items() if v is not None} for d in c["designs"]},
                "result_type": "ESTIMATE"}

    def _t_sweep_parameter(self, inp):
        vals = inp["values"][:8]
        if not vals:
            raise ToolInputError("values must not be empty")
        metrics = inp.get("metrics") or ["usable_energy_wh", "charge_time_cc_estimate_h", "peak_cell_temp_charge_c", "module_mass_kg"]
        rows = []
        for v in vals:
            ref = {**inp, "changes": [*(inp.get("changes") or []), {"path": inp["parameter"], "value": v}], "label": f"{inp['parameter']}={v}"}
            try:
                design, cell, _ = self.build_design(ref)
                r = evaluate_design(cell, design)
                rows.append({inp["parameter"]: v, **{m: r["kpis"].get(m) for m in metrics},
                             "safety": r["safety_summary"], "requirements_not_met": [q["id"] for q in r["requirements"] if q["status"] == "NOT_MET"]})
            except (ToolInputError, AppError) as e:
                rows.append({inp["parameter"]: v, "error": str(getattr(e, "message", e))})
        return {"base_design": inp["design_name"], "parameter": inp["parameter"], "rows": rows,
                "units": {m: METRICS[m][1] for m in metrics if m in METRICS}, "result_type": "ESTIMATE"}

    def _t_get_model_documentation(self, inp):
        mid = inp.get("model_id")
        ms = [m.model_dump() for m in MODELS if not mid or m.id == mid]
        if not ms:
            raise ToolInputError(f"Unknown model id '{mid}'. Valid: {[m.id for m in MODELS]}")
        return {"models": ms}


# ---------------------------------------------------------------- helpers
CELL_KEYS = ["nominal_voltage_v", "max_voltage_v", "min_voltage_v", "capacity_ah", "internal_resistance_mohm", "max_charge_c_rate",
             "max_discharge_c_rate", "charge_temp_max_c", "discharge_temp_max_c", "mass_kg", "volume_l", "cycle_life_cycles", "unit_cost"]


def _missing(c: dict) -> list[str]:
    out = [k for k in CELL_KEYS if c.get(k) is None]
    if not c.get("dimensions"):
        out.append("dimensions")
    if not c.get("ocv_curve"):
        out.append("ocv_curve")
    return out


def _cell_summary(c: dict) -> dict:
    return {"id": c["id"], "manufacturer": c.get("manufacturer"), "model": c.get("model"), "chemistry": c["chemistry"],
            "form_factor": c.get("form_factor"), "data_status": c["data_status"], "datasheet_ref": c.get("datasheet_ref"),
            **{k: c.get(k) for k in CELL_KEYS if c.get(k) is not None}, "missing_fields": _missing(c)}


def _strip_nulls(x):
    if isinstance(x, dict):
        return {k: _strip_nulls(v) for k, v in x.items() if v is not None and v != "" and not str(k).startswith("_")}
    if isinstance(x, list):
        return [_strip_nulls(v) for v in x]
    return x


def _design_echo(d: DesignInput, applied: dict, base: str) -> dict:
    op = d.operating
    return {"label": d.name, "base_design": base, "changes_applied": applied, "topology": f"{d.series}S{d.parallel}P",
            "cell_id": d.cell.id if d.cell else d.cell_id, "charge_current_a": op.charge_current_a,
            "discharge_current_a": op.discharge_current_a, "discharge_power_w": op.discharge_power_w,
            "ambient_c": op.ambient_c, "cooling": d.thermal.cooling.type.value,
            "r_th_cell_to_ambient_k_per_w": d.thermal.cooling.r_th_cell_to_ambient_k_per_w}


def _flags(flags) -> list[dict]:
    seen, out = set(), []
    for f in flags:
        f = f if isinstance(f, dict) else f.model_dump()
        if f["severity"] == "info" or f["code"] in seen:
            continue
        seen.add(f["code"])
        out.append({"code": f["code"], "severity": f["severity"], "message": f["message"]})
    return out[:20]


def _compact_eval(r: dict) -> dict:
    checks = r["modules"]["bms"]["values"]["checks"]
    return {
        "result_type": r["result_type"],
        "cell": r["cell"],
        "kpis": {k: v for k, v in r["kpis"].items() if v is not None},
        "kpi_units": {k: u for k, u in r["kpi_units"].items() if r["kpis"].get(k) is not None},
        "requirements": [{k: q[k] for k in ("id", "metric", "operator", "target", "value", "status")} for q in r["requirements"]],
        "safety_summary": r["safety_summary"],
        "checks_not_pass": [{k: c[k] for k in ("id", "description", "status", "detail", "limit_source")} for c in checks if c["status"] != "PASS"],
        "models": sorted({m["model"]["label"] for m in r["modules"].values()}),
        "flags": _flags(r["flags"]),
    }


def result_json(call: ToolCall) -> str:
    return json.dumps(call.result, ensure_ascii=False, separators=(",", ":"), default=str)
