"""Structured result envelope shared by every engine module."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

Severity = Literal["info", "assumption", "warning", "missing_input", "unsupported"]
Fidelity = Literal["closed_form", "simplified_time_domain", "simplified_assumption", "rule_check", "statistical", "aggregation"]
CheckStatus = Literal["PASS", "WARN", "FAIL", "NOT_EVALUATED"]

RESULT_TYPE = "ESTIMATE"
DISCLAIMER = (
    "All values are model estimates computed from the stated inputs and assumptions. "
    "They are not measured results, are not validated against test data, and do not "
    "constitute a safety certification. Engineer review and physical testing are required."
)


class Flag(BaseModel):
    severity: Severity
    code: str
    message: str
    field: str | None = None
    module: str | None = None


class ModelInfo(BaseModel):
    id: str
    version: str
    fidelity: Fidelity
    label: str
    equations: list[str] = []
    assumptions: list[str] = []


class ModuleResult(BaseModel):
    module: str
    model: ModelInfo
    values: dict[str, Any]
    flags: list[Flag] = []
    result_type: str = RESULT_TYPE


class Check(BaseModel):
    id: str
    subsystem: str
    description: str
    status: CheckStatus
    value: float | None = None
    limit: float | None = None
    unit: str | None = None
    limit_source: str | None = None
    basis: str | None = None
    detail: str
