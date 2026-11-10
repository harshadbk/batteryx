"""Cell specification schema.

Every field except the identity, chemistry, nominal voltage and capacity is optional.
Missing fields are never filled with invented values: the engine flags each calculation
that cannot run, or that falls back to an explicitly labelled assumption.
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, model_validator


class Chemistry(str, Enum):
    LFP = "LFP"
    NMC = "NMC"
    NCA = "NCA"
    LTO = "LTO"
    LMO = "LMO"
    OTHER = "other"


class FormFactor(str, Enum):
    CYLINDRICAL = "cylindrical"
    PRISMATIC = "prismatic"
    POUCH = "pouch"


class DataStatus(str, Enum):
    DATASHEET = "datasheet"  # transcribed from a cited manufacturer datasheet (datasheet_ref required)
    USER_ENTERED = "user_entered"  # entered by a user; source not verified by the platform
    ILLUSTRATIVE_EXAMPLE = "illustrative_example"  # demo values, NOT a real product


class OcvPoint(BaseModel):
    soc: float = Field(ge=0, le=1, description="State of charge, fraction 0..1")
    ocv_v: float = Field(gt=0, lt=6, description="Open-circuit voltage at this SOC [V]")


class CellDimensions(BaseModel):
    """Cylindrical cells use diameter_mm + height_mm. Prismatic/pouch use length_mm (footprint
    long side), width_mm (thickness) and height_mm (terminal direction)."""

    diameter_mm: float | None = Field(None, gt=0, le=500)
    length_mm: float | None = Field(None, gt=0, le=2000)
    width_mm: float | None = Field(None, gt=0, le=2000)
    height_mm: float | None = Field(None, gt=0, le=2000)


class CellSpec(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_.\-]{2,64}$")
    manufacturer: str | None = None
    model: str | None = None
    chemistry: Chemistry
    form_factor: FormFactor | None = None

    nominal_voltage_v: float = Field(gt=0, lt=6)
    max_voltage_v: float | None = Field(None, gt=0, lt=6, description="Charge cut-off voltage [V]")
    min_voltage_v: float | None = Field(None, gt=0, lt=6, description="Discharge cut-off voltage [V]")
    capacity_ah: float = Field(gt=0, le=2000, description="Rated capacity [Ah]")

    internal_resistance_mohm: float | None = Field(None, gt=0, le=1000, description="Ohmic resistance R0 [mΩ]")
    resistance_type: str | None = Field(None, description='How R was measured, e.g. "DCIR 10 s" or "ACIR 1 kHz"')
    rc_r1_mohm: float | None = Field(None, gt=0, le=1000, description="Polarisation resistance R1 of a 1-RC model [mΩ]")
    rc_c1_f: float | None = Field(None, gt=0, le=1e7, description="Polarisation capacitance C1 [F]")

    max_charge_c_rate: float | None = Field(None, gt=0, le=100)
    max_discharge_c_rate: float | None = Field(None, gt=0, le=100)
    charge_temp_min_c: float | None = Field(None, ge=-60, le=100)
    charge_temp_max_c: float | None = Field(None, ge=-60, le=100)
    discharge_temp_min_c: float | None = Field(None, ge=-60, le=100)
    discharge_temp_max_c: float | None = Field(None, ge=-60, le=100)

    mass_kg: float | None = Field(None, gt=0, le=50)
    volume_l: float | None = Field(None, gt=0, le=50)
    dimensions: CellDimensions | None = None
    specific_heat_j_per_kgk: float | None = Field(None, gt=0, le=5000)

    ocv_curve: list[OcvPoint] | None = None

    cycle_life_cycles: int | None = Field(None, gt=0, le=100000)
    cycle_life_eol_capacity_pct: float | None = Field(None, ge=50, lt=100)
    cycle_life_conditions: str | None = None

    unit_cost: float | None = Field(None, ge=0)
    currency: str | None = None

    data_status: DataStatus
    datasheet_ref: str | None = Field(None, description="Citation / URL / document id of the datasheet")
    notes: str | None = None

    @model_validator(mode="after")
    def _check(self) -> "CellSpec":
        if self.max_voltage_v is not None and self.max_voltage_v <= self.nominal_voltage_v:
            raise ValueError("max_voltage_v must be greater than nominal_voltage_v")
        if self.min_voltage_v is not None and self.min_voltage_v >= self.nominal_voltage_v:
            raise ValueError("min_voltage_v must be less than nominal_voltage_v")
        for lo, hi, name in (
            (self.charge_temp_min_c, self.charge_temp_max_c, "charge"),
            (self.discharge_temp_min_c, self.discharge_temp_max_c, "discharge"),
        ):
            if lo is not None and hi is not None and lo >= hi:
                raise ValueError(f"{name}_temp_min_c must be below {name}_temp_max_c")
        if (self.rc_r1_mohm is None) != (self.rc_c1_f is None):
            raise ValueError("rc_r1_mohm and rc_c1_f must be given together")
        if self.ocv_curve is not None:
            pts = self.ocv_curve
            if len(pts) < 2:
                raise ValueError("ocv_curve needs at least 2 points")
            socs = [p.soc for p in pts]
            if any(b <= a for a, b in zip(socs, socs[1:])):
                raise ValueError("ocv_curve SOC values must be strictly increasing")
            ocvs = [p.ocv_v for p in pts]
            if any(b < a for a, b in zip(ocvs, ocvs[1:])):
                raise ValueError("ocv_curve OCV must be non-decreasing with SOC")
        if self.data_status == DataStatus.DATASHEET and not self.datasheet_ref:
            raise ValueError("datasheet_ref is required when data_status is 'datasheet'")
        if self.unit_cost is not None and not self.currency:
            raise ValueError("currency is required when unit_cost is given")
        return self
