# BatteryX AI engineering copilot (Claude)

The copilot turns plain-language engineering questions into **engine runs** and explains the results.
Claude never computes engineering values. It calls BatteryX tools that run the deterministic engine and read
the cell database, then writes a structured answer. The backend **verifies that answer against the tool results**
before the user sees it.

```
User requirements ─▶ Claude interprets ─▶ tool calls ─▶ BatteryX engine + cell DB compute (backend)
        ▲                                                          │
        │                       Claude analyses the tool results ◀─┘
        │                                   │
        │              structured JSON answer (claims + source refs)
        │                                   │
        │          backend verifier: numbers, refs, cells, URLs, wording
        │                 │ fail → one automatic repair round
        └── user reviews ◀┘ (verified badge, sources, add candidate to project, compare)
```

## Setup

1. `pip install -r requirements.txt` (adds the official `anthropic` SDK).
2. In `backend/.env` (git-ignored; never in frontend code):
   ```
   ANTHROPIC_API_KEY="sk-ant-..."
   BATTERYX_CLAUDE_MODEL="claude-opus-5-5"     # default
   BATTERYX_CLAUDE_EFFORT="medium"             # low | medium | high | xhigh | max
   BATTERYX_CLAUDE_FALLBACKS="1"               # server-side refusal fallback (recommended)
   ```
3. Restart the backend. `GET /api/v1/copilot/status` shows `configured: true` (it never returns the key).
4. Optional live check: `python -I scripts/copilot_smoke.py` (makes real, billed API calls).

Security: the key is read from the environment by the SDK on the server only. The frontend calls only
`/api/v1/copilot/*`. Error messages and logs never include the key.

## Five capabilities (one tool-using agent, mode-specific instructions)

| Mode (`mode`) | Capability | What Claude must do |
|---|---|---|
| `design_copilot` | AI Design Copilot | Map requirements to metrics, pick cells **only from the database**, propose ≤ 3 configurations as changes to a project design, **evaluate each with the engine** before presenting it |
| `analyst` | AI Engineering Analyst | Run charge/discharge simulations and evaluation of the focus design, explain the electrical and thermal drivers, cite model fidelity |
| `safety` | AI Safety Assistant | Run safety checks; explain each WARN/FAIL/NOT_EVALUATED, risk, constraint and the input/test that resolves it; never certify |
| `optimizer` | AI Optimization Advisor | Turn the user's priorities into explicit weights, compare designs, sweep a parameter, propose engine-checked improvements |
| `report` | AI Report Generator | Write report sections (executive summary, design basis, results, safety screening, comparison, limitations); every number sourced |

## Tools (Claude → backend)

| Tool | Backed by | Notes |
|---|---|---|
| `list_cells`, `get_cell` | cell database | the only source of cell specifications; missing fields listed explicitly |
| `get_project_designs` | project store | designs, operating conditions, assumptions, requirements |
| `evaluate_design` | full engine pipeline | base design + whitelisted changes |
| `simulate` | 1-RC ECM + lumped thermal | charge (CC-CV) or discharge |
| `safety_checks` | BMS rule engine | checks, max safe current, binding constraint |
| `compare_designs` | comparison engine | weights from the user's priorities |
| `sweep_parameter` | engine, up to 8 values | series, parallel, charge/discharge current |
| `get_model_documentation` | model registry | equations, assumptions, fidelity |

**Whitelisted changes** Claude may make: `series`, `parallel`, `cell_id` (must exist in the database),
charge/discharge current or power, SOC windows, sensor and voltage-channel counts, and `copy_cooling_from` /
`copy_mechanical_from` another project design. Claude **cannot type in thermal resistances, masses or any other
assumption**. It can only reuse assumptions that the engineer already entered.

All tools use `strict: true` schemas. Tool errors are returned as `is_error` results so Claude can recover.

## Structured answer (`output_config.format`, JSON schema)

`summary`, `answer_markdown`, `claims[] {statement, value, unit, source_ref, basis}`,
`recommendations[] {action, rationale, priority, verified, source_refs}`,
`candidate_designs[] {name, base_design, changes, evaluated_ref, verdict}`, `assumptions[]`, `uncertainties[]`,
`missing_inputs[]`, `report_sections[] {title, body_markdown, source_refs}`, `safety_notice`.
`basis` is one of `engine_estimate`, `cell_database`, `model_documentation`, `project_input`, `general_engineering_knowledge`.

## Verifier: checks for incorrect AI claims (`app/ai/verifier.py`)

| Check | Catches |
|---|---|
| `invalid_reference` | a claim/recommendation/section cites a ref no tool call produced this turn |
| `value_mismatch` | a claim's number is not in the cited tool result |
| `unsourced_number` | a number presented as general knowledge (e.g. "typical LFP energy density 160 Wh/kg") |
| `ungrounded_number` | any number in free text that is in no tool result, project input or the question |
| `candidate_not_evaluated` | a proposed design that was never run, or was run with different changes |
| `unknown_cell` | a cell identifier that is not in the database (invented part numbers) |
| `unverified_reference` | a URL / document reference that no tool result contains (invented datasheet refs) |
| `certification_claim` | "is safe", "certified", "complies with IEC …", "meets UL …" (negated phrasing allowed) |
| `measurement_claim` | estimates presented as measured / test data / experimentally validated |
| warnings | recommendation marked verified without engine evidence; no assumptions or uncertainties disclosed |

