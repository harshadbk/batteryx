"""REST API (prefix /api/v1)."""
from __future__ import annotations

import json
from pathlib import Path
from fastapi import APIRouter, Depends, Query, Request, status

from app.db.repository import CellStore
from app.engine import ageing as ageing_m
from app.engine import bms as bms_m
from app.engine import configuration as cfg_m
from app.engine import cost as cost_m
from app.engine import electrical as el_m
from app.engine import energy as en_m
from app.engine import estimates as est_m
from app.engine import mechanical as mech_m
from app.engine import thermal as th_m
from app.engine import variation as var_m
from app.engine.comparison import ComparisonError, compare
from app.engine.pipeline import METRICS, evaluate_design
from app.engine.registry import MODELS
from app.errors import ConflictError, EngineInputError
from app.schemas.cell import CellSpec
from app.schemas.design import ComparisonRequest, DesignInput, VariationRequest
from app.schemas.results import ModelInfo, ModuleResult

router = APIRouter(prefix="/api/v1")
EXAMPLES = Path(__file__).resolve().parent.parent / "data" / "example_designs.json"


def get_cells(request: Request) -> CellStore:
    return request.app.state.cells


def resolve_cell(d: DesignInput, db: CellStore) -> CellSpec:
    return d.cell if d.cell is not None else db.get(d.cell_id)


# ------------------------------------------------------------------ metadata
@router.get("/models", response_model=list[ModelInfo], tags=["metadata"], summary="All engineering models with equations and assumptions")
def list_models():
    return MODELS


@router.get("/metrics", tags=["metadata"], summary="Comparable KPI metrics, units and better-direction")
def list_metrics():
    return {k: {"label": l, "unit": u, "better": b} for k, (l, u, b) in METRICS.items()}


@router.get("/examples/designs", tags=["metadata"], summary="Stage-1 prototype designs A/B/C (illustrative inputs)")
def example_designs():
    return json.loads(EXAMPLES.read_text(encoding="utf-8"))


# ------------------------------------------------------------------ cell database
@router.get("/cells", tags=["cells"], summary="List cells")
def list_cells(chemistry: str | None = Query(None), db: CellStore = Depends(get_cells)):
    return db.list(chemistry)


@router.get("/cells/{cell_id}", tags=["cells"], summary="Get one cell")
def get_cell(cell_id: str, db: CellStore = Depends(get_cells)):
    return db.get_record(cell_id)


@router.post("/cells", status_code=status.HTTP_201_CREATED, tags=["cells"], summary="Add a cell (datasheet_ref required for data_status='datasheet')")
def create_cell(cell: CellSpec, db: CellStore = Depends(get_cells)):
    return db.create(cell)


