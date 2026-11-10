"""Design input schema: one battery module design (baseline or alternative).

Conventions: SI-derived units encoded in field names (_v, _a, _ah, _wh, _c, _k, _kg, _mm, _pct).
Optional fields left as None are flagged by the engine when a calculation needs them.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .cell import CellSpec

MAX_SERIES = 32
MAX_PARALLEL = 16


class CoolingType(str, Enum):
    NATURAL_CONVECTION = "natural_convection"
    HEAT_SPREADER = "heat_spreader"
    FORCED_AIR = "forced_air"
    LIQUID_COLD_PLATE = "liquid_cold_plate"
    CUSTOM = "custom"


class CoolingInput(BaseModel):
    """Cooling is reduced to one lumped cell-to-ambient thermal resistance R_th.
    Give R_th directly, or a convection coefficient h (R_th = 1 / (h * A_exposed))."""

    type: CoolingType = CoolingType.NATURAL_CONVECTION
    r_th_cell_to_ambient_k_per_w: float | None = Field(None, gt=0, le=1000)
    h_w_per_m2k: float | None = Field(None, gt=0, le=100000)
    exposed_area_fraction: float | None = Field(None, gt=0, le=1)
    added_mass_per_cell_kg: float = Field(0.0, ge=0, le=10)
    added_volume_factor: float = Field(1.0, ge=1, le=3, description="Multiplier on module volume")
    added_cost_per_cell: float = Field(0.0, ge=0, description="Currency cost per cell (same currency as cost inputs)")
    relative_cost_per_cell: float = Field(0.0, ge=0, description="Relative-index cost per cell (one cell = 1.0)")
    source_note: str | None = None


class ThermalInput(BaseModel):
    cell_specific_heat_j_per_kgk: float | None = Field(None, gt=0, le=5000)
    cooling: CoolingInput = CoolingInput()


class OperatingInput(BaseModel):
    ambient_c: float | None = Field(None, ge=-40, le=80)
    soc_min_pct: float = Field(0, ge=0, lt=100, description="Lower bound of the usable SOC window")
    soc_max_pct: float = Field(100, gt=0, le=100, description="Upper bound of the usable SOC window")
    charge_current_a: float | None = Field(None, gt=0, le=5000, description="Pack charge current (CC phase)")
    charge_start_soc_pct: float | None = Field(None, ge=0, lt=100)
    charge_target_soc_pct: float | None = Field(None, gt=0, le=100)
    cv_cutoff_c_rate: float | None = Field(None, gt=0, le=1)
    discharge_current_a: float | None = Field(None, gt=0, le=5000)
    discharge_power_w: float | None = Field(None, gt=0, le=1e6)

    @model_validator(mode="after")
    def _check(self) -> "OperatingInput":
        if self.soc_min_pct >= self.soc_max_pct:
            raise ValueError("soc_min_pct must be below soc_max_pct")
        start = self.charge_start_soc_pct if self.charge_start_soc_pct is not None else self.soc_min_pct
        target = self.charge_target_soc_pct if self.charge_target_soc_pct is not None else self.soc_max_pct
        if start >= target:
            raise ValueError("charge start SOC must be below charge target SOC")
        if self.discharge_current_a is not None and self.discharge_power_w is not None:
            raise ValueError("give discharge_current_a OR discharge_power_w, not both")
        return self


class LimitsInput(BaseModel):
    """Engineer-set protection and monitoring limits (not datasheet values)."""

    max_cell_temp_charge_c: float | None = Field(None, ge=-20, le=100)
    max_cell_temp_discharge_c: float | None = Field(None, ge=-20, le=100)
    temp_warning_margin_k: float | None = Field(None, ge=0, le=30)
    fuse_rating_a: float | None = Field(None, gt=0, le=10000)
    bms_max_charge_current_a: float | None = Field(None, gt=0, le=10000)
    bms_max_discharge_current_a: float | None = Field(None, gt=0, le=10000)
    temp_sensors_fitted: int | None = Field(None, ge=0, le=1000)
    max_cells_per_temp_sensor: int | None = Field(None, ge=1, le=1000)
    voltage_sense_channels: int | None = Field(None, ge=0, le=1000)
    balancing_current_a: float | None = Field(None, gt=0, le=50)
    soc_imbalance_pct: float | None = Field(None, gt=0, le=50)


class BusbarMaterial(str, Enum):
    COPPER = "copper"
    ALUMINIUM = "aluminium"


class BusbarInput(BaseModel):
    material: BusbarMaterial
    current_density_a_per_mm2: float = Field(gt=0, le=20, description="Engineer-chosen allowable current density")
    thickness_mm: float = Field(gt=0, le=20)


class MechanicalInput(BaseModel):
    arrangement_rows: int | None = Field(None, ge=1, le=512, description="Rows in the cell grid (default: one row per series group)")
    cell_gap_mm: float | None = Field(None, ge=0, le=100)
    wall_thickness_mm: float | None = Field(None, ge=0, le=100)
    top_clearance_mm: float | None = Field(None, ge=0, le=500)
    housing_mass_kg: float | None = Field(None, ge=0, le=500)
    bms_mass_kg: float | None = Field(None, ge=0, le=50)
    interconnect_mass_per_cell_kg: float | None = Field(None, ge=0, le=5)
    volume_packing_factor: float | None = Field(None, ge=1, le=5, description="Used only when cell dimensions are missing")
    busbar: BusbarInput | None = None


class CostInput(BaseModel):
    currency: str | None = None
    cell_unit_cost: float | None = Field(None, ge=0, description="Overrides the cell database unit cost")
    bms_cost: float | None = Field(None, ge=0)
    housing_cost: float | None = Field(None, ge=0)
    other_cost: float | None = Field(None, ge=0)
    relative_bms_cost: float | None = Field(None, ge=0, description="Relative index units (one cell = 1.0)")


class AgeingInput(BaseModel):
    method: Literal["none", "linear_cycle_life", "user_rates"] = "none"
    cycles: int | None = Field(None, ge=0, le=100000)
    capacity_fade_pct_per_100_cycles: float | None = Field(None, ge=0, le=50)
    resistance_growth_pct_per_100_cycles: float | None = Field(None, ge=0, le=200)


class Requirement(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    metric: str
    operator: Literal[">=", "<="]
    value: float
    unit: str | None = None
    description: str | None = None


class SimulationSettings(BaseModel):
    time_step_s: float = Field(1.0, ge=0.1, le=60)
    max_duration_h: float = Field(24.0, gt=0, le=200)
    output_points: int = Field(200, ge=10, le=5000)

    @model_validator(mode="after")
    def _steps(self) -> "SimulationSettings":
        steps = self.max_duration_h * 3600 / self.time_step_s
        if steps > 400_000:
            raise ValueError(f"max_duration_h / time_step_s gives {steps:,.0f} steps; limit is 400,000 (raise time_step_s or lower max_duration_h)")
        return self


class DesignInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    role: Literal["baseline", "alternative"] = "baseline"
    description: str | None = None
    cell_id: str | None = None
    cell: CellSpec | None = None
    series: int = Field(ge=1, le=MAX_SERIES)
    parallel: int = Field(ge=1, le=MAX_PARALLEL)
    operating: OperatingInput = OperatingInput()
    thermal: ThermalInput = ThermalInput()
    limits: LimitsInput = LimitsInput()
    mechanical: MechanicalInput = MechanicalInput()
    cost: CostInput = CostInput()
    ageing: AgeingInput = AgeingInput()
    requirements: list[Requirement] = []
    simulation: SimulationSettings = SimulationSettings()

    @model_validator(mode="after")
    def _check(self) -> "DesignInput":
        if (self.cell_id is None) == (self.cell is None):
            raise ValueError("give exactly one of cell_id (database cell) or cell (inline spec)")
        return self


class VariationInput(BaseModel):
    samples: int = Field(400, ge=10, le=20000)
    capacity_tolerance_pct: float = Field(ge=0, le=50)
    resistance_tolerance_pct: float = Field(ge=0, le=100)
    tolerance_is_3_sigma: bool = True
    seed: int = 7


class VariationRequest(BaseModel):
    design: DesignInput
    variation: VariationInput

    @model_validator(mode="after")
    def _size(self) -> "VariationRequest":
        n = self.variation.samples * self.design.series * self.design.parallel
        if n > 1_000_000:
            raise ValueError(f"samples × cells = {n:,} exceeds 1,000,000; reduce samples")
        return self


class ComparisonRequest(BaseModel):
    baseline: DesignInput
    alternatives: list[DesignInput] = Field(min_length=1, max_length=5)
    requirements: list[Requirement] | None = Field(None, description="Applied to every design; default = baseline's")
    weights: dict[str, float] | None = Field(None, description="Metric weights for the preference score")
