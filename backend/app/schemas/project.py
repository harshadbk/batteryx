"""Project: a named container of design drafts (baseline + alternatives) and shared requirements.
Designs are stored as drafts: a design may not yet have a cell selected while it is being configured."""
from __future__ import annotations

from typing import Any

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .design import Requirement


class RequirementDraft(BaseModel):
    """A requirement as stored in a project. While it is being edited the target value or id may still be empty;
    only complete requirements (see complete_requirements) are passed to the engine."""
    id: str = Field("", max_length=32)
    metric: str
    operator: Literal[">=", "<="] = ">="
    value: float | None = None
    unit: str | None = None
    description: str | None = None


def complete_requirements(reqs: list[dict] | None) -> list[dict]:
    """Requirements that are valid engine inputs; incomplete drafts are skipped."""
    out = []
    for r in reqs or []:
        try:
            out.append(Requirement.model_validate(r).model_dump())
        except Exception:
            continue
    return out


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)
    application: str | None = Field(None, max_length=500)
    designs: list[dict[str, Any]] = Field(default_factory=list, max_length=20,
                                          description="Design drafts (DesignInput shape; validated when evaluated)")
    requirements: list[RequirementDraft] = Field(default_factory=list)

    @field_validator("designs")
    @classmethod
    def _names(cls, v: list[dict]) -> list[dict]:
        names = [d.get("name") for d in v]
        if any(not isinstance(n, str) or not n.strip() for n in names):
            raise ValueError("every design needs a non-empty name")
        if len(set(names)) != len(names):
            raise ValueError("design names must be unique within a project")
        return v


class Project(ProjectIn):
    id: str
    created_at: str
    updated_at: str
