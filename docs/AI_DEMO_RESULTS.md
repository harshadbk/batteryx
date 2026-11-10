# Live AI copilot results

Recorded on **2026-11-10** against the BatteryX backend (API v0.4.0) using **Groq `openai/gpt-oss-120b`** through the copilot's Groq adapter. **No live Claude run has been done**: no Anthropic API key was available. The Claude code path is covered only by scripted tests (`backend/tests/test_copilot.py`).

All engineering numbers come from engine tool results; the cell is the illustrative stage-1 cell `EXAMPLE-LFP-20AH` (not a real product), so every value is a model estimate, not a measurement.

## Transcript: AI Safety Assistant, design B (Fast charge + spreader)

**Request:** “Explain the safety checks for this design and what limits the charge current.”  
**Focus design:** B - Fast charge + spreader  
**HTTP status:** 200 · **wall time:** 134.7 s · **API calls:** 4 · **tokens in/out:** 11433/4753

**Tool calls:** `T1` safety_checks (ok), `T2` safety_checks (ok)

### Verifier verdicts

**Attempt 1: REJECTED**

- `ungrounded_number` in `answer_markdown`: numbers not found in any tool result or input: ['0.9']

**Attempt 2: PASSED**

- no errors

Attempt 1 contained the number 0.9, which appears in no tool result, project input or the question, so the backend rejected it and sent the model one repair instruction. Attempt 2 passed.

### Final verified claims

| Statement | Value | Unit | Source | Basis |
|---|---|---|---|---|
| Maximum safe charge current for the design | 20.0 | A | T2 | engine_estimate |
| Peak cell temperature during charge | 42.63 | °C | T2 | engine_estimate |

The engine's own values for design B (docs/DEMO_RESULTS.md, S2 and S7): max safe charge current 20 A, peak cell temperature during charge 42.63 °C. The claims match.

### Final answer (as shown to the user)

**Summary:** Safety screening for design B (Fast charge + spreader) shows one WARN (charge current at limit) and several NOT_EVALUATED checks due to missing cell data. The engine estimates a max safe charge current of 20 A, limited by the cell’s charge‑current constraint.

### Safety‑check results for **B – Fast charge + spreader**

| Check ID | Subsystem | Status | Meaning & risk | What is missing / needed to resolve |
|----------|-----------|--------|----------------|--------------------------------------|
| **EL‑01** | Electrical | **WARN** | The design charges at the engine‑estimated maximum charge current (20 A). Operating at the limit leaves little margin for variations in temperature, aging, or manufacturing tolerances and could lead to accelerated degradation or thermal runaway if the actual cell limit is lower. | Verify the cell’s true max charge current from the datasheet or test. |
| **EL‑02** | Electrical | **NOT_EVALUATED** | No assessment of discharge C‑rate; if the discharge limit is lower than the assumed 10 A, the pack could be overstressed during discharge. | Provide `cell.max_discharge_c_rate` from the datasheet or a discharge‑performance test. |
| **VL‑01** | Electrical | **NOT_EVALUATED** | No simulation of cell voltage during charge; over‑voltage could damage the cell or trigger safety circuits. | Supply `cell.max_voltage_v`, the OCV curve, and run a charge simulation. |
| **VL‑02** | Electrical | **NOT_EVALUATED** | No simulation of cell voltage during discharge; undervoltage can cause lithium plating or loss of capacity. | Supply `cell.min_voltage_v`, the OCV curve, and run a discharge simulation. |
| **TH‑02** | Thermal | **NOT_EVALUATED** | No check of peak temperature during discharge; high discharge temperature can reduce life or trigger thermal protection. | Provide `limits.max_cell_temp_discharge_c` or `cell.discharge_temp_max_c`. |
| **TH‑03** | Thermal | **NOT_EVALUATED** | Ambient temperature relative to the cell’s charge‑temperature window is unknown; charging outside the window can cause capacity loss or safety events. | Provide `cell.charge_temp_min_c` and `cell.charge_temp_max_c`. |
| **PR‑03** | Protection | **NOT_EVALUATED** | Discharge current limit in the BMS is not checked; an oversized discharge could exceed fuse or cell limits. | Provide the design discharge current and `limits.bms_max_discharge_current_a`. |
| **PR‑05** | Protection | **NOT_EVALUATED** | Fuse rating vs. cell‑group discharge capability is unknown; an undersized fuse could open prematurely, while an oversized fuse may not protect the cells. | Provide `limits.fuse_rating_a` and `cell.max_discharge_c_rate`. |

