# BatteryX AI: Frontend

React 18 + Vite + Tailwind CSS engineering workspace for the BatteryX FastAPI backend.
Charts use Recharts, and the 3D module view uses Three.js (@react-three/fiber).

**Every simulation value shown in the UI comes from a backend API response.** The browser
computes nothing physical: forms edit the design, buttons call the backend, and charts and tables
render the response. Warnings and PASS/WARN/FAIL statuses come from the backend rule engine.
Illustrative example data is labelled wherever it appears.

**One exception, clearly labelled: the Live simulator (`/app/simulator`).** This is the stage-1
BatteryWeave prototype, merged into this app (`src/simulator/`). It runs its closed-form model in the
browser so the guided 5-step walkthrough, heat map, constraint engine and dependency graph react
instantly and work with the backend offline. Its numbers match the backend engine for options A/B/C
(`src/test/simulator.test.jsx` pins the same reference values as the backend parity test). Its CSS is
scoped under `.bw` (`src/simulator/simulator.css`) so it cannot clash with the Tailwind classes.

## Run

Two terminals:

```powershell
# 1. backend (see ../backend/README.md)
cd C:\Users\Owner\Documents\suraj\batteryx\backend
python -m uvicorn app.main:app --reload --port 8000

# 2. frontend
cd C:\Users\Owner\Documents\suraj\batteryx\frontend
npm install          # first time only
npm run dev          # http://localhost:5173 (Vite picks the next free port if 5173 is busy)
```

In development, Vite proxies `/api` and `/health` to `http://localhost:8000`, so no CORS setup is
needed. For a deployed build, set `VITE_API_URL` (see `.env.example`) and run `npm run build`; the
static site is written to `dist/`.

The stage-1 prototype is now part of this app at `/app/simulator`; there is no second app to run.

## Test

```powershell
npm test                 # 44 unit + page tests (jsdom), no backend needed
```
- `src/test/simulator.test.jsx`: live-simulator engine parity with the backend (A/B/C), the TH-01 conflict at 20 A, dependency propagation, and the page (scenario + guided walkthrough).
- `src/test/lib.test.js`: design helpers, formatting, and the report builder (all case-study sections present, estimates labelled).
- `src/test/pages.test.jsx`: renders **every page** against **real backend responses**
  (`src/test/fixtures.json`, captured from the FastAPI app with `backend/scripts/capture_fixtures.py`),
  clicks the run buttons and checks the backend numbers appear. It also checks the exact request bodies sent
  (e.g. the compare payload) and that autosave PUTs the project.

Live contract test against a running backend (it creates a temporary project and deletes it afterwards):
```powershell
$env:VITE_API_URL = "http://localhost:8000"; $env:BATTERYX_CONTRACT = "1"; npm run test:contract
```

Real-browser end-to-end workflow (Chrome via puppeteer-core; backend and dev server running). It saves a screenshot of every step to `../docs/screenshots/`:
```powershell
$env:E2E_URL = "http://localhost:5173"; npm run test:e2e      # optional: $env:CHROME_PATH
```

Manual smoke test (about 3 minutes):
1. Landing page (`/`): the status card shows API, database, models and AI status from the backend.
2. **Projects** → create a project → **Load stage-1 examples A/B/C** (labelled illustrative) → **Evaluate all designs**.
3. **Electrical** → *Run charge & discharge simulation*: charts for voltage, current, SOC, power and heat.
4. **Thermal** → *Run thermal analysis*, then *Run sweep*: temperature transient and the peak-temperature-vs-current curve.
5. **BMS & safety** → *Run safety checks*, then Monte-Carlo with your tolerances.
6. **Mechanical packaging** → *Run packaging analysis*: 3D view (drag to orbit), mass breakdown and cost.
7. **Design comparison** → *Run comparison*: ranking, recommendation with risks, metric explorer and deltas.
8. **AI assistant** (needs `ANTHROPIC_API_KEY` on the backend): pick a capability, click an example. Check the verification badge, claims with source refs (click T1… to see the engine result), and *Add to project* for engine-evaluated candidates.
9. **Engineering report** → *Generate report* → *Print / save as PDF* or download Markdown/JSON.

## Pages

| Route | Page | Backend calls |
|---|---|---|
| `/` | Landing | `/health`, `/models`, `/ai/status` |
| `/app/projects` | Project workspace: projects, designs (baseline/alternatives), shared requirements | `/projects*`, `/examples/designs`, `/designs/evaluate` |
| `/app/wizard` | 8-step configuration wizard with final evaluation | `/configuration`, `/energy`, `/designs/evaluate`, `/ai/extract-requirements` |
| `/app/cells` | Cell database: provenance, completeness, add-from-datasheet form | `/cells*` |
| `/app/topology` | S×P editor with live sizing and electrical schematic | `/configuration`, `/energy` |
| `/app/electrical` | CC-CV / CC / CP simulation dashboard, ageing assumption | `/simulate/charge`, `/simulate/discharge`, `/estimates`, `/ageing` |
| `/app/thermal` | Lumped thermal (labelled simplified), transient, current sweep | `/thermal`, `/simulate/*` |
| `/app/safety` | Rule checks by subsystem, CT-01 max safe current, balancing, Monte-Carlo | `/bms`, `/variation` |
| `/app/packaging` | Envelope, 3D view, mass breakdown, busbars, cost | `/mechanical`, `/cost`, `/thermal` |
| `/app/compare` | Baseline vs alternatives: weights, ranking, recommendation, deltas | `/designs/compare` |
| `/app/assistant` | Claude copilot (Design Copilot, Analyst, Safety, Optimizer, Report) with verified answers and sources; quick explain; requirements from text | `/copilot/*`, `/ai/explain`, `/ai/extract-requirements` |
| `/app/report` | Engineering report: print/PDF, Markdown, JSON | `/designs/evaluate`, `/designs/compare`, `/models` |

## Structure

```
src/
  lib/        api.js (client + error envelope), design.js (draft helpers), fields.js (every input:
              label, unit, help, source tag), format.js, report.js (Markdown from API data)
  store/      project.js: zustand store (open project, active design, autosave, result cache)
  hooks/      useApi.js: useFetch, useDesignRun (run + cache + "inputs changed" detection)
  components/ ui/ (Panel, Stat, Badge, Field, FlagList, ModelCard, ChecksTable, RunBar…),
              charts/, three/PackView3D, layout/ (AppShell, RequireDesign), cells/, design/
  pages/      one file per page
  test/       fixtures (real API responses), API mock, unit/page/contract tests
```

## Design system

- IBM Plex Sans/Mono, a slate palette with the teal "volt" accent (#0E8C99, from stage 1) and amber for thermal.
- Status colours: PASS green, WARN amber, FAIL red, NOT EVALUATED grey (never shown as a pass).
- Every input shows its unit, a tooltip, and a **source tag** (Design / Operating / Engineer limit / Assumption).
- Every result panel shows the backend's **model card** (equations, assumptions, fidelity) and **flags**
  (missing inputs, unsupported calculations, engine assumptions).
