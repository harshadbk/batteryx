"""Shared helpers: flag collection, physical constants, small numeric utilities."""
from __future__ import annotations

import math

from app.schemas.cell import CellSpec, DataStatus
from app.schemas.results import Flag

# Handbook material properties at 20 °C (physical constants, not cell specifications).
MATERIALS = {
    "copper": {"resistivity_ohm_m": 1.724e-8, "density_kg_m3": 8960.0},  # IACS annealed copper
    "aluminium": {"resistivity_ohm_m": 2.82e-8, "density_kg_m3": 2700.0},
}


class Flags:
    """Collects flags for one module run."""

    def __init__(self, module: str):
        self.module = module
        self.items: list[Flag] = []

    def add(self, severity: str, code: str, message: str, field: str | None = None) -> None:
        if any(f.code == code and f.field == field for f in self.items):
            return
        self.items.append(Flag(severity=severity, code=code, message=message, field=field, module=self.module))

    def missing(self, field: str, needed_for: str) -> None:
        self.add("missing_input", "MISSING_INPUT", f"'{field}' not provided: {needed_for} not calculated.", field)

    def assume(self, code: str, message: str, field: str | None = None) -> None:
        self.add("assumption", code, message, field)


def cell_provenance_flags(cell: CellSpec, flags: Flags) -> None:
    if cell.data_status == DataStatus.ILLUSTRATIVE_EXAMPLE:
        flags.add("warning", "ILLUSTRATIVE_CELL",
                  f"Cell '{cell.id}' uses illustrative example values, not a real product datasheet. "
                  "Replace with the selected cell's datasheet before drawing conclusions.", "cell")
    elif cell.data_status == DataStatus.USER_ENTERED:
        flags.add("info", "USER_ENTERED_CELL",
                  f"Cell '{cell.id}' values are user-entered; the platform has not verified them against a datasheet.", "cell")


def r0_ohm(cell: CellSpec) -> float | None:
    return None if cell.internal_resistance_mohm is None else cell.internal_resistance_mohm / 1000.0


def resistance_type_flag(cell: CellSpec, flags: Flags) -> None:
    rt = (cell.resistance_type or "").upper()
    if cell.internal_resistance_mohm is not None and "AC" in rt:
        flags.add("warning", "ACIR_USED",
                  "Cell resistance is an AC (1 kHz) value; DC resistance under load is typically higher, "
                  "so heat and voltage drop are likely underestimated.", "cell.internal_resistance_mohm")
    elif cell.internal_resistance_mohm is not None and not rt:
        flags.add("info", "R_TYPE_UNKNOWN",
                  "Cell resistance measurement method not stated (AC vs DC); heat estimate accuracy depends on it.",
                  "cell.resistance_type")


def rnd(x: float | None, d: int = 4) -> float | None:
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), d)
