"""BMS monitoring and safety rule checks (deterministic).

These are design-screening checks against datasheet and engineer-set limits. They are NOT a
safety certification and do not replace standard-based testing or a functional-safety analysis.

Status logic (WARN thresholds retained from the stage-1 prototype):
  EL-01/02  C-rate ≤ max C            FAIL if >, WARN if > 90 % of max
  TH-01/02  T_peak ≤ T_limit          FAIL if >, WARN if > T_limit − margin
  TH-03     T_amb within charge temperature window
  PR-01     I_charge ≤ fuse           FAIL if >, WARN if > 80 % of fuse
  PR-02/03  I ≤ BMS current limit     FAIL if >, WARN if > 90 %
  PR-04     fuse > BMS limit          WARN otherwise (fuse could open before the BMS acts)
  PR-05     fuse ≤ cell-group max discharge current, else WARN (fuse alone does not protect cells)
  VL-01/02  simulated cell voltage within V_min..V_max
  SE-01     sensors ≥ ceil(N / cells_per_sensor)
  SE-02     voltage channels ≥ S
  BL-01     passive balancing time t = ΔSOC·Q_group / I_bleed   (information)
  CT-01     max safe charge current = largest I satisfying EL-01, PR-01, PR-02 and
            T_peak(I) ≤ T_limit − margin (closed-form thermal), solved with scipy.optimize.brentq
"""
from __future__ import annotations

import math

from scipy.optimize import brentq

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput
from app.schemas.results import Check, ModelInfo, ModuleResult

from .common import Flags, r0_ohm, rnd
from .thermal import ThermalParams, temp_at, thermal_params

MODEL = ModelInfo(
    id="bms.rule_checks", version="1.0.0", fidelity="rule_check",
    label="Deterministic limit, protection-coordination and sensing checks",
    equations=["status = f(value, limit, margin)", "t_bal = ΔSOC·Q/I_bleed", "I_safe = max I s.t. all limits hold (brentq)"],
    assumptions=["Checks screen the design against stated limits; they are not a safety certification.",
                 "Fuse time–current characteristics and BMS response times are not modelled.",
                 "Temperature checks use the simplified lumped thermal estimate."],
)

DEFAULT_MARGIN_K = 2.0


def _ck(cid, sub, desc, status, detail, value=None, limit=None, unit=None, src=None, basis=None) -> Check:
    return Check(id=cid, subsystem=sub, description=desc, status=status, value=rnd(value, 4), limit=rnd(limit, 4),
                 unit=unit, limit_source=src, basis=basis, detail=detail)


def _ne(cid, sub, desc, missing) -> Check:
    return _ck(cid, sub, desc, "NOT_EVALUATED", f"Missing input: {missing}")


def _upper(cid, sub, desc, value, limit, warn_frac, unit, src, basis=None) -> Check:
    if value > limit + 1e-9:
        st = "FAIL"
    elif value > warn_frac * limit:
        st = "WARN"
    else:
        st = "PASS"
    return _ck(cid, sub, desc, st, f"{value:.4g} {unit} vs limit {limit:.4g} {unit}", value, limit, unit, src, basis)


def _temp_check(cid, desc, t_peak, limit, margin, src, basis) -> Check:
    st = "FAIL" if t_peak > limit else ("WARN" if t_peak > limit - margin else "PASS")
    return _ck(cid, "thermal", desc, st, f"{t_peak:.2f} °C vs limit {limit:g} °C (margin {limit - t_peak:.2f} K)",
               t_peak, limit, "°C", src, basis)


def max_safe_charge_current(cell: CellSpec, d: DesignInput, tp: ThermalParams | None, t_limit: float | None, margin: float) -> tuple[float | None, list[str]]:
    """Largest pack charge current meeting every available constraint. Returns (I, binding constraints)."""
    S, P, op = d.series, d.parallel, d.operating
    q = P * cell.capacity_ah
    caps: list[tuple[float, str]] = []
    if cell.max_charge_c_rate is not None:
        caps.append((q * cell.max_charge_c_rate, "cell max charge C-rate"))
    if d.limits.fuse_rating_a is not None:
        caps.append((d.limits.fuse_rating_a, "fuse rating"))
    if d.limits.bms_max_charge_current_a is not None:
        caps.append((d.limits.bms_max_charge_current_a, "BMS charge limit"))
    if tp is None or t_limit is None or r0_ohm(cell) is None or op.ambient_c is None:
        if not caps:
            return None, []
        lim = min(caps)
        return lim[0], [lim[1] + " (temperature not evaluated)"]
    start = op.charge_start_soc_pct if op.charge_start_soc_pct is not None else op.soc_min_pct
    target = op.charge_target_soc_pct if op.charge_target_soc_pct is not None else op.soc_max_pct
    target_t = t_limit - margin
    r0 = r0_ohm(cell)

    def g(i_pack: float) -> float:
        i_cell = i_pack / P
        t_h = (target - start) / 100 / (i_pack / q)
        return temp_at(op.ambient_c, i_cell ** 2 * r0, tp, t_h * 3600) - target_t

    hi = min(caps)[0] if caps else 100 * q
    lo = 1e-3 * q
    if g(lo) > 0:
        return 0.0, ["temperature (ambient already at/above limit − margin)"]
    if g(hi) <= 0:
        return hi, [min(caps)[1]] if caps else ["search bound 100C (no other limit given)"]
    return brentq(g, lo, hi, xtol=1e-6), ["peak temperature limit − margin"]


