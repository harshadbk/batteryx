"""Projects and AI assistant endpoints (prefix /api/v1)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field, model_validator

from app.ai.assistant import comparison_context, design_context, explain, extract_requirements
from app.engine.comparison import ComparisonError, compare
from app.engine.pipeline import evaluate_design
from app.errors import EngineInputError
from app.ratelimit import ai_rate_limit
from app.schemas.design import ComparisonRequest, DesignInput
from app.schemas.project import ProjectIn

router = APIRouter(prefix="/api/v1")


# ------------------------------------------------------------------ projects
@router.get("/projects", tags=["projects"], summary="List projects (summaries)")
def list_projects(request: Request):
    return request.app.state.projects.list()


@router.post("/projects", status_code=status.HTTP_201_CREATED, tags=["projects"], summary="Create a project")
def create_project(p: ProjectIn, request: Request):
    return request.app.state.projects.create(p)


@router.get("/projects/{pid}", tags=["projects"], summary="Get a project with its design drafts")
def get_project(pid: str, request: Request):
    return request.app.state.projects.get(pid)


@router.put("/projects/{pid}", tags=["projects"], summary="Replace a project (save)")
def update_project(pid: str, p: ProjectIn, request: Request):
    return request.app.state.projects.update(pid, p)


@router.delete("/projects/{pid}", status_code=status.HTTP_204_NO_CONTENT, tags=["projects"], summary="Delete a project")
def delete_project(pid: str, request: Request):
    request.app.state.projects.delete(pid)
    request.app.state.conversations.delete_by_project(pid)  # no orphaned copilot conversations


# ------------------------------------------------------------------ AI assistant
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ExplainRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    context_type: Literal["design", "comparison"]
    design: DesignInput | None = None
    comparison: ComparisonRequest | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _ctx(self):
        if self.context_type == "design" and self.design is None:
            raise ValueError("design is required when context_type is 'design'")
        if self.context_type == "comparison" and self.comparison is None:
            raise ValueError("comparison is required when context_type is 'comparison'")
        return self


class ExtractRequest(BaseModel):
    text: str = Field(min_length=3, max_length=4000)


def _cell(d: DesignInput, request: Request):
    return d.cell if d.cell is not None else request.app.state.cells.get(d.cell_id)


@router.get("/ai/status", tags=["ai"], summary="Whether the AI assistant is configured")
def ai_status(request: Request):
    llm = request.app.state.llm
    return {"configured": llm.configured, "provider": llm.provider, "model": llm.model}


@router.post("/ai/explain", dependencies=[Depends(ai_rate_limit)], tags=["ai"], summary="Grounded explanation of engine results (results recomputed server-side)")
def ai_explain(req: ExplainRequest, request: Request):
    if req.context_type == "design":
        ctx = design_context(evaluate_design(_cell(req.design, request), req.design))
    else:
        c = req.comparison
        designs = [(d, _cell(d, request)) for d in [c.baseline, *c.alternatives]]
        try:
            ctx = comparison_context(compare(designs, c.requirements, c.weights))
        except ComparisonError as e:
            raise EngineInputError(str(e)) from e
    return explain(request.app.state.llm, ctx, req.question, [h.model_dump() for h in req.history])


@router.post("/ai/extract-requirements", dependencies=[Depends(ai_rate_limit)], tags=["ai"], summary="Natural language → proposed requirements (confirm before use)")
def ai_extract(req: ExtractRequest, request: Request):
    return extract_requirements(request.app.state.llm, req.text)
