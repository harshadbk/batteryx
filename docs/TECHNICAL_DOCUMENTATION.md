# BatteryX AI: technical documentation

AI-assisted engineering platform for designing small battery modules (TELIPORT S4, Case Study 2).
Physics computes, rules check, AI explains, the engineer decides.

| Document | Content |
|---|---|
| this file | architecture, components, data model, API, traceability, operations |
| `../backend/docs/ENGINEERING_MODELS.md` | every equation, unit, assumption and limitation |
| `../backend/docs/API.md` | endpoint reference, request/response schemas |
| `../backend/docs/COPILOT.md` | Claude copilot: tools, verifier, examples |
| `AUDIT_REPORT.md` | audit findings, fixes, evidence, open gaps |
| `DEMO_SCENARIOS.md` / `DEMO_RESULTS.md` | live demo script / generated reproducible results |
| `EVALUATION_MAPPING.md` | mapping to the case-study criteria, with strengths and gaps |

## 1. Architecture

```
Browser: React 18 + Vite + Tailwind · Recharts · Three.js (@react-three/fiber)
  12 pages · zustand store (project, active design, result cache, autosave) · typed API client
        │  JSON over HTTP (/api/v1, dev proxy)
FastAPI (Python 3.11)
  routes.py (modules, designs, cells) · routes_extra.py (projects, AI explain/extract) · routes_copilot.py
  engine/  configuration · energy · estimates · electrical (1-RC ECM) · thermal · ageing · bms ·
           mechanical · cost · variation · comparison · pipeline · registry      ← pure, deterministic
  ai/      claude_client · copilot (tool loop) · copilot_tools · verifier · grounding · llm (Groq) · requirements_parser
  db/      Mongo* / Sql* stores for cells, projects, conversations
        │
MongoDB Atlas (default when MONGODB_URI is set) ─ or ─ SQLite / PostgreSQL (fallback)
Claude API (anthropic SDK, server-side)   ·   Groq API (optional quick explain)
```

Design principles: (1) the engine is pure and deterministic, called identically by the API, the AI tools and the tests;
(2) one design document (`DesignInput`) is the only interface between modules; (3) every response carries
`result_type: "ESTIMATE"`, model metadata and flags; (4) missing data is flagged, never invented.

## 2. Workflow and pages

| Step | Page (route) | Backend |
|---|---|---|
| Create project | Projects `/app/projects` | `POST /projects` |
| Configure battery | Wizard `/app/wizard`, Cells `/app/cells`, Series-parallel `/app/topology` | `/cells`, `/configuration`, `/energy` |
| Run simulation | Electrical `/app/electrical`, Thermal `/app/thermal` | `/simulate/charge`, `/simulate/discharge`, `/thermal`, `/estimates`, `/ageing` |
| Identify safety warnings | BMS & safety `/app/safety` | `/bms`, `/variation` |
| Mechanical | Packaging `/app/packaging` (3D) | `/mechanical`, `/cost` |
| Compare alternatives | Comparison `/app/compare` | `/designs/compare` |
| AI recommendations | AI assistant `/app/assistant` | `/copilot/*`, `/ai/*` |
| Engineering report | Report `/app/report` (print/PDF, Markdown, JSON) | `/designs/evaluate`, `/designs/compare`, `/models` |

## 3. Data model

| Store | MongoDB collection / SQL table | Key | Content |
|---|---|---|---|
| Cells | `cells` | cell id | `spec` (CellSpec, every field optional except identity, V_nom, Ah, data_status), `origin` seed/user |
| Projects | `projects` | 12-hex id | name, application, description, `designs[]` (DesignInput drafts), `requirements[]`, timestamps |
| Conversations | `conversations` | 12-hex id | `project_id`, turns (message, mode, structured answer, verification, tool calls and results) |

Integrity rules: cell delete is blocked while a design uses the cell; project delete cascades to conversations;
design names are unique within a project; `datasheet` cells require `datasheet_ref`.

## 4. Traceability chain

