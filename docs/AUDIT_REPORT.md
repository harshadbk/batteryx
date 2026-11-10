# BatteryX AI: project audit report

Date: 2026-11-09 · Scope: backend (FastAPI), frontend (React), databases (MongoDB Atlas, SQLite fallback),
engineering models, AI integration (Claude copilot, Groq quick explain) and the stage-1 prototype.

**Method.** I ran every automated suite, then probed the API with edge cases (extreme sizes, missing data,
impossible power requests, malformed JSON, NaN), checked the dimensions of every formula, made a read-only
consistency check of the live Atlas database, and ran a scripted real-browser (Chrome) end-to-end test of the full
workflow with screenshots. Every defect below was reproduced before it was fixed, and each one now has a regression test.

## 1. Defects found and fixed

| # | Area | Defect (how found) | Fix | Regression test |
|---|---|---|---|---|
| D1 | Database consistency | A cell used by a project design could be deleted (API probe: HTTP 204), leaving designs pointing at a missing cell | Delete returns **409** and lists the designs that use the cell | `test_audit.py::test_cell_used_by_a_design_cannot_be_deleted` |
| D2 | Database consistency | Deleting a project left its copilot conversations as orphans (probe) | Project delete cascades to its conversations (Mongo `delete_many`, SQL delete) | `test_project_delete_removes_its_conversations` |
| D3 | Engineering model | Constant-power discharge ignored busbar resistance: pack delivered 149.947 W for a 150 W request (probe) | Per-cell quadratic uses r_eff = R0 + R_ic·P/S; model version bumped to `electrical.ecm_1rc` v1.0.1 | `test_constant_power_discharge_delivers_requested_power_with_busbars` |
| D4 | Security / availability | 200 h at 0.1 s step allowed 7.2 M Python loop steps (request could stall the server) | Step budget ≤ 400 000 enforced in validation (422) | `test_simulation_step_budget_is_enforced` |
| D5 | Security / availability | Monte-Carlo allowed 20 000 × 512 cells × several arrays (memory blow-up) | samples × cells ≤ 1 000 000 (422) | `test_variation_size_is_enforced` |
| D6 | Security / cost | Paid AI endpoints had no rate limit | Per-IP sliding window (default 12/min, `BATTERYX_AI_RATE_PER_MIN`), 429 `rate_limited` | `test_ai_endpoints_are_rate_limited` |
| D7 | Traceability | Evaluation results did not echo the inputs used, and the report had no inputs section, so a number could not be traced to its input | `inputs` echo + `kpi_trace` (module, model id, version) on every evaluation; report has **Design inputs and provenance** (with source tags) and a **Computed by (model)** column | `test_evaluation_traces_inputs_and_models`, `lib.test.js` traceability test |
| D8 | Frontend crash | Thermal page dereferenced `design.limits` before the project was restored after a page reload → blank app (real-browser e2e) | Null-safe access; plus an **error boundary** so one page can never blank the app | `pages.test.jsx` "before a project is restored" (9 routes) |
| D9 | Frontend UX | Run buttons read "Re-run run charge & discharge simulation" (screenshot review) | Label fixed | e2e screenshots |
| D10 | Frontend UX | Charge-mode current/power plotted negative without explanation | Chart caption explains the sign convention | e2e screenshots |
| D11 | Engineering UX | CT-01 said "Derate charge current to ≤ 0.00 A" when ambient is already above the warning threshold (demo scenario S4) | Explicit message: no charge current keeps the cell below the threshold, so inhibit charging or improve cooling | `DEMO_RESULTS.md` S4 |
| D12 | Reporting | Comparison table showed B ranked above A with a lower weighted score, without the rank value (requirement penalty) | Rank value column + formula stated | `DEMO_RESULTS.md` S7 |

## 2. Verified (with evidence)

| Item | Evidence |
|---|---|
| Backend: 109 tests pass, 1 opt-in live-Atlas test (passes when enabled) | `python -m pytest -q` |
| Frontend: 37 unit/page tests pass (jsdom, real API responses as fixtures) | `npm test` |
| **Complete workflow in a real browser**: create project → configure → simulate → safety warnings → compare → AI page → report, plus wizard, cells, topology, thermal sweep, 3D view and a 390 px mobile layout. **14/14 steps, 0 browser errors** | `frontend/e2e/workflow.e2e.mjs`, `docs/screenshots/`, `docs/screenshots/e2e-results.json` |
| Same workflow automated against the API, including a verified AI recommendation (scripted Claude, real engine tools) | `backend/tests/test_audit.py::test_full_engineering_workflow` |
| Parity of the Python engine with the stage-1 JS engine (A/B/C) | `test_prototype_parity_and_api.py` |
| Stage-1 prototype unchanged; builds (built to a temp folder) | `vite build --outDir %TEMP%` |
| Atlas: 1 seed cell valid against `CellSpec`; no projects/conversations yet, so no orphans; indexes present | read-only check, 2026-11-09 |
| Secrets: `.env` git-ignored; no keys in frontend source or build; keys redacted in errors; status endpoints never return keys | grep scan; `test_storage.py::test_redact`; `test_copilot.py::test_unconfigured…` |
| Reproducible demo results (10 scenarios) | `backend/scripts/demo_scenarios.py` → `docs/DEMO_RESULTS.md` |

