// Single source of truth for every design input: label, unit, help text, range and provenance tag.
// source: design (a design choice) | operating (operating condition) | engineer (engineer-set limit)
//         | assumption (modelling assumption the user must justify)

const f = (path, label, unit, help, extra = {}) => ({ path, label, unit, help, type: 'number', ...extra })

export const OPERATING_FIELDS = [
  f('operating.ambient_c', 'Ambient temperature', '°C', 'Air/coolant temperature around the module. Needed for every temperature estimate.', { source: 'operating', min: -40, max: 80, step: 1 }),
  f('operating.soc_min_pct', 'Usable SOC window: min', '%', 'Lower bound of the usable state-of-charge window (sets depth of discharge). Backend default 0 % if empty.', { source: 'operating', min: 0, max: 99, step: 5 }),
  f('operating.soc_max_pct', 'Usable SOC window: max', '%', 'Upper bound of the usable SOC window. Backend default 100 % if empty.', { source: 'operating', min: 1, max: 100, step: 5 }),
  f('operating.charge_current_a', 'Pack charge current (CC)', 'A', 'Constant-current phase charge current at pack terminals.', { source: 'design', min: 0, step: 1 }),
  f('operating.charge_start_soc_pct', 'Charge start SOC', '%', 'Defaults to the usable-window minimum.', { source: 'operating', min: 0, max: 99, step: 5 }),
  f('operating.charge_target_soc_pct', 'Charge target SOC', '%', 'Defaults to the usable-window maximum.', { source: 'operating', min: 1, max: 100, step: 5 }),
  f('operating.cv_cutoff_c_rate', 'CV termination current', 'C', 'Charge ends in the CV phase when current falls below this. Use the datasheet value; 0.05C is assumed (and flagged) if empty.', { source: 'design', min: 0.001, max: 1, step: 0.01 }),
  f('operating.discharge_current_a', 'Discharge current (CC)', 'A', 'Constant-current load. Give this OR a constant power, not both.', { source: 'operating', min: 0, step: 1 }),
  f('operating.discharge_power_w', 'Discharge power (CP)', 'W', 'Constant-power load at pack terminals. Give this OR a discharge current.', { source: 'operating', min: 0, step: 10 }),
]

export const COOLING_TYPES = [
  { value: 'natural_convection', label: 'Natural convection' },
  { value: 'heat_spreader', label: 'Aluminium heat spreader' },
  { value: 'forced_air', label: 'Forced air' },
  { value: 'liquid_cold_plate', label: 'Liquid cold plate' },
  { value: 'custom', label: 'Custom' },
]

export const THERMAL_FIELDS = [
  { path: 'thermal.cooling.type', label: 'Cooling concept', type: 'select', options: COOLING_TYPES, help: 'Label for the cooling concept. Its thermal effect comes only from the values below.', source: 'design' },
  f('thermal.cooling.r_th_cell_to_ambient_k_per_w', 'Thermal resistance cell → ambient', 'K/W', 'Lumped R_th per cell. Give this directly, or a convection coefficient h. Usually an assumption until measured.', { source: 'assumption', min: 0.01, step: 0.5 }),
  f('thermal.cooling.h_w_per_m2k', 'Convection coefficient h', 'W/m²·K', 'Used only if R_th is empty: R_th = 1/(h·A_exposed). Needs cell dimensions.', { source: 'assumption', min: 0.1, step: 1 }),
  f('thermal.cooling.exposed_area_fraction', 'Exposed area fraction', '–', 'Fraction of the cell surface reached by the coolant (0–1). Assumed 1 (optimistic) if empty.', { source: 'assumption', min: 0.01, max: 1, step: 0.05 }),
  f('thermal.cell_specific_heat_j_per_kgk', 'Cell specific heat', 'J/kg·K', 'Overrides the cell database value. Flagged as an assumption when not from the datasheet.', { source: 'assumption', min: 100, max: 5000, step: 10 }),
  f('thermal.cooling.added_mass_per_cell_kg', 'Cooling mass per cell', 'kg', 'Spreader / plate mass added per cell (thermal mass and module mass).', { source: 'design', min: 0, step: 0.01 }),
  f('thermal.cooling.added_volume_factor', 'Cooling volume factor', '×', 'Multiplier on module volume (used only in the volume fallback when cell dimensions are missing).', { source: 'assumption', min: 1, max: 3, step: 0.05 }),
  f('thermal.cooling.added_cost_per_cell', 'Cooling cost per cell', 'currency', 'In the same currency as the cost inputs.', { source: 'design', min: 0, step: 0.1 }),
  f('thermal.cooling.relative_cost_per_cell', 'Cooling relative cost per cell', 'index', 'Relative cost index units (one cell = 1.0).', { source: 'assumption', min: 0, step: 0.05 }),
  { path: 'thermal.cooling.source_note', label: 'Source / justification', type: 'text', help: 'Where the thermal values come from (e.g. "assumed", test report id).', source: 'assumption' },
]