If any error is found, the backend sends Claude the list of problems once and asks for a corrected answer.
The final verification (passed/failed, every issue, numbers checked) is returned and shown in the UI. A failed
answer is labelled in red, and its candidates cannot be added to the project.

These checks are deterministic heuristics. They catch the listed failure modes. They do not prove that an
explanation is correct, so the engineer still reviews every answer.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/v1/copilot/status` | configured, model, effort, fallback, modes |
| POST | `/api/v1/copilot/projects/{project_id}/chat` | `{mode, message, conversation_id?, focus_design?}` → `{conversation_id, turn}` |
| GET | `/api/v1/copilot/projects/{project_id}/conversations` | conversation summaries |
| GET / DELETE | `/api/v1/copilot/conversations/{id}` | full conversation (turns with answers, tool calls, results, verification) |

`turn` = `{mode, capability, message, structured, verification, tool_calls[], tool_results{ref: result}, model, usage, latency_s, label}`.

Errors: `503 ai_unavailable` (no/invalid key), `429 ai_rate_limited` (after the SDK's automatic retries;
`details.retry_after_s`), `502 ai_provider_error` (overload, network, 400, malformed output, tool-loop limit),
`422 ai_refused` (the model declined even after the server-side fallback), `409 conversation_mismatch`.

## Implementation notes

- Official `anthropic` SDK; manual tool loop (`app/ai/copilot.py`) so every call can be registered as a source
  reference and verified. Parallel tool calls are executed and returned in one message. Maximum 10 tool rounds per turn.
- Model `claude-opus-5-5` with adaptive thinking (its default), explicit `effort`.
- Server-side refusal fallback: beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`.
  `stop_reason == "refusal"` is checked before reading content.
- Prompt caching: `cache_control: {type: "ephemeral"}`. The system prompt and tool list are static, so the prefix is cacheable.
  Volatile data (project context, question) goes in the user turn. Verify with `usage.cache_read_input_tokens`.
- Project-specific memory: conversations are stored per project (MongoDB `conversations` collection, or the SQL table).
  The last 6 turns (question + summary/answer) are sent as history. Tool references are per turn, so Claude re-runs
  tools rather than citing old numbers.
- SDK retries (`max_retries=3`) handle 429/5xx/connection errors with backoff before an error reaches the user.

## Example conversations

The following were produced in the test suite with a **scripted Claude stand-in** (`scripts/capture_fixtures.py`,
`tests/test_copilot.py`), not by the live model. The **tool results and numbers are real engine outputs** for the
stage-1 illustrative designs. Real Claude wording will differ. Run `scripts/copilot_smoke.py` for live transcripts.

**1. Design Copilot** (illustrative cell data)
> **User:** Need at least 400 Wh usable.
> **Tool calls:** `T1 evaluate_design(A - Baseline)`, `T2 evaluate_design(A - Baseline, parallel=2, label "A + 4S2P")`
> **Answer:** "Estimated peak charge temperature of the baseline is 39.058 °C (T1). The 4S2P variant gives 409.6 Wh usable (T2)."
> **Candidate:** `A + 4S2P` = A - Baseline with `parallel = 2`, evaluated in T2. **Verification:** passed, 2 claims verified. Missing input flagged: `cell.ocv_curve`.

**2. Engineering Analyst**
> **User:** Explain the thermal behaviour. **Tool calls:** `T1 simulate(A, charge)`, `T2 evaluate_design(A)`.
> **Answer:** "During charge the estimated peak cell temperature is 39.058 °C (T1); heat follows I²R." The claim cites T1, and the qualitative
> I²R statement has `basis: general_engineering_knowledge` with `value: null`. **Verification:** passed.

**3. Incorrect claims caught (from the tests)**

| Model wrote | Verifier result |
|---|---|
| "The LFP cells will last 6000 cycles at this rate." | `ungrounded_number` (6000 is in no tool result) |
| claim 41.7 °C citing T1 (engine said 39.058 °C) | `value_mismatch` |
| "typical LFP specific energy 160 Wh/kg" as general knowledge | `unsourced_number` |
| "Design B is safe and complies with IEC 62619." | `certification_claim` |
| "The measured peak temperature confirms the design." | `measurement_claim` |
| "Switch to the CATL-LF280K cell …" | `unknown_cell` |
| "See the datasheet at https://example.com/lfp-ds.pdf" | `unverified_reference` |
| candidate 4S3P with no engine run, or citing a run of different inputs | `candidate_not_evaluated` |
| "These are estimates, not measured values. This is not a certification." | passes (negation recognised) |

## Testing

```powershell
python -m pytest tests/test_copilot.py -q    # 25 tests, no network, no key
python -I scripts/copilot_smoke.py           # live, billed; includes two adversarial prompts
```
The offline tests drive the real engine through a scripted SDK client and cover: the tool loop, parallel tool results,
the request shape (model, strict tools, JSON schema, effort, caching, fallback beta), project-scoped history,
ten incorrect-claim cases plus the repair round, tool guardrails (assumption edits and unknown cells rejected),
API failure mapping (429 with retry-after, 401, 529, network), refusal handling, and the unconfigured state.
