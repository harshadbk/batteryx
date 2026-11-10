# BatteryX API reference (v1)

Base URL: `http://localhost:8000`. JSON in, JSON out. Interactive docs: `/docs`.

## Conventions

- Units are encoded in field names: `_v` volts, `_a` amps, `_ah`, `_wh`, `_w`, `_h` hours,
  `_min`, `_s`, `_c` °C, `_k` kelvin, `_kg`, `_l` litres, `_mm`, `_pct` percent, `_ohm`, `_mohm`.
- `null` means *not computable from the given inputs*. A flag always explains why.
- **Module result** (all single-module endpoints):
  ```json
  { "module": "thermal", "result_type": "ESTIMATE",
    "model": { "id", "version", "fidelity", "label", "equations": [], "assumptions": [] },
    "values": { ... },
    "flags": [ { "severity", "code", "message", "field", "module" } ] }
  ```
  `severity` ∈ `missing_input` · `unsupported` · `assumption` · `warning` · `info`.
- **Errors**: `{"error": {"code", "message", "details"}}`.
  | HTTP | code | when |
  |---|---|---|
  | 404 | `not_found` | unknown cell id |
  | 409 | `conflict` | duplicate cell id, deleting a seeded cell |
  | 422 | `validation_error` | schema/range/consistency violation (details list each field) |
  | 422 | `engine_input_error` | invalid comparison (duplicate names, bad weights) |
  | 500 | `internal_error` | unexpected |

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | status, version, active database backend (no credentials) |
| GET | `/api/v1/models` | | every model's equations and assumptions |
| GET | `/api/v1/metrics` | | KPI keys, units, better-direction |
| GET | `/api/v1/examples/designs` | | stage-1 designs A/B/C |
| GET | `/api/v1/cells?chemistry=LFP` | | cell list |
| GET | `/api/v1/cells/{id}` | | one cell |
| POST | `/api/v1/cells` | CellSpec | 201 created cell |
| DELETE | `/api/v1/cells/{id}` | | 204 (user-added cells only) |
| POST | `/api/v1/configuration` | DesignInput | series-parallel sizing |
| POST | `/api/v1/energy` | DesignInput | energy, power, C-rates, ohmic efficiency |
| POST | `/api/v1/estimates` | DesignInput | closed-form charge/discharge time |
| POST | `/api/v1/simulate/charge` | DesignInput | CC-CV time-domain run + time series |
| POST | `/api/v1/simulate/discharge` | DesignInput | CC or CP time-domain run + time series |
| POST | `/api/v1/thermal` | DesignInput | SIMPLIFIED lumped thermal estimate |
| POST | `/api/v1/ageing` | DesignInput | SIMPLIFIED ageing assumption |
| POST | `/api/v1/bms` | DesignInput | rule checks, max safe charge current, balancing |
| POST | `/api/v1/mechanical` | DesignInput | envelope, volume, mass breakdown, busbars |
| POST | `/api/v1/cost` | DesignInput | currency estimate and/or relative index |
| POST | `/api/v1/variation` | `{design, variation}` | Monte-Carlo percentiles |
| POST | `/api/v1/designs/evaluate` | DesignInput | all modules + KPIs + requirements + flags |
| POST | `/api/v1/designs/compare` | `{baseline, alternatives[], requirements?, weights?}` | ranking, deltas, recommendation |
| GET | `/api/v1/projects` | | project summaries (newest first) |
| POST | `/api/v1/projects` | `{name, application?, description?, designs[], requirements[]}` | 201 project |
| GET / PUT / DELETE | `/api/v1/projects/{id}` | project body for PUT | project / 204 |
| GET | `/api/v1/ai/status` | | `{configured, provider, model}` |
| POST | `/api/v1/ai/explain` | `{question, context_type: design\|comparison, design?, comparison?, history[]}` | `{answer, grounding{numbers_checked, ungrounded_numbers, passed}, provider, model, label}` |
| POST | `/api/v1/ai/extract-requirements` | `{text}` | `{source: ai\|rule_based_parser, requirements[], rejected[], unmapped[], note}` |

**Projects** store design *drafts* (a design may not yet have a cell). Drafts are validated when evaluated.
Design names must be unique within a project.

**AI** never receives client-supplied numbers as context. The backend re-runs the engine for the given
design or comparison and sends only those results to the model. Every number in the answer is checked
against them (`grounding`). Extracted requirements are rejected if their value does not appear in the
input text. Errors: `503 ai_unavailable` (no key), `429 ai_rate_limited`, `502 ai_provider_error`.

## DesignInput

