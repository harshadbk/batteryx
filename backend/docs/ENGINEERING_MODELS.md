# Engineering models, equations, units and assumptions

These are first-order screening models for concept-level trade-offs on a small module. All outputs
are **estimates**. None of the models has been validated against measurements in this project.
`GET /api/v1/models` returns the same information at runtime.

Notation: S series, P parallel, N = S·P cells, Q cell capacity [Ah], R0 ohmic resistance [Ω],
I current [A], V voltage [V], T temperature [°C], w = (SOC_max − SOC_min)/100.

## 1. Cell database
- Stores datasheet fields with a `data_status`: `datasheet` (needs `datasheet_ref`), `user_entered`, `illustrative_example`.
- The only seeded cell is the stage-1 illustrative example. No specifications are invented. Missing fields stay `null`.

## 2. Series-parallel configuration (`configuration.series_parallel`, closed form)
| Quantity | Equation | Unit |
|---|---|---|
| Pack voltage (nom/max/min) | S·V_cell | V |
| Pack capacity | P·Q | Ah |
| Pack resistance (cells only) | S·R0/P | Ω |
| Cell-limited max current | P·Q·C_max | A |
Assumes identical cells. Variation is handled in §11.

## 3. Energy and power (`energy.nominal`, closed form)
| Quantity | Equation | Unit |
|---|---|---|
| Nominal energy | V_nom,pack·Q_pack | Wh |
| Usable energy | E_nom·w | Wh |
| Terminal power at I | V_nom·I − I²·R_total | W |
| Current at power P | (V − √(V² − 4R·P)) / (2R) | A |
| Ohmic efficiency | 1 − I·R_total/V_nom | – |
R_total = S·R0/P + R_interconnect (from §9). Limits: OCV taken as nominal and R constant. If P > V²/(4R), the result is flagged `POWER_NOT_DELIVERABLE`.

## 4. Closed-form charge/discharge estimates (`estimates.closed_form_time`)
t_charge,CC = ΔSOC/C-rate [h] (CC phase only, same basis as the stage-1 prototype). t_discharge = Q·w/I or E_usable/P.

## 5. Electrical simulation (`electrical.ecm_1rc`, simplified time domain)
1-RC Thevenin model per representative cell, using exact zero-order-hold steps with Δt = 1 s by default:
- SOC_{k+1} = SOC_k − I·Δt/(3600·Q)
- V1_{k+1} = V1·e^(−Δt/R1C1) + R1·I·(1 − e^(−Δt/R1C1))
- V = OCV(SOC) − I·R0 − V1 (I > 0 discharge)
- q = I²R0 + V1²/R1
- **CC-CV charge**: CC until V = V_max, then I = (OCV − V1 − V_max)/R0 until |I| ≤ I_cut (default 0.05C, flagged)
- **Discharge**: CC, or CP via R0·I² − (OCV − V1)·I + P = 0. Stops at V_min, SOC_min or max duration.
- Pack: V_pack = S·V − I_pack·R_ic. Energies are integrated from V·I and q.

Fallbacks: no R1/C1 → R0-only model (flagged as an assumption). No OCV table → OCV fixed at nominal and the CV phase and voltage cut-offs are **not modelled** (flagged `unsupported`). No R0 → no simulation.

## 6. Thermal (`thermal.lumped_single_node`): **SIMPLIFIED**
m·c_p·dT/dt = q − (T − T_amb)/R_th, with q = I_cell²·R0, τ = m·c_p·R_th, ΔT_ss = q·R_th,
T(t) = T_amb + ΔT_ss(1 − e^(−t/τ)), t_limit = −τ·ln(1 − (T_lim − T_amb)/ΔT_ss).
R_th is given directly, or computed as 1/(h·A_exposed). Cooling options change R_th, the added mass and the volume.
**Not modelled:** cell-to-cell conduction, centre vs edge cells, internal gradients, entropic heat,
R0(T), coolant temperature rise, thermal runaway.

## 7. Ageing (`ageing.simplified_assumption`): **SIMPLIFIED ASSUMPTION, not a degradation model**
Linear capacity retention from the datasheet cycle life, retention = 1 − (1 − EOL)·N/N_life, or user-given fade and resistance-growth rates.
Calendar, temperature, C-rate and DoD effects are not modelled. The aged state is fed into the same
energy, thermal and simulation models to show sensitivity.

## 8. BMS monitoring and safety checks (`bms.rule_checks`)
EL-01/02 C-rate, VL-01/02 simulated voltage window, TH-01/02 peak temperature, TH-03 ambient vs
charge window, PR-01..03 currents vs fuse/BMS limits, PR-04 fuse-above-BMS coordination,
PR-05 fuse vs cell-group capability, SE-01 temperature sensor count, SE-02 voltage channels,
BL-01 passive balancing time ΔSOC·Q/I_bleed, CT-01 max safe charge current (SciPy `brentq` on the
closed-form temperature, capped by the C-rate, fuse and BMS limits).
Statuses: PASS / WARN / FAIL / NOT_EVALUATED (a missing input is never shown as PASS).
**These checks screen a design. They are not a certification**, and they do not model fuse time-current curves or BMS response times.

## 9. Mechanical (`mechanical.grid_envelope`)
Rectangular grid (default: one row per series group). L = cols·f_x + (cols−1)·gap + 2·wall, and similarly for W and H.
Packing efficiency = N·V_cell/V_env. If dimensions are missing, V = N·V_cell·k_pack·k_cooling (flagged).
Busbars: A = I/J_allow, R = ρL/A, m = ρ_m·A·L, using (S−1) series links at the row pitch. Copper ρ = 1.724e-8 Ω·m and 8960 kg/m³;
aluminium ρ = 2.82e-8 Ω·m and 2700 kg/m³ (handbook values at 20 °C). Mass is the sum of the listed components, and any component left out is listed under `mass_excludes`.

## 10. Cost (`cost.bom_rollup`)
Currency roll-up (only with user/datasheet prices) and a relative index, N·(1 + k_cool) + k_BMS (one cell = 1.0, not a price).

## 11. Variation (`variation.monte_carlo`)
Normal sampling of R and Q (tolerance taken as ±3σ by default), seeded. Parallel current split
I_i = I·G_i/ΣG. The worst-cell temperature uses the closed-form thermal model. Usable energy is limited by the weakest series group.

## 12. Comparison (`comparison.constraint_first_weighted`)
Any safety FAIL makes a design ineligible. Each metric is min-max normalised within the compared set and weighted
(default: usable energy, CC charge time, peak charge temperature, mass, volume, relative cost). Each
requirement NOT_MET subtracts 0.5. The output lists deltas vs the baseline, trade-offs, risks and model limitations.

## Verification evidence available today
`tests/` checks the equations against hand calculations and analytical solutions (RC step
response, CC→CV transition SOC, CV termination SOC, constant-power hold, coupled thermal vs closed
form), energy conservation, and parity with the stage-1 JS engine. This is **verification of the
implementation**. It is not **validation against real batteries**, which still needs measured data.