export const LIMIT_FIELDS = [
  f('limits.max_cell_temp_charge_c', 'Max cell temperature (charge)', '°C', 'Engineer-set limit. Falls back to the datasheet charge maximum.', { source: 'engineer', min: -20, max: 100, step: 1 }),
  f('limits.max_cell_temp_discharge_c', 'Max cell temperature (discharge)', '°C', 'Engineer-set limit. Falls back to the datasheet discharge maximum.', { source: 'engineer', min: -20, max: 100, step: 1 }),
  f('limits.temp_warning_margin_k', 'Temperature warning margin', 'K', 'WARN when the estimate is within this margin of the limit. 2 K assumed if empty.', { source: 'engineer', min: 0, max: 30, step: 0.5 }),
  f('limits.fuse_rating_a', 'Fuse rating', 'A', 'Rated current of the pack fuse.', { source: 'engineer', min: 0, step: 1 }),
  f('limits.bms_max_charge_current_a', 'BMS max charge current', 'A', 'Charge over-current protection setting.', { source: 'engineer', min: 0, step: 1 }),
  f('limits.bms_max_discharge_current_a', 'BMS max discharge current', 'A', 'Discharge over-current protection setting.', { source: 'engineer', min: 0, step: 1 }),
  f('limits.temp_sensors_fitted', 'Temperature sensors fitted', 'pcs', 'Number of NTC/thermistor channels in the design.', { source: 'design', min: 0, step: 1, integer: true }),
  f('limits.max_cells_per_temp_sensor', 'Max cells per temperature sensor', 'cells', 'Monitoring rule: one sensor for at most this many cells.', { source: 'engineer', min: 1, step: 1, integer: true }),
  f('limits.voltage_sense_channels', 'Voltage sense channels', 'ch', 'BMS cell-voltage channels (need one per series group).', { source: 'design', min: 0, step: 1, integer: true }),
  f('limits.balancing_current_a', 'Passive balancing current', 'A', 'Bleed current per series group.', { source: 'design', min: 0.001, step: 0.01 }),
  f('limits.soc_imbalance_pct', 'SOC imbalance to correct', '%', 'Imbalance used to estimate balancing time.', { source: 'assumption', min: 0.1, max: 50, step: 0.5 }),
]

export const MECHANICAL_FIELDS = [
  f('mechanical.arrangement_rows', 'Grid rows', 'rows', 'Physical layout rows. Default: one row per series group.', { source: 'design', min: 1, step: 1, integer: true }),
  f('mechanical.cell_gap_mm', 'Cell gap', 'mm', 'Spacing between cells. Assumed 0 (touching) if empty.', { source: 'design', min: 0, step: 0.5 }),
  f('mechanical.wall_thickness_mm', 'Housing wall thickness', 'mm', 'Assumed 0 (bare cell block) if empty.', { source: 'design', min: 0, step: 0.5 }),
  f('mechanical.top_clearance_mm', 'Top clearance', 'mm', 'Space above cells for busbars and BMS.', { source: 'design', min: 0, step: 1 }),
  f('mechanical.housing_mass_kg', 'Housing mass', 'kg', 'Enclosure mass. Excluded from total (and flagged) if empty.', { source: 'assumption', min: 0, step: 0.05 }),
  f('mechanical.bms_mass_kg', 'BMS mass', 'kg', 'BMS board and harness.', { source: 'assumption', min: 0, step: 0.01 }),
  f('mechanical.interconnect_mass_per_cell_kg', 'Fixings / interconnect per cell', 'kg', 'Lumped mass of holders, fixings and connectors per cell.', { source: 'assumption', min: 0, step: 0.005 }),
  f('mechanical.volume_packing_factor', 'Volume packing factor', '×', 'Used only when cell dimensions are missing: V = N·V_cell·factor.', { source: 'assumption', min: 1, max: 5, step: 0.05 }),
]

