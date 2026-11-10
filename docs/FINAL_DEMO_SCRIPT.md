# BatteryX AI – Stage 2 speaking script (about 7 minutes)

Deck: `docs/presentation/BatteryX_AI_Stage2_Improved.pptx`. Each slide's speaker notes contain the full script below.
All numbers come from runs on 2026-11-10: `backend/scripts/demo_scenarios.py` (regenerates `docs/DEMO_RESULTS.md`), pytest, vitest, the
browser workflow test and the live AI capture in `docs/AI_DEMO_RESULTS.md`.

| Time | Slide | Key message (say this even if you cut the rest) |
|---|---|---|
| 0:00–0:30 | 1 Title | Change one parameter, see every consequence, with every number traceable. |
| 0:30–1:15 | 2 Problem | 10 A → 20 A halves charge time (1.4 → 0.7 h) but heat ×4 (0.8 → 3.2 W), peak 39.06 → 46.65 °C, TH-01 FAIL. |
| 1:15–2:00 | 3 Challenges | All five case-study challenges map to implemented, tested features; ageing is an assumption; nothing validated yet. |
| 2:00–2:45 | 4 Solution | Seven-step workflow; physics computes, rules check, AI explains, engineer decides. |
| 2:45–3:20 | 5 Architecture | One deterministic engine serves pages, AI tools and tests; keys stay on the server. |
| 3:20–4:05 | 6 Engineering | 11 versioned models in 8 categories; verification done, validation not done. |
| 4:05–4:55 | 7 AI | Live run: verifier rejected an invented “0.9”, repaired answer matched the engine. Claude not run live. |
| 4:55–5:45 | 8 Results | Spreader halves R_th: same 0.7 h at 20 A, 42.63 °C instead of 46.65 °C; engine recommends B. |
| 5:45–6:25 | 9 Feasibility | Measured software (0.031 s, 14/14, 163 tests) vs estimated battery values; roadmap. |
| 6:25–7:00 | 10 Close | Next: real datasheet cell → public dataset → supervised low-voltage test. |

## Live demo (if the judges ask, 2–3 minutes)

1. Start the backend (`cd backend && python -m uvicorn app.main:app --port 8000`) and the frontend (`cd frontend && npm run dev`).
2. **Projects** → *Load stage-1 examples A/B/C* → *Evaluate all designs*. Point at PASS ×8, NOT EVALUATED ×7 for A.
3. **Live simulator** → raise pack charge current from 10 A to 20 A. Point at TH-01 turning FAIL and the dependency graph.
4. **Thermal** → current sweep; **BMS & safety** for design B → EL-01 WARN and the NOT EVALUATED list with missing inputs.
5. **Design comparison** → B ranked first; show “Requirements not met” and the −0.5 penalty.
6. **AI assistant** → Safety Assistant, focus B, ask the question from `docs/AI_DEMO_RESULTS.md`. Warn the audience it takes 1–2 minutes on the Groq free tier; have the saved transcript ready as a fallback.

## Likely judge questions and honest answers

- **“Is it 11 models or 8 modules?”** 11 versioned model IDs, grouped into 8 categories (slide 6).
- **“Why is B faster?”** Because it charges at 20 A instead of 10 A. Cooling does not change charge time; the spreader only lowers temperature at the same current (slide 8 chart).
- **“What are REQ-02 and REQ-03?”** Team-set targets: module mass ≤ 3.0 kg and CC charge time ≤ 1.0 h (REQ-01: usable energy ≥ 200 Wh). Not from the case study.
- **“163 tests pass, so is it validated?”** No. Tests verify the code against hand calculations. Validation needs measured cell data, which we have not compared yet.
- **“15 safety checks?”** 15 implemented; with the illustrative cell only 8 can be evaluated, 7 are NOT EVALUATED because datasheet values are missing. Missing data never counts as a pass.
- **“Did you run Claude?”** The Claude integration is implemented and tested with a scripted model. Live runs were done on Groq (gpt-oss-120b) because no Anthropic key was available.
- **“Is the cell real?”** No. EXAMPLE-LFP-20AH is the illustrative stage-1 cell; all battery values are model estimates.
- **“How fast is it?”** 0.031 s engine time per evaluation, 0.19 s through the HTTP API (medians on a student laptop). That is software speed, not battery performance.