def bms(cell: CellSpec, d: DesignInput, est: dict, charge_sim: dict, discharge_sim: dict) -> ModuleResult:
    f = Flags("bms")
    L, op = d.limits, d.operating
    S, P = d.series, d.parallel
    n = S * P
    q = P * cell.capacity_ah
    checks: list[Check] = []
    margin = L.temp_warning_margin_k
    if margin is None:
        margin = DEFAULT_MARGIN_K
        f.assume("TEMP_MARGIN_DEFAULT", f"Temperature warning margin not set: {DEFAULT_MARGIN_K} K default.", "limits.temp_warning_margin_k")

    # electrical C-rate
    i_ch = op.charge_current_a
    i_dis = est.get("discharge_current_a")
    if i_ch is None:
        checks.append(_ne("EL-01", "electrical", "Charge C-rate within cell maximum", "operating.charge_current_a"))
    elif cell.max_charge_c_rate is None:
        checks.append(_ne("EL-01", "electrical", "Charge C-rate within cell maximum", "cell.max_charge_c_rate"))
    else:
        checks.append(_upper("EL-01", "electrical", "Charge C-rate within cell maximum", i_ch / q, cell.max_charge_c_rate, 0.9, "C", "cell datasheet"))
    if i_dis is None:
        checks.append(_ne("EL-02", "electrical", "Discharge C-rate within cell maximum", "operating.discharge_current_a"))
    elif cell.max_discharge_c_rate is None:
        checks.append(_ne("EL-02", "electrical", "Discharge C-rate within cell maximum", "cell.max_discharge_c_rate"))
    else:
        checks.append(_upper("EL-02", "electrical", "Discharge C-rate within cell maximum", i_dis / q, cell.max_discharge_c_rate, 0.9, "C", "cell datasheet"))

    # voltage (from time-domain simulation)
    if charge_sim.get("cell_voltage_max_v") is not None and cell.max_voltage_v is not None and cell.ocv_curve:
        vmax = charge_sim["cell_voltage_max_v"]
        st = "FAIL" if vmax > cell.max_voltage_v + 1e-3 else "PASS"
        checks.append(_ck("VL-01", "electrical", "Simulated cell voltage ≤ V_max during charge", st,
                          f"{vmax:.4f} V vs {cell.max_voltage_v} V", vmax, cell.max_voltage_v, "V", "cell datasheet", "time-domain simulation"))
    else:
        checks.append(_ne("VL-01", "electrical", "Simulated cell voltage ≤ V_max during charge", "cell.max_voltage_v / cell.ocv_curve / charge simulation"))
    if discharge_sim.get("cell_voltage_min_v") is not None and cell.min_voltage_v is not None and cell.ocv_curve:
        vmin = discharge_sim["cell_voltage_min_v"]
        st = "FAIL" if vmin < cell.min_voltage_v - 0.05 else "PASS"  # one-step overshoot tolerance
        checks.append(_ck("VL-02", "electrical", "Simulated cell voltage ≥ V_min during discharge", st,
                          f"{vmin:.4f} V vs {cell.min_voltage_v} V", vmin, cell.min_voltage_v, "V", "cell datasheet", "time-domain simulation"))
    else:
        checks.append(_ne("VL-02", "electrical", "Simulated cell voltage ≥ V_min during discharge", "cell.min_voltage_v / cell.ocv_curve / discharge simulation"))

    # thermal
    tp = thermal_params(cell, d, Flags("thermal"))
    lim_c = L.max_cell_temp_charge_c if L.max_cell_temp_charge_c is not None else cell.charge_temp_max_c
    src_c = "engineer-set" if L.max_cell_temp_charge_c is not None else "cell datasheet"
    lim_d = L.max_cell_temp_discharge_c if L.max_cell_temp_discharge_c is not None else cell.discharge_temp_max_c
    src_d = "engineer-set" if L.max_cell_temp_discharge_c is not None else "cell datasheet"

    def peak(sim: dict, i_cell: float | None, dur_h: float | None):
        if sim.get("cell_temp_peak_c") is not None:
            return sim["cell_temp_peak_c"], "time-domain simulation (lumped thermal)"
        if tp is not None and i_cell is not None and dur_h:
            return temp_at(op.ambient_c, i_cell ** 2 * r0_ohm(cell), tp, dur_h * 3600), "closed-form lumped thermal"
        return None, None

    t_c, b_c = peak(charge_sim, est.get("charge_current_per_cell_a"), est.get("charge_time_cc_h"))
    if lim_c is None:
        checks.append(_ne("TH-01", "thermal", "Peak cell temperature during charge within limit", "limits.max_cell_temp_charge_c (or cell.charge_temp_max_c)"))
    elif t_c is None:
        checks.append(_ne("TH-01", "thermal", "Peak cell temperature during charge within limit", "thermal inputs / charge current"))
    else:
        checks.append(_temp_check("TH-01", "Peak cell temperature during charge within limit", t_c, lim_c, margin, src_c, b_c))
    t_d, b_d = peak(discharge_sim, est.get("discharge_current_per_cell_a"), est.get("discharge_time_h"))
    if lim_d is None:
        checks.append(_ne("TH-02", "thermal", "Peak cell temperature during discharge within limit", "limits.max_cell_temp_discharge_c (or cell.discharge_temp_max_c)"))
    elif t_d is None:
        checks.append(_ne("TH-02", "thermal", "Peak cell temperature during discharge within limit", "thermal inputs / discharge current"))
    else:
        checks.append(_temp_check("TH-02", "Peak cell temperature during discharge within limit", t_d, lim_d, margin, src_d, b_d))
    if op.ambient_c is None or cell.charge_temp_min_c is None or cell.charge_temp_max_c is None:
        checks.append(_ne("TH-03", "thermal", "Ambient within cell charge temperature window", "operating.ambient_c / cell.charge_temp_min_c / cell.charge_temp_max_c"))
    else:
        ok = cell.charge_temp_min_c <= op.ambient_c <= cell.charge_temp_max_c
        checks.append(_ck("TH-03", "thermal", "Ambient within cell charge temperature window", "PASS" if ok else "FAIL",
                          f"{op.ambient_c} °C vs window {cell.charge_temp_min_c}–{cell.charge_temp_max_c} °C",
                          op.ambient_c, cell.charge_temp_max_c, "°C", "cell datasheet"))

    # protection
    if i_ch is not None and L.fuse_rating_a is not None:
        checks.append(_upper("PR-01", "protection", "Charge current below fuse rating", i_ch, L.fuse_rating_a, 0.8, "A", "engineer-set"))
    else:
        checks.append(_ne("PR-01", "protection", "Charge current below fuse rating", "operating.charge_current_a / limits.fuse_rating_a"))
    if i_ch is not None and L.bms_max_charge_current_a is not None:
        checks.append(_upper("PR-02", "protection", "Charge current within BMS charge limit", i_ch, L.bms_max_charge_current_a, 0.9, "A", "engineer-set"))
    else:
        checks.append(_ne("PR-02", "protection", "Charge current within BMS charge limit", "operating.charge_current_a / limits.bms_max_charge_current_a"))
    if i_dis is not None and L.bms_max_discharge_current_a is not None:
        checks.append(_upper("PR-03", "protection", "Discharge current within BMS discharge limit", i_dis, L.bms_max_discharge_current_a, 0.9, "A", "engineer-set"))
    else:
        checks.append(_ne("PR-03", "protection", "Discharge current within BMS discharge limit", "discharge current / limits.bms_max_discharge_current_a"))
    bms_lim = max(x for x in (L.bms_max_charge_current_a, L.bms_max_discharge_current_a, 0) if x is not None)
    if L.fuse_rating_a is not None and bms_lim > 0:
        ok = L.fuse_rating_a > bms_lim
        checks.append(_ck("PR-04", "protection", "Fuse rated above BMS current limits (coordination)", "PASS" if ok else "WARN",
                          f"fuse {L.fuse_rating_a} A vs highest BMS limit {bms_lim} A" + ("" if ok else ": fuse may open before the BMS reacts"),
                          L.fuse_rating_a, bms_lim, "A", "engineer-set"))
    else:
        checks.append(_ne("PR-04", "protection", "Fuse rated above BMS current limits (coordination)", "limits.fuse_rating_a / BMS limits"))
    if L.fuse_rating_a is not None and cell.max_discharge_c_rate is not None:
        i_cells = q * cell.max_discharge_c_rate
        ok = L.fuse_rating_a <= i_cells
        checks.append(_ck("PR-05", "protection", "Fuse rating not above cell-group discharge capability", "PASS" if ok else "WARN",
                          f"fuse {L.fuse_rating_a} A vs cell-limited {i_cells:.4g} A" + ("" if ok else ": fuse alone does not protect the cells"),
                          L.fuse_rating_a, i_cells, "A", "cell datasheet"))
    else:
        checks.append(_ne("PR-05", "protection", "Fuse rating not above cell-group discharge capability", "limits.fuse_rating_a / cell.max_discharge_c_rate"))

    # sensing
    if L.temp_sensors_fitted is not None and L.max_cells_per_temp_sensor is not None:
        req = math.ceil(n / L.max_cells_per_temp_sensor)
        checks.append(_ck("SE-01", "sensing", "Enough temperature sensors for the cell count",
                          "PASS" if L.temp_sensors_fitted >= req else "FAIL",
                          f"{L.temp_sensors_fitted} fitted vs {req} required", L.temp_sensors_fitted, req, "sensors", "engineer-set"))
    else:
        checks.append(_ne("SE-01", "sensing", "Enough temperature sensors for the cell count", "limits.temp_sensors_fitted / limits.max_cells_per_temp_sensor"))
    if L.voltage_sense_channels is not None:
        checks.append(_ck("SE-02", "sensing", "One voltage sense channel per series group",
                          "PASS" if L.voltage_sense_channels >= S else "FAIL",
                          f"{L.voltage_sense_channels} channels vs {S} series groups", L.voltage_sense_channels, S, "channels", "design"))
    else:
        checks.append(_ne("SE-02", "sensing", "One voltage sense channel per series group", "limits.voltage_sense_channels"))

    v: dict = {}
    # balancing
    if L.balancing_current_a is not None and L.soc_imbalance_pct is not None:
        t_bal = L.soc_imbalance_pct / 100 * q / L.balancing_current_a
        v["balancing"] = {"method": "passive bleed", "time_to_balance_h": rnd(t_bal, 3),
                          "bleed_heat_per_group_w": rnd(L.balancing_current_a * cell.nominal_voltage_v, 4),
                          "equation": "t = ΔSOC·Q_group / I_bleed ; P_bleed ≈ I_bleed·V_nom"}
    else:
        f.add("info", "BALANCING_NOT_EVALUATED", "Balancing time not evaluated (needs limits.balancing_current_a and limits.soc_imbalance_pct).")

    # control: max safe charge current
    i_safe, binding = max_safe_charge_current(cell, d, tp, lim_c, margin)
    if i_safe is None:
        ct = _ne("CT-01", "control", "Charge-current recommendation", "cell max C-rate, fuse/BMS limits or thermal inputs")
    else:
        over = i_ch is not None and i_ch > i_safe + 1e-6
        if i_safe <= 0:
            msg = (f"No charge current keeps the estimated cell temperature below the warning threshold "
                   f"(ambient {op.ambient_c} °C vs limit − margin {lim_c - margin:g} °C): inhibit charging or improve cooling")
        elif over:
            msg = f"Derate charge current to ≤ {i_safe:.2f} A"
        else:
            msg = f"Charge current within all evaluated limits (max ≈ {i_safe:.2f} A)"
        ct = _ck("CT-01", "control", "Charge-current recommendation", "WARN" if over else "PASS",
                 msg + f"; binding: {', '.join(binding)}", i_ch, i_safe, "A", "computed", "closed-form thermal + limits")
        v["max_safe_charge_current_a"] = rnd(i_safe, 4)
        v["max_safe_charge_binding_constraints"] = binding
    checks.append(ct)

    counts = {s: sum(c.status == s for c in checks) for s in ("PASS", "WARN", "FAIL", "NOT_EVALUATED")}
    v["checks"] = [c.model_dump() for c in checks]
    v["summary"] = counts
    v["safety_disclaimer"] = "Design-screening rule checks only. Not a safety certification; physical testing to applicable standards is required."
    if counts["NOT_EVALUATED"]:
        f.add("warning", "CHECKS_NOT_EVALUATED", f"{counts['NOT_EVALUATED']} checks not evaluated because inputs are missing; absence of FAIL does not mean safe.")
    return ModuleResult(module="bms", model=MODEL, values=v, flags=f.items)