export const BUSBAR_FIELDS = [
  { path: 'mechanical.busbar.material', label: 'Busbar material', type: 'select', options: [{ value: 'copper', label: 'Copper' }, { value: 'aluminium', label: 'Aluminium' }], help: 'Handbook resistivity and density at 20 °C are used.', source: 'design' },
  f('mechanical.busbar.current_density_a_per_mm2', 'Allowable current density', 'A/mm²', 'Engineer-chosen design current density.', { source: 'engineer', min: 0.1, max: 20, step: 0.5 }),
  f('mechanical.busbar.thickness_mm', 'Busbar thickness', 'mm', '', { source: 'design', min: 0.1, max: 20, step: 0.1 }),
]

export const COST_FIELDS = [
  { path: 'cost.currency', label: 'Currency', type: 'text', help: 'e.g. INR. Required for a currency estimate.', source: 'design' },
  f('cost.cell_unit_cost', 'Cell unit cost', 'currency', 'Overrides the cell database price.', { source: 'assumption', min: 0, step: 1 }),
  f('cost.bms_cost', 'BMS cost', 'currency', '', { source: 'assumption', min: 0, step: 1 }),
  f('cost.housing_cost', 'Housing cost', 'currency', '', { source: 'assumption', min: 0, step: 1 }),
  f('cost.other_cost', 'Other cost', 'currency', 'Wiring, fasteners, labels…', { source: 'assumption', min: 0, step: 1 }),
  f('cost.relative_bms_cost', 'BMS relative cost', 'index', 'Relative cost index units (one cell = 1.0).', { source: 'assumption', min: 0, step: 0.1 }),
]

export const AGEING_FIELDS = [
  { path: 'ageing.method', label: 'Ageing assumption', type: 'select', source: 'assumption', help: 'SIMPLIFIED linear assumptions, not a degradation model.',
    options: [{ value: 'none', label: 'None (fresh cells)' }, { value: 'linear_cycle_life', label: 'Linear from datasheet cycle life' }, { value: 'user_rates', label: 'User-entered fade rates' }] },
  f('ageing.cycles', 'Equivalent full cycles', 'cycles', '', { source: 'assumption', min: 0, step: 50, integer: true }),
  f('ageing.capacity_fade_pct_per_100_cycles', 'Capacity fade', '%/100 cyc', 'Only for user-entered rates.', { source: 'assumption', min: 0, max: 50, step: 0.1 }),
  f('ageing.resistance_growth_pct_per_100_cycles', 'Resistance growth', '%/100 cyc', 'If empty, aged resistance = fresh resistance (flagged).', { source: 'assumption', min: 0, max: 200, step: 0.5 }),
]

export const SIM_FIELDS = [
  f('simulation.time_step_s', 'Time step', 's', 'Integration step (default 1 s).', { source: 'design', min: 0.1, max: 60, step: 0.5 }),
  f('simulation.max_duration_h', 'Max duration', 'h', 'Safety stop for the simulation (default 24 h).', { source: 'design', min: 0.1, max: 200, step: 1 }),
  f('simulation.output_points', 'Output points', 'pts', 'Samples returned for charts (default 200).', { source: 'design', min: 10, max: 5000, step: 50, integer: true }),
]

export const ALL_FIELDS = [...OPERATING_FIELDS, ...THERMAL_FIELDS, ...LIMIT_FIELDS, ...MECHANICAL_FIELDS, ...BUSBAR_FIELDS,
  ...COST_FIELDS, ...AGEING_FIELDS, ...SIM_FIELDS]
export const FIELD_INDEX = Object.fromEntries(ALL_FIELDS.map((x) => [x.path, x]))

export const SOURCE_TAGS = {
  design: { label: 'Design', cls: 'bg-sky-50 text-sky-700 border-sky-200', tip: 'A design choice you make.' },
  operating: { label: 'Operating', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', tip: 'An operating condition of the application.' },
  engineer: { label: 'Engineer limit', cls: 'bg-violet-50 text-violet-700 border-violet-200', tip: 'An engineer-set limit or rule (not a datasheet value).' },
  assumption: { label: 'Assumption', cls: 'bg-amber-50 text-amber-800 border-amber-200', tip: 'A modelling assumption. Document its justification and validate it.' },
}

export const SUBSYSTEM_COLORS = {
  electrical: '#0E8C99', thermal: '#C77700', mechanical: '#5B6B8C', sensing: '#7A5BB0', protection: '#B23A48', control: '#2E7D4F',
}