```
Input (value + unit + source tag: Design / Operating / Engineer limit / Assumption)      → evaluation.inputs
   └─▶ Model (id, version, fidelity, equations, assumptions)                              → evaluation.kpi_trace, /models
         └─▶ Result (KPI with unit, result_type ESTIMATE)                                 → evaluation.kpis / kpi_units
               ├─▶ Rule check (value, limit, limit_source, basis)                         → bms.values.checks
               ├─▶ Requirement (target, status)                                           → evaluation.requirements
               └─▶ Flags (missing input / unsupported / assumption / warning)             → evaluation.flags
Cell data → data_status + datasheet_ref → report "Cells and data sources"
AI answer → claims[].source_ref → tool call ref → engine result (verified by the backend)
```
The engineering report prints every link of this chain (inputs with source tags, the model behind each KPI,
check limit sources and bases, assumptions, limitations and the equations appendix).

## 5. Engineering models (summary)

1-RC equivalent-circuit model with CC-CV charge and CC/CP discharge; a lumped single-node thermal model coupled
to it (labelled simplified); closed-form sizing, energy and time estimates; BMS rule engine (15 checks + max safe
charge current via SciPy brentq); rectangular-grid packaging with busbar sizing; BOM cost or relative index;
linear ageing assumptions (labelled simplified); seeded Monte-Carlo cell variation; constraint-first weighted
comparison. Full equations and assumptions: `backend/docs/ENGINEERING_MODELS.md`.

## 6. AI integration

- **Claude copilot** (`claude-opus-5-5`, official SDK, server-side): five modes (Design Copilot, Analyst, Safety,
  Optimizer, Report). Claude calls 9 strict-schema tools backed by the engine and database, returns structured JSON, and the backend
  verifies it (numbers, references, cells, URLs, certification and measurement wording) with one repair round.
  Conversations are stored per project. See `backend/docs/COPILOT.md`.
- **Groq quick explain** (optional): one-step grounded explanation and requirement extraction, with a rule-based fallback.

## 7. Configuration

`backend/.env` (git-ignored; template `.env.example`): `MONGODB_URI`, `BATTERYX_MONGODB_DB`, `BATTERYX_DB_BACKEND`
(auto|mongo|sql), `BATTERYX_DATABASE_URL`, `ANTHROPIC_API_KEY`, `BATTERYX_CLAUDE_MODEL`, `BATTERYX_CLAUDE_EFFORT`,
`BATTERYX_CLAUDE_FALLBACKS`, `GROQ_API_KEY`, `GROQ_MODEL`, `BATTERYX_AI_RATE_PER_MIN`.
`frontend/.env`: `VITE_API_URL` (empty in development).

## 8. Running and testing

```powershell
# backend
cd batteryx\backend ; pip install -r requirements.txt ; python -m uvicorn app.main:app --port 8000
python -m pytest -q                                   # 109 tests
python -I scripts\demo_scenarios.py                   # regenerate docs\DEMO_RESULTS.md
python -I scripts\copilot_smoke.py                    # live Claude check (needs key; billed)
# frontend
cd batteryx\frontend ; npm install ; npm run dev       # http://localhost:5173
npm test                                              # 37 tests
$env:E2E_URL="http://localhost:5173"; node e2e\workflow.e2e.mjs   # real-browser workflow + screenshots
```

## 9. Error handling

| HTTP | code | Meaning |
|---|---|---|
| 404 | not_found | unknown cell, project, conversation |
| 409 | conflict / conversation_mismatch | duplicate cell, cell in use, seeded cell delete, conversation of another project |
| 422 | validation_error / engine_input_error / ai_refused | invalid input, invalid comparison, model refusal |
| 429 | rate_limited / ai_rate_limited | platform AI limit, provider limit (after SDK retries) |
| 502 | ai_provider_error | provider error, network error, malformed AI output |
| 503 | ai_unavailable | no or invalid AI key |

The frontend shows these through `ErrorBox` (with field-level details for validation errors), with an error boundary per page,
loading states and empty states.

## 10. Known limitations

See `AUDIT_REPORT.md` §5. In short: illustrative cell data only; no validation against measurements; single-node
thermal; Claude not yet run live; no authentication; Chrome-only e2e.