| Field | Type | Notes |
|---|---|---|
| `name` | str | unique within a comparison |
| `role` | `baseline` \| `alternative` | |
| `cell_id` **or** `cell` | str / CellSpec | exactly one: database cell or inline spec |
| `series`, `parallel` | int | 1–32, 1–16 (module scope) |
| `operating` | object | `ambient_c`, `soc_min_pct`, `soc_max_pct`, `charge_current_a`, `charge_start_soc_pct`, `charge_target_soc_pct`, `cv_cutoff_c_rate`, `discharge_current_a` **or** `discharge_power_w` |
| `thermal` | object | `cell_specific_heat_j_per_kgk`, `cooling{type, r_th_cell_to_ambient_k_per_w \| h_w_per_m2k, exposed_area_fraction, added_mass_per_cell_kg, added_volume_factor, added_cost_per_cell, relative_cost_per_cell, source_note}` |
| `limits` | object | engineer-set: `max_cell_temp_charge_c`, `max_cell_temp_discharge_c`, `temp_warning_margin_k`, `fuse_rating_a`, `bms_max_charge_current_a`, `bms_max_discharge_current_a`, `temp_sensors_fitted`, `max_cells_per_temp_sensor`, `voltage_sense_channels`, `balancing_current_a`, `soc_imbalance_pct` |
| `mechanical` | object | `arrangement_rows`, `cell_gap_mm`, `wall_thickness_mm`, `top_clearance_mm`, `housing_mass_kg`, `bms_mass_kg`, `interconnect_mass_per_cell_kg`, `volume_packing_factor`, `busbar{material, current_density_a_per_mm2, thickness_mm}` |
| `cost` | object | `currency`, `cell_unit_cost`, `bms_cost`, `housing_cost`, `other_cost`, `relative_bms_cost` |
| `ageing` | object | `method` (`none` \| `linear_cycle_life` \| `user_rates`), `cycles`, `capacity_fade_pct_per_100_cycles`, `resistance_growth_pct_per_100_cycles` |
| `requirements` | list | `{id, metric, operator: ">=" \| "<=", value, unit?, description?}`; metric from `/metrics` |
| `simulation` | object | `time_step_s` (1), `max_duration_h` (24), `output_points` (200) |

Validation examples: `soc_min_pct < soc_max_pct`; charge start < target; not both discharge
current and power; `min_voltage < nominal < max_voltage`; strictly increasing OCV-table SOC;
`datasheet_ref` required when `data_status = datasheet`; `rc_r1_mohm` and `rc_c1_f` given together.

## CellSpec

Required fields: `id`, `chemistry`, `nominal_voltage_v`, `capacity_ah`, `data_status`
(`datasheet` | `user_entered` | `illustrative_example`). All other fields are optional and come from
the datasheet: voltage limits, `internal_resistance_mohm` + `resistance_type`, `rc_r1_mohm`/`rc_c1_f`,
C-rate limits, temperature windows, `mass_kg`, `volume_l`, `dimensions`, `specific_heat_j_per_kgk`,
`ocv_curve[{soc, ocv_v}]`, cycle life (+ EOL %, conditions), `unit_cost` + `currency`.

Template for adding a real cell. Replace every `<…>` with the datasheet value, or delete the line if the datasheet doesn't give it. Do not guess.
```json
{
  "id": "<MFR-MODEL>", "manufacturer": "<…>", "model": "<…>",
  "chemistry": "LFP", "form_factor": "prismatic",
  "nominal_voltage_v": <…>, "max_voltage_v": <…>, "min_voltage_v": <…>, "capacity_ah": <…>,
  "internal_resistance_mohm": <…>, "resistance_type": "<ACIR 1 kHz | DCIR …>",
  "max_charge_c_rate": <…>, "max_discharge_c_rate": <…>,
  "charge_temp_min_c": <…>, "charge_temp_max_c": <…>, "discharge_temp_min_c": <…>, "discharge_temp_max_c": <…>,
  "mass_kg": <…>, "dimensions": {"length_mm": <…>, "width_mm": <…>, "height_mm": <…>},
  "cycle_life_cycles": <…>, "cycle_life_eol_capacity_pct": <…>, "cycle_life_conditions": "<…>",
  "data_status": "datasheet", "datasheet_ref": "<document title, revision, URL>"
}
```

## Design evaluation response (abridged)

```json
{
  "design_name": "A - Baseline", "role": "baseline", "result_type": "ESTIMATE", "disclaimer": "...",
  "cell": {"id": "EXAMPLE-LFP-20AH", "data_status": "illustrative_example", ...},
  "topology": "4S1P",
  "kpis": {"usable_energy_wh": 204.8, "charge_time_cc_estimate_h": 1.4, "peak_cell_temp_charge_c": 39.058, ...},
  "kpi_units": {...},
  "requirements": [{"id": "REQ-03", "status": "NOT_MET", "detail": "1.4 h vs <= 1", ...}],
  "safety_summary": {"PASS": 8, "WARN": 0, "FAIL": 0, "NOT_EVALUATED": 7},
  "modules": {"configuration": {...}, "mechanical": {...}, "energy": {...}, "estimates": {...},
              "thermal": {...}, "charge_simulation": {...}, "discharge_simulation": {...},
              "ageing": {...}, "bms": {...}, "cost": {...}},
  "flags": [...], "flag_counts": {...}
}
```
(The numbers above are what the illustrative example inputs produce. They are not measurements.)

## Comparison response (abridged)

`ranking[]`: per design, `eligible` (no safety FAIL), `score`, `rank_value`, `rank`, `score_parts`,
`safety_fails`, `safety_warnings`, `checks_not_evaluated`, `requirements_not_met`,
`delta_vs_baseline{metric: {value, baseline, delta, delta_pct}}`, `improves_on_baseline`, `worse_than_baseline`.
`recommendation`: `design_name`, `why`, `trade_offs`, `risks`, `model_limitations`, `recommended_next_step`.
`notes`: e.g. an illustrative cell was used, fewer than 2 alternatives were given, or metrics were excluded from scoring.
