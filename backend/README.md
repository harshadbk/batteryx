# BatteryX AI: Engineering Simulation Backend

FastAPI + NumPy/SciPy backend for designing a small battery module: cell database,
series-parallel sizing, energy/power, closed-form and time-domain charge/discharge,
**simplified** thermal and ageing models, BMS rule checks, mechanical estimates, cost and
a baseline-vs-alternatives comparison engine.

> **Every output is a model ESTIMATE.** Nothing here is measured or validated against test
> data, and the rule checks are **not a safety certification**. Each response carries
> `result_type: "ESTIMATE"`, a disclaimer, the model's equations and assumptions, and flags for
> missing inputs and unsupported calculations.

The stage-1 prototype's closed-form model is ported here, and the prototype itself now lives in the
frontend as the Live simulator (`../frontend/src/simulator/`); and `tests/test_prototype_parity_and_api.py` checks that options A/B/C give the same
numbers as the JS engine.

## Run

Python 3.10+ (developed on 3.11).

```powershell
cd C:\Users\Owner\Documents\suraj\batteryx\backend
python -m venv .venv ; .\.venv\Scripts\Activate.ps1      # optional
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

- Swagger UI: http://localhost:8000/docs  ·  ReDoc: http://localhost:8000/redoc
- **Database: MongoDB Atlas** when `MONGODB_URI` is set in `.env`, which is git-ignored. Copy `.env.example` to `.env` to set it up. The `cells` collection in the `batteryx` database is
  created and seeded on first start. `GET /health` shows which backend is active.
  - `BATTERYX_DB_BACKEND=auto` (default): use MongoDB, or fall back to SQLite (`batteryx.db`) if Atlas is
    unreachable, e.g. offline or with the IP not on the Atlas Network Access list. `/health` then shows `fallback_reason`.
  - `mongo`: MongoDB only, and the server refuses to start if it can't connect. `sql`: SQLite/PostgreSQL only
    (`BATTERYX_DATABASE_URL`).
  - Credentials are read only from the environment, never logged, and redacted from error messages.
- CORS allows the Vite dev server (`http://localhost:5173`).

## Test

```powershell
python -m pytest -q                                              # offline: SQLite + fake Mongo collection
$env:BATTERYX_TEST_MONGO = "1"; python -m pytest tests/test_storage.py -q   # + live Atlas round trip (uses a throwaway 'batteryx_test' DB)
```

109 tests (plus 1 opt-in live MongoDB test) cover:
- hand-calculation checks for every closed-form equation
- analytical checks for the time-domain model: the RC step response, CC-CV transition SOC, CV cut-off SOC, constant-power hold, and the coupled thermal model against the closed form
- energy conservation
- repeatability (deterministic and seeded results)
- BMS PASS/WARN/FAIL/NOT_EVALUATED logic
- comparison eligibility and input validation
- API status codes and error formats
- parity with the stage-1 JS engine
- audit regressions and the full end-to-end engineering workflow (`tests/test_audit.py`)
- Claude copilot: tool loop, request shape, incorrect-claim detection, repair round, failures (`tests/test_copilot.py`)
- projects API, AI grounding verifier, AI endpoints with a stub provider (no network), rule-based fallback
- storage backends: Mongo store logic, backend selection, fallback, credential redaction

Tests use a **synthetic** test cell (`tests/conftest.py`) with round numbers chosen only for
hand calculation. It is not a real product.

## Try it (sample requests in `samples/`)

```powershell
# PowerShell
$h = @{ "Content-Type" = "application/json" }
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/v1/designs/evaluate -Headers $h -InFile samples\evaluate_baseline.json
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/v1/designs/compare  -Headers $h -InFile samples\compare_abc.json
```
```bash
# bash / curl
curl -X POST localhost:8000/api/v1/designs/compare -H "Content-Type: application/json" -d @samples/compare_abc.json
```

## Layout

```
app/
  main.py            app factory, DB backend selection + seeding, CORS, error handlers
  config.py          settings from env/.env, credential redaction
  errors.py          uniform error envelope {"error": {code, message, details}}
  schemas/           Pydantic input/output contracts (cell, design, results)
  engine/            pure calculation modules (no I/O), each with a MODEL record
    configuration.py energy.py estimates.py electrical.py thermal.py ageing.py
    bms.py mechanical.py cost.py variation.py comparison.py pipeline.py registry.py
  ai/                Groq adapter, grounded explanation, number-grounding verifier, requirement extraction
                     (rule-based fallback ported from the stage-1 prototype)
  db/                project stores + cell stores: MongoCellStore (Atlas) and SqlCellStore (SQLite/PostgreSQL), seeding
  api/routes.py      REST endpoints
  data/              seed cell (illustrative only) and example designs A/B/C
docs/API.md          endpoint reference
docs/ENGINEERING_MODELS.md   equations, units, assumptions, limitations
samples/             runnable request bodies
tests/               pytest suite
```

## Data honesty rules built into the code

- The cell database ships with **one** cell, `EXAMPLE-LFP-20AH`, which holds the stage-1
  prototype's illustrative values and is labelled `illustrative_example`. Its missing fields
  (voltage limits, OCV curve, dimensions, cycle life, cost, …) are left empty, not invented.
- Real cells must be added with `data_status: "datasheet"`, and a `datasheet_ref` is then required.
- Any calculation whose input is missing returns `null` and adds a `missing_input` or `unsupported` flag.
- Any default that the engine applies is reported as an `assumption` flag.

## AI assistant (optional)

Set `GROQ_API_KEY` (and optionally `GROQ_MODEL`, default `openai/gpt-oss-120b`) in `.env`. Without a key,
`/ai/explain` returns 503 and requirement extraction falls back to the rule-based parser. The Groq free
tier is limited in tokens per minute, so the backend retries once on a short rate-limit wait and otherwise returns `429 ai_rate_limited`.

## Frontend fixtures

`python -I scripts/capture_fixtures.py ../frontend/src/test/fixtures.json` regenerates the real API
responses used by the frontend page tests (in-memory database; no external services).

## Claude copilot

Engineering copilot on the Claude API with tool calling into the real engine and cell database, structured
answers, project-scoped conversations and a deterministic verifier for incorrect AI claims.
Setup: add `ANTHROPIC_API_KEY` to `.env` (see `.env.example`). Without it, the copilot runs on Groq using `GROQ_API_KEY`
(OpenAI-compatible tool calling; set `BATTERYX_COPILOT_PROVIDER` to force `anthropic` or `groq`). Full documentation, example conversations and the
verification rules: **`docs/COPILOT.md`**. Endpoints: `/api/v1/copilot/*`.