## 3. Formula and unit validation

Every equation was checked for dimensional consistency and has a hand-calculation or analytical test.

| Quantity | Equation | Units check | Test |
|---|---|---|---|
| Pack voltage / capacity | S·V, P·Q | V, Ah | `test_series_parallel_scaling` |
| Energy | V·Ah | Wh | `test_energy_nominal_and_usable` |
| Power at current | V·I − I²R | V·A − A²·Ω = W | `test_energy_nominal_and_usable` |
| Current at power | (V − √(V² − 4RP))/(2R) | V/Ω = A | `test_constant_power_current_solves_quadratic` |
| SOC update | I·Δt/(3600·Q) | A·s/(s/h·Ah) = – | `test_cc_discharge_duration_matches_coulomb_counting` |
| RC branch | V1 = R1·I·(1 − e^(−t/R1C1)) | Ω·A = V; Ω·F = s | `test_rc_branch_reaches_analytical_value` |
| CV current | (OCV − V1 − V_max)/R0 | V/Ω = A | `test_cc_cv_charge_respects_vmax_and_terminates` (transition SOC 0.75, cut-off SOC 0.86875 by hand) |
| Heat | I²R0 + V1²/R1 | W | `test_thermal_module_values` |
| Time constant | m·c_p·R_th | kg·J/(kg·K)·K/W = s | `test_lumped_thermal_closed_form` |
| Temperature | T_amb + qR_th(1 − e^(−t/τ)) | W·K/W = K | `test_lumped_thermal_closed_form`, coupled sim vs closed form within 0.01 K |
| R_th from convection | 1/(h·A) | 1/(W/(m²K)·m²) = K/W | `test_rth_from_convection_coefficient` |
| Energy conservation | E_released = E_terminal + losses | Wh | `test_discharge_energy_balance` (within 0.2 %) |
| Busbar | A = I/J; R = ρL/A; m = ρ_m·A·L | mm²; Ω·m·m/m² = Ω; kg | `test_busbar_sizing` |
| Balancing time | ΔSOC·Q/I_bleed | Ah/A = h | rule checked in BMS module |
| Max safe charge current | brentq on T_peak(I) = T_lim − margin | A | `test_max_safe_current_hits_temperature_limit` |
| Ageing | 1 − (1 − EOL)·N/N_life | – | `test_linear_cycle_life_ageing` |

**Verification vs validation.** The tests prove the code implements the stated equations correctly
(verification). Nothing in this project compares model outputs with measurements of a real battery
(validation), and no such claim is made anywhere in the platform or the documents.

## 4. Security and error handling review

| Topic | Status |
|---|---|
| Secrets | Server-side env only (`.env`, git-ignored); redaction of connection strings; Claude key never sent to the browser |
| Input validation | Pydantic ranges on every field, cross-field validators (SOC windows, voltages, OCV monotonicity), size caps (D4, D5), max list lengths |
| Error envelope | Uniform `{error: {code, message, details}}`; unhandled exceptions return 500 without stack traces |
| AI safety | Tools whitelist design changes; AI cannot set assumptions or invent cells; verifier rejects unsourced numbers, invented references, certification and measurement claims; refusal handling; rate limit (D6) |
| Database | Mongo filters use `re.escape`; IDs validated by pattern; no string-built queries |
| CORS | Restricted to the Vite dev origins |
| **Open: authentication** | **There is no user authentication or per-user authorisation.** This is acceptable for a single-team demo, but it must be added before any shared or public deployment |
| **Open: credentials shared in chat** | The Groq API key and the Atlas password were pasted into a chat session and must be **rotated** |
| Open: rate limiter scope | In-process only; a multi-worker deployment needs a shared store (e.g. Redis) |

## 5. Remaining gaps (not fixed; documented honestly)

1. **No real cell datasheet in the database.** All demonstrations use the illustrative stage-1 cell. Because of that,
   7 of 15 safety checks are NOT_EVALUATED, there is no OCV curve (so no CV phase), and there are no dimensions
   (so the volume is a fallback estimate). Adding one real datasheet cell is the single most valuable next step.
2. **No validation against measured data.** The roadmap proposes a public-dataset comparison and a supervised
   single-cell low-voltage test. Neither has been done.
3. **Claude copilot not exercised live.** No Anthropic key was available. The loop, tools, verifier and UI are tested with a
   scripted client, and `scripts/copilot_smoke.py` is ready for the first live run.
4. **Thermal model is single-node per cell.** There is no cell-to-cell conduction, so hot-spot location and spread across
   the module are not predicted (Monte-Carlo gives spread from cell tolerance only).
5. **No authentication**, as noted in section 4.
6. **Not tested in Safari/Firefox.** The e2e test uses Chrome only.
