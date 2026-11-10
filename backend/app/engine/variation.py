"""Cell-to-cell variation sweep (Monte-Carlo), ported from the stage-1 prototype and vectorised.

For each virtual module build, every cell gets
  R_i = R0 · (1 + σ_R·z),  Q_i = Q · (1 + σ_Q·z),   z ~ N(0,1),  σ = tol/3 if tolerance is ±3σ
Parallel cells share current inversely to resistance:  I_i = I_pack · (1/R_i) / Σ_group(1/R_j)
Worst-cell temperature: closed-form lumped thermal with that cell's heat I_i²·R_i over the group's CC time.
Usable energy is limited by the weakest series group:  E = S · V_nom · min_group(ΣQ) · w
Seeded (numpy default_rng) so results are repeatable.
"""
from __future__ import annotations

import numpy as np

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput, VariationInput
from app.schemas.results import ModelInfo, ModuleResult

from .common import Flags, r0_ohm, rnd
from .thermal import thermal_params

MODEL = ModelInfo(
    id="variation.monte_carlo", version="1.0.0", fidelity="statistical",
    label="Monte-Carlo cell tolerance propagation (closed-form models)",
    equations=["R_i = R0(1+σ_R z)", "Q_i = Q(1+σ_Q z)", "I_i = I·G_i/ΣG", "E = S·V_nom·min(ΣQ_group)·w"],
    assumptions=["Normal, independent capacity and resistance variation with the given tolerances.",
                 "Static current split by resistance only (OCV differences ignored).",
                 "No thermal coupling between cells."],
)


def variation(cell: CellSpec, d: DesignInput, vi: VariationInput) -> ModuleResult:
    f = Flags("variation")
    S, P, op = d.series, d.parallel, d.operating
    r0 = r0_ohm(cell)
    v: dict = {"samples": vi.samples, "seed": vi.seed, "capacity_tolerance_pct": vi.capacity_tolerance_pct,
               "resistance_tolerance_pct": vi.resistance_tolerance_pct}
    div = 3.0 if vi.tolerance_is_3_sigma else 1.0
    rng = np.random.default_rng(vi.seed)
    caps = cell.capacity_ah * (1 + vi.capacity_tolerance_pct / 100 / div * rng.standard_normal((vi.samples, S, P)))
    w = (op.soc_max_pct - op.soc_min_pct) / 100
    group_ah = caps.sum(axis=2)
    e = S * cell.nominal_voltage_v * group_ah.min(axis=1) * w
    v["usable_energy_wh"] = _summ(e, 3)
    if r0 is None:
        f.missing("cell.internal_resistance_mohm", "current sharing and temperature spread")
        return ModuleResult(module="variation", model=MODEL, values=v, flags=f.items)
    rs = r0 * (1 + vi.resistance_tolerance_pct / 100 / div * rng.standard_normal((vi.samples, S, P)))
    if (rs <= 0).any() or (caps <= 0).any():
        f.add("warning", "NON_PHYSICAL_SAMPLES", "Some sampled values were ≤ 0 (tolerance too large); they were clipped.")
        rs = np.clip(rs, 1e-6, None)
    if op.charge_current_a is None:
        f.missing("operating.charge_current_a", "current sharing and temperature spread")
        return ModuleResult(module="variation", model=MODEL, values=v, flags=f.items)
    g = 1 / rs
    i_cell = op.charge_current_a * g / g.sum(axis=2, keepdims=True)
    v["max_cell_current_share_pct"] = _summ((i_cell / op.charge_current_a).max(axis=(1, 2)) * 100, 3)
    tp = thermal_params(cell, d, f)
    if tp is not None:
        start = op.charge_start_soc_pct if op.charge_start_soc_pct is not None else op.soc_min_pct
        target = op.charge_target_soc_pct if op.charge_target_soc_pct is not None else op.soc_max_pct
        t_ch_s = (target - start) / 100 * group_ah / op.charge_current_a * 3600  # (n, S)
        q = i_cell ** 2 * rs
        temps = op.ambient_c + q * tp.r_th * (1 - np.exp(-t_ch_s[:, :, None] / tp.tau_s))
        v["worst_cell_temp_charge_c"] = _summ(temps.max(axis=(1, 2)), 3)
        v["cell_temp_spread_k"] = _summ(temps.max(axis=(1, 2)) - temps.min(axis=(1, 2)), 4)
    return ModuleResult(module="variation", model=MODEL, values=v, flags=f.items)


def _summ(x: np.ndarray, d: int) -> dict:
    return {"min": rnd(x.min(), d), "p5": rnd(np.percentile(x, 5), d), "p50": rnd(np.percentile(x, 50), d),
            "mean": rnd(x.mean(), d), "p95": rnd(np.percentile(x, 95), d), "max": rnd(x.max(), d)}