#### Max safe charge current
- **Estimated max safe charge current:** **20 A** (see check **CT‑01**). 
- **Binding constraint:** the cell’s maximum charge‑current limit (engine‑estimated) caps the pack at 20 A.

#### Thermal result
- **Peak cell temperature during charge:** **42.63 °C** (below the engine‑estimated safe temperature for this scenario).

**Next steps**: Supply the missing inputs listed below, run the omitted voltage and thermal simulations, and consider adding a safety margin to the charge current based on verified cell data.


**Recommendations:**

- [high] Obtain cell maximum discharge C‑rate from the datasheet or test (verified: True, refs: T2)
- [high] Provide cell maximum voltage and OCV curve, then run charge voltage simulation (verified: True, refs: T2)
- [high] Provide cell minimum voltage and OCV curve, then run discharge voltage simulation (verified: True, refs: T2)
- [medium] Supply discharge temperature limit (cell.discharge_temp_max_c or limits.max_cell_temp_discharge_c) (verified: True, refs: T2)
- [medium] Supply cell charge temperature window (cell.charge_temp_min_c, cell.charge_temp_max_c) (verified: True, refs: T2)
- [medium] Provide BMS discharge current limit (limits.bms_max_discharge_current_a) (verified: True, refs: T2)
- [medium] Provide fuse rating and cell discharge capability (verified: True, refs: T2)

**Safety notice:** All results are model estimates; the checks are screening only and do not constitute safety certification.

## Other live runs on the same day

| Mode | Design | Result | Notes |
|---|---|---|---|
| Safety | A - Baseline | 200, verified | first live run after the Groq adapter was added |
| Analyst | A - Baseline | 200, verified after 1 repair round, 111 s | “temperature rising from ambient 35 °C to a peak of 39.23 °C” (engine discharge peak: 39.23 °C) |
| Safety | A - Baseline | 200, verified, 0 repairs, 50 s | “max safe charge current is 15.4 A, limited by the peak temperature margin” (engine: 15.4 A) |
| Safety | B - Fast charge + spreader | 200, verified after 1 repair | transcript above |
| Safety | A - Baseline | 502 (bug) | answer cut off by a fixed 2,500-token output limit. **Fixed:** output limit now sized to the remaining quota |
| Analyst | A - Baseline | 502 (bug) | Groq rejected a `simulate` call that omitted the required `mode` argument (`tool_use_failed`). **Fixed:** the adapter retries with a hint (unit-tested; live re-test pending because the daily quota was used up) |

## Scripted vs live testing

- **Scripted (automated, no network):** 35 copilot tests, `tests/test_copilot.py` (Claude path, scripted SDK) and `tests/test_groq_copilot.py` (Groq adapter, scripted HTTP). The engine and verifier are real; the model is replaced by a script. Ten incorrect-claim cases (invented cycle life, mismatched temperature, certification wording, invented cell, invented URL, unevaluated candidate) are all rejected.
- **Live (Groq):** the runs listed above. Groq free-tier limits (8,000 tokens per minute, plus a daily quota) make one answer take about 1–2 minutes.
- **Live (Claude):** not run.

To reproduce: start the backend with `GROQ_API_KEY` set in `backend/.env`, open the AI assistant page, choose the Safety Assistant with focus design B and ask the same question. Model output varies between runs; the verifier guarantees only that the numbers shown match the engine's tool results.