@router.delete("/cells/{cell_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["cells"], summary="Delete a user-added cell")
def delete_cell(cell_id: str, request: Request, db: CellStore = Depends(get_cells)):
    projects = request.app.state.projects
    users = [f"{p['name']} / {d.get('name')}" for s in projects.list() for p in [projects.get(s["id"]).model_dump()]
             for d in p["designs"] if d.get("cell_id") == cell_id]
    if users:
        raise ConflictError(f"Cell '{cell_id}' is used by {len(users)} design(s): {', '.join(users[:5])}. Change those designs first.")
    db.delete(cell_id)


# ------------------------------------------------------------------ single modules
def _interconnect(cell: CellSpec, d: DesignInput) -> float:
    return mech_m.mechanical(cell, d).values.get("interconnect_resistance_ohm") or 0.0


def _est(cell, d):
    en = en_m.energy(cell, d, _interconnect(cell, d))
    return en, est_m.estimates(cell, d, en.values)


@router.post("/configuration", response_model=ModuleResult, tags=["modules"], summary="Series-parallel configuration")
def r_configuration(d: DesignInput, db: CellStore = Depends(get_cells)):
    return cfg_m.configure(resolve_cell(d, db), d.series, d.parallel)


@router.post("/energy", response_model=ModuleResult, tags=["modules"], summary="Energy and power")
def r_energy(d: DesignInput, db: CellStore = Depends(get_cells)):
    cell = resolve_cell(d, db)
    return en_m.energy(cell, d, _interconnect(cell, d))


@router.post("/estimates", response_model=ModuleResult, tags=["modules"], summary="Closed-form charge/discharge time estimates")
def r_estimates(d: DesignInput, db: CellStore = Depends(get_cells)):
    return _est(resolve_cell(d, db), d)[1]


@router.post("/thermal", response_model=ModuleResult, tags=["modules"], summary="SIMPLIFIED lumped thermal estimate")
def r_thermal(d: DesignInput, db: CellStore = Depends(get_cells)):
    cell = resolve_cell(d, db)
    return th_m.thermal(cell, d, _est(cell, d)[1].values)


@router.post("/simulate/charge", response_model=ModuleResult, tags=["simulation"], summary="Time-domain CC-CV charge (1-RC ECM + lumped thermal)")
def r_sim_charge(d: DesignInput, db: CellStore = Depends(get_cells)):
    cell = resolve_cell(d, db)
    return el_m.run_simulation("charge", cell, d, _interconnect(cell, d))


@router.post("/simulate/discharge", response_model=ModuleResult, tags=["simulation"], summary="Time-domain CC/CP discharge (1-RC ECM + lumped thermal)")
def r_sim_discharge(d: DesignInput, db: CellStore = Depends(get_cells)):
    cell = resolve_cell(d, db)
    return el_m.run_simulation("discharge", cell, d, _interconnect(cell, d))


@router.post("/ageing", response_model=ModuleResult, tags=["modules"], summary="SIMPLIFIED ageing assumption")
def r_ageing(d: DesignInput, db: CellStore = Depends(get_cells)):
    return ageing_m.ageing(resolve_cell(d, db), d)


@router.post("/bms", response_model=ModuleResult, tags=["modules"], summary="BMS monitoring and safety rule checks")
def r_bms(d: DesignInput, db: CellStore = Depends(get_cells)):
    cell = resolve_cell(d, db)
    r_ic = _interconnect(cell, d)
    _, est = _est(cell, d)
    ch = el_m.run_simulation("charge", cell, d, r_ic)
    dis = el_m.run_simulation("discharge", cell, d, r_ic)
    return bms_m.bms(cell, d, est.values, ch.values, dis.values)


@router.post("/mechanical", response_model=ModuleResult, tags=["modules"], summary="Mass, dimensions and busbar estimate")
def r_mechanical(d: DesignInput, db: CellStore = Depends(get_cells)):
    return mech_m.mechanical(resolve_cell(d, db), d)


@router.post("/cost", response_model=ModuleResult, tags=["modules"], summary="Estimated cost / relative cost index")
def r_cost(d: DesignInput, db: CellStore = Depends(get_cells)):
    cell = resolve_cell(d, db)
    en = en_m.energy(cell, d, _interconnect(cell, d))
    return cost_m.cost(cell, d, en.values["nominal_energy_wh"])


@router.post("/variation", response_model=ModuleResult, tags=["modules"], summary="Monte-Carlo cell-variation sweep (seeded)")
def r_variation(req: VariationRequest, db: CellStore = Depends(get_cells)):
    return var_m.variation(resolve_cell(req.design, db), req.design, req.variation)


# ------------------------------------------------------------------ full design + comparison
@router.post("/designs/evaluate", tags=["designs"], summary="Run every module on one design")
def r_evaluate(d: DesignInput, db: CellStore = Depends(get_cells)):
    return evaluate_design(resolve_cell(d, db), d)


@router.post("/designs/compare", tags=["designs"], summary="Compare a baseline with alternative designs")
def r_compare(req: ComparisonRequest, db: CellStore = Depends(get_cells)):
    if req.baseline.role != "baseline":
        req.baseline.role = "baseline"
    for a in req.alternatives:
        a.role = "alternative"
    designs = [(d, resolve_cell(d, db)) for d in [req.baseline, *req.alternatives]]
    try:
        return compare(designs, req.requirements, req.weights)
    except ComparisonError as e:
        raise EngineInputError(str(e)) from e
