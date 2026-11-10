"""Design evaluation pipeline: runs every module in dependency order on one design and
collects a flat KPI set, requirement checks and all flags.

Order: configuration → mechanical (gives interconnect R) → energy → estimates → thermal →
       charge/discharge simulation → ageing → BMS checks → cost → KPIs → requirements
"""
from __future__ import annotations

from app.schemas.cell import CellSpec
from app.schemas.design import DesignInput, Requirement
from app.schemas.results import DISCLAIMER, RESULT_TYPE

from .ageing import ageing, ageing_factors
from .bms import bms
from .common import Flags, rnd
from .configuration import configure
from .cost import cost
from .electrical import run_simulation
from .energy import energy
from .estimates import estimates
from .mechanical import mechanical
from .thermal import thermal

# Comparable metrics: key -> (label, unit, better)
METRICS: dict[str, tuple[str, str, str]] = {
    "pack_voltage_nominal_v": ("Nominal pack voltage", "V", "info"),
    "pack_capacity_ah": ("Pack capacity", "Ah", "high"),
    "nominal_energy_wh": ("Nominal energy", "Wh", "high"),
    "usable_energy_wh": ("Usable energy", "Wh", "high"),
    "charge_current_a": ("Charge current", "A", "info"),
    "charge_c_rate": ("Charge C-rate", "C", "info"),
    "charge_time_cc_estimate_h": ("Charge time, CC estimate", "h", "low"),
    "charge_time_sim_h": ("Charge time, simulated", "h", "low"),
    "discharge_time_sim_h": ("Discharge time, simulated", "h", "high"),
    "discharge_energy_sim_wh": ("Delivered energy, simulated", "Wh", "high"),
    "discharge_efficiency_sim_pct": ("Discharge efficiency, simulated", "%", "high"),
    "peak_power_discharge_w": ("Peak discharge power, simulated", "W", "info"),
    "peak_cell_temp_charge_c": ("Est. peak cell temp, charge", "°C", "low"),
    "peak_cell_temp_discharge_c": ("Est. peak cell temp, discharge", "°C", "low"),
    "max_safe_charge_current_a": ("Max safe charge current", "A", "high"),
    "module_mass_kg": ("Module mass", "kg", "low"),
    "module_volume_l": ("Module volume", "L", "low"),
    "gravimetric_energy_density_wh_per_kg": ("Gravimetric energy density", "Wh/kg", "high"),
    "volumetric_energy_density_wh_per_l": ("Volumetric energy density", "Wh/L", "high"),
    "estimated_cost": ("Estimated cost", "currency", "low"),
    "relative_cost_index": ("Relative cost index", "index", "low"),
    "usable_energy_aged_wh": ("Usable energy, aged (assumption)", "Wh", "high"),
}


# KPI → module that computes it (its model id/version/equations come from that module's ModelInfo).
KPI_SOURCE = {
    "pack_voltage_nominal_v": "configuration", "pack_capacity_ah": "configuration",
    "nominal_energy_wh": "energy", "usable_energy_wh": "energy",
    "charge_current_a": "estimates", "charge_c_rate": "estimates", "charge_time_cc_estimate_h": "estimates",
    "charge_time_sim_h": "charge_simulation", "discharge_time_sim_h": "discharge_simulation",
    "discharge_energy_sim_wh": "discharge_simulation", "discharge_efficiency_sim_pct": "discharge_simulation",
    "peak_power_discharge_w": "discharge_simulation", "max_safe_charge_current_a": "bms",
    "module_mass_kg": "mechanical", "module_volume_l": "mechanical",
    "gravimetric_energy_density_wh_per_kg": "mechanical", "volumetric_energy_density_wh_per_l": "mechanical",
    "estimated_cost": "cost", "relative_cost_index": "cost", "usable_energy_aged_wh": "ageing",
}


def evaluate_requirements(reqs: list[Requirement], kpis: dict) -> list[dict]:
    out = []
    for r in reqs:
        x = kpis.get(r.metric)
        if r.metric not in METRICS:
            status, detail = "NOT_EVALUATED", f"Unknown metric '{r.metric}'"
        elif x is None:
            status, detail = "NOT_EVALUATED", f"Metric '{r.metric}' not available for this design (missing inputs)"
        else:
            ok = x >= r.value if r.operator == ">=" else x <= r.value
            status = "MET" if ok else "NOT_MET"
            detail = f"{x:.4g} {METRICS[r.metric][1]} vs {r.operator} {r.value:g}"
        out.append({"id": r.id, "metric": r.metric, "operator": r.operator, "target": r.value, "value": x,
                    "status": status, "detail": detail, "description": r.description})
    return out


