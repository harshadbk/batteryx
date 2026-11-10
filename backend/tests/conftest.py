import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402
from app.schemas.cell import CellSpec  # noqa: E402
from app.schemas.design import DesignInput  # noqa: E402

# SYNTHETIC TEST CELL: round numbers chosen only to verify equations by hand.
# It is NOT a real product and must never be presented as one.
SYNTHETIC_CELL = {
    "id": "TEST-SYNTHETIC",
    "chemistry": "other",
    "form_factor": "prismatic",
    "nominal_voltage_v": 3.0,
    "max_voltage_v": 3.5,
    "min_voltage_v": 2.5,
    "capacity_ah": 10.0,
    "internal_resistance_mohm": 10.0,
    "resistance_type": "DCIR",
    "max_charge_c_rate": 1.0,
    "max_discharge_c_rate": 2.0,
    "charge_temp_min_c": 0,
    "charge_temp_max_c": 45,
    "discharge_temp_min_c": -10,
    "discharge_temp_max_c": 55,
    "mass_kg": 0.5,
    "volume_l": 0.2,
    "dimensions": {"length_mm": 100, "width_mm": 20, "height_mm": 100},
    "specific_heat_j_per_kgk": 1000,
    "ocv_curve": [{"soc": 0.0, "ocv_v": 2.6}, {"soc": 1.0, "ocv_v": 3.4}],
    "cycle_life_cycles": 2000,
    "cycle_life_eol_capacity_pct": 80,
    "cycle_life_conditions": "synthetic",
    "unit_cost": 10.0,
    "currency": "XTS",
    "data_status": "user_entered",
    "notes": "Synthetic test fixture, not a real product.",
}


def make_design(**over) -> DesignInput:
    base = {
        "name": "T", "cell": copy.deepcopy(SYNTHETIC_CELL), "series": 4, "parallel": 2,
        "operating": {"ambient_c": 25, "soc_min_pct": 10, "soc_max_pct": 90, "charge_current_a": 10,
                      "charge_start_soc_pct": 20, "charge_target_soc_pct": 80, "discharge_current_a": 10},
        "thermal": {"cooling": {"type": "custom", "r_th_cell_to_ambient_k_per_w": 5}},
        "limits": {"max_cell_temp_charge_c": 45, "temp_warning_margin_k": 2, "fuse_rating_a": 30,
                   "bms_max_charge_current_a": 20, "bms_max_discharge_current_a": 25,
                   "temp_sensors_fitted": 4, "max_cells_per_temp_sensor": 2, "voltage_sense_channels": 4},
    }
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            base[k] = {**base[k], **v}
        else:
            base[k] = v
    return DesignInput.model_validate(base)


@pytest.fixture
def cell() -> CellSpec:
    return CellSpec.model_validate(SYNTHETIC_CELL)


@pytest.fixture
def client():
    return TestClient(create_app("sqlite://"))


@pytest.fixture
def samples():
    def load(name):
        return json.loads((ROOT / "samples" / name).read_text(encoding="utf-8"))
    return load