def evaluate_design(cell: CellSpec, d: DesignInput, requirements: list[Requirement] | None = None) -> dict:
    cfg = configure(cell, d.series, d.parallel)
    mech = mechanical(cell, d)
    r_ic = mech.values.get("interconnect_resistance_ohm") or 0.0
    en = energy(cell, d, r_ic)
    est = estimates(cell, d, en.values)
    th = thermal(cell, d, est.values)
    ch = run_simulation("charge", cell, d, r_ic)
    dis = run_simulation("discharge", cell, d, r_ic)
    ag = ageing(cell, d)
    safety = bms(cell, d, est.values, ch.values, dis.values)
    cs = cost(cell, d, en.values["nominal_energy_wh"])

    aged_sims = {}
    af = Flags("ageing")
    cap_f, r_f, aged_ok = ageing_factors(cell, d, af)
    if aged_ok and cap_f > 0:
        aged_sims["charge_simulation_aged"] = run_simulation("charge", cell, d, r_ic, cap_f, r_f)
        aged_sims["discharge_simulation_aged"] = run_simulation("discharge", cell, d, r_ic, cap_f, r_f)

    modules = {"configuration": cfg, "mechanical": mech, "energy": en, "estimates": est, "thermal": th,
               "charge_simulation": ch, "discharge_simulation": dis, "ageing": ag, "bms": safety, "cost": cs, **aged_sims}

    mass = mech.values.get("module_mass_kg")
    vol = mech.values.get("envelope_volume_l", mech.values.get("module_volume_l"))
    e_nom = en.values["nominal_energy_wh"]
    t_charge_peak = ch.values.get("cell_temp_peak_c")
    if t_charge_peak is None:
        t_charge_peak = (th.values.get("charge") or {}).get("peak_temp_c")
    t_dis_peak = dis.values.get("cell_temp_peak_c")
    if t_dis_peak is None:
        t_dis_peak = (th.values.get("discharge") or {}).get("peak_temp_c")
    kpis = {
        "pack_voltage_nominal_v": cfg.values["pack_voltage_nominal_v"],
        "pack_capacity_ah": cfg.values["pack_capacity_ah"],
        "nominal_energy_wh": e_nom,
        "usable_energy_wh": en.values["usable_energy_wh"],
        "charge_current_a": est.values.get("charge_current_a"),
        "charge_c_rate": est.values.get("charge_c_rate"),
        "charge_time_cc_estimate_h": est.values.get("charge_time_cc_h"),
        "charge_time_sim_h": ch.values.get("duration_h"),
        "discharge_time_sim_h": dis.values.get("duration_h"),
        "discharge_energy_sim_wh": dis.values.get("terminal_energy_wh"),
        "discharge_efficiency_sim_pct": dis.values.get("efficiency_pct"),
        "peak_power_discharge_w": dis.values.get("pack_power_peak_w"),
        "peak_cell_temp_charge_c": t_charge_peak,
        "peak_cell_temp_discharge_c": t_dis_peak,
        "max_safe_charge_current_a": safety.values.get("max_safe_charge_current_a"),
        "module_mass_kg": mass,
        "module_volume_l": vol,
        "gravimetric_energy_density_wh_per_kg": rnd(e_nom / mass, 3) if mass else None,
        "volumetric_energy_density_wh_per_l": rnd(e_nom / vol, 3) if vol else None,
        "estimated_cost": cs.values.get("estimated_cost"),
        "relative_cost_index": cs.values.get("relative_cost_index"),
        "usable_energy_aged_wh": ag.values.get("usable_energy_aged_wh"),
    }
    sources = dict(KPI_SOURCE)
    sources["peak_cell_temp_charge_c"] = "charge_simulation" if ch.values.get("cell_temp_peak_c") is not None else "thermal"
    sources["peak_cell_temp_discharge_c"] = "discharge_simulation" if dis.values.get("cell_temp_peak_c") is not None else "thermal"
    kpi_trace = {k: {"module": sources[k], "model_id": modules[sources[k]].model.id, "model_version": modules[sources[k]].model.version,
                     "fidelity": modules[sources[k]].model.fidelity} for k, v in kpis.items() if v is not None}

    reqs = requirements if requirements is not None else d.requirements
    all_flags = [fl.model_dump() for m in modules.values() for fl in m.flags]
    return {
        "design_name": d.name,
        "role": d.role,
        "description": d.description,
        "result_type": RESULT_TYPE,
        "disclaimer": DISCLAIMER,
        "cell": {"id": cell.id, "manufacturer": cell.manufacturer, "model": cell.model, "chemistry": cell.chemistry.value,
                 "data_status": cell.data_status.value, "datasheet_ref": cell.datasheet_ref},
        "topology": cfg.values["topology"],
        "kpis": kpis,
        "kpi_units": {k: METRICS[k][1] for k in kpis},
        "kpi_trace": kpi_trace,
        "inputs": d.model_dump(mode="json", exclude_none=True, exclude={"cell", "requirements"}),
        "requirements": evaluate_requirements(reqs, kpis),
        "safety_summary": safety.values["summary"],
        "modules": {k: m.model_dump() for k, m in modules.items()},
        "flags": all_flags,
        "flag_counts": {s: sum(f["severity"] == s for f in all_flags) for s in ("missing_input", "unsupported", "assumption", "warning", "info")},
    }
