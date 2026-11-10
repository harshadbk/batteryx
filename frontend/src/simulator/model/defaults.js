// Every default here is an example or assumption for the demonstrator, never a measured value.
// Replace cell values with your own datasheet before drawing conclusions.

export const SOURCES = {
  datasheet: { label: 'Datasheet (example)', short: 'DS' },
  assumed: { label: 'Assumed', short: 'AS' },
  engineer: { label: 'Engineer-set', short: 'EN' },
  design: { label: 'Design choice', short: 'DE' },
  requirement: { label: 'Team requirement', short: 'RQ' },
}

export const SUBSYSTEMS = {
  electrical: { label: 'Electrical', color: '#0E8C99' },
  thermal: { label: 'Thermal', color: '#C77700' },
  mechanical: { label: 'Mechanical', color: '#5B6B8C' },
  sensing: { label: 'Sensing', color: '#7A5BB0' },
  protection: { label: 'Protection', color: '#B23A48' },
  control: { label: 'Control', color: '#2E7D4F' },
}

// Input parameters. `asm` links a parameter to an assumption id in ASSUMPTIONS.
export const PARAMS = [
  // cell (example LFP prismatic cell)
  { id: 'vNom', label: 'Cell nominal voltage', unit: 'V', value: 3.2, min: 3.0, max: 3.4, step: 0.05, group: 'Cell', source: 'datasheet', sub: 'electrical', asm: 'ASM-01' },
  { id: 'capAh', label: 'Cell capacity', unit: 'Ah', value: 20, min: 5, max: 100, step: 1, group: 'Cell', source: 'datasheet', sub: 'electrical', asm: 'ASM-01' },
  { id: 'rInt', label: 'Cell internal resistance', unit: 'mΩ', value: 8, min: 1, max: 20, step: 0.5, group: 'Cell', source: 'datasheet', sub: 'electrical', asm: 'ASM-02' },
  { id: 'maxC', label: 'Max charge rate', unit: 'C', value: 1.0, min: 0.2, max: 3, step: 0.1, group: 'Cell', source: 'datasheet', sub: 'electrical', asm: 'ASM-01' },
  { id: 'cellMass', label: 'Cell mass', unit: 'kg', value: 0.45, min: 0.1, max: 2, step: 0.01, group: 'Cell', source: 'datasheet', sub: 'mechanical', asm: 'ASM-01' },
  { id: 'cellVol', label: 'Cell volume', unit: 'L', value: 0.5, min: 0.1, max: 2, step: 0.01, group: 'Cell', source: 'datasheet', sub: 'mechanical', asm: 'ASM-11' },
  { id: 'cp', label: 'Cell specific heat', unit: 'J/kg·K', value: 1000, min: 700, max: 1400, step: 10, group: 'Cell', source: 'assumed', sub: 'thermal', asm: 'ASM-03' },

  // configuration (design choices)
  { id: 'S', label: 'Cells in series (S)', unit: '', value: 4, min: 1, max: 16, step: 1, group: 'Configuration', source: 'design', sub: 'electrical' },
  { id: 'P', label: 'Cells in parallel (P)', unit: '', value: 1, min: 1, max: 4, step: 1, group: 'Configuration', source: 'design', sub: 'electrical' },
  { id: 'iPack', label: 'Pack charge current', unit: 'A', value: 10, min: 1, max: 80, step: 1, group: 'Configuration', source: 'design', sub: 'control' },
  { id: 'cooling', label: 'Cooling', unit: '', value: 'passive', options: ['passive', 'spreader'], group: 'Configuration', source: 'design', sub: 'thermal' },
  { id: 'sensors', label: 'Temperature sensors fitted', unit: '', value: 2, min: 0, max: 16, step: 1, group: 'Configuration', source: 'design', sub: 'sensing' },

  // thermal path
  { id: 'rthPassive', label: 'Thermal resistance, passive', unit: 'K/W', value: 6, min: 1, max: 15, step: 0.5, group: 'Thermal path', source: 'assumed', sub: 'thermal', asm: 'ASM-04' },
  { id: 'rthSpreader', label: 'Thermal resistance, with spreader', unit: 'K/W', value: 3, min: 0.5, max: 10, step: 0.5, group: 'Thermal path', source: 'assumed', sub: 'thermal', asm: 'ASM-05' },
  { id: 'spreaderMass', label: 'Spreader mass per cell', unit: 'kg', value: 0.08, min: 0, max: 0.5, step: 0.01, group: 'Thermal path', source: 'assumed', sub: 'mechanical', asm: 'ASM-05' },

  // operating conditions
  { id: 'ambient', label: 'Ambient temperature', unit: '°C', value: 35, min: 0, max: 50, step: 1, group: 'Operating conditions', source: 'assumed', sub: 'thermal', asm: 'ASM-07' },
  { id: 'socStart', label: 'Charge start SoC', unit: '%', value: 20, min: 0, max: 50, step: 5, group: 'Operating conditions', source: 'assumed', sub: 'control', asm: 'ASM-09' },
  { id: 'socEnd', label: 'Charge end SoC (CC phase)', unit: '%', value: 90, min: 60, max: 100, step: 5, group: 'Operating conditions', source: 'assumed', sub: 'control', asm: 'ASM-09' },
  { id: 'dod', label: 'Usable depth of discharge', unit: '%', value: 80, min: 50, max: 100, step: 5, group: 'Operating conditions', source: 'assumed', sub: 'control', asm: 'ASM-08' },

  // engineer-set limits
  { id: 'tMax', label: 'Max cell temperature (charge)', unit: '°C', value: 45, min: 30, max: 60, step: 1, group: 'Engineer-set limits', source: 'engineer', sub: 'thermal' },
  { id: 'tMargin', label: 'Warning margin', unit: '°C', value: 2, min: 0, max: 10, step: 0.5, group: 'Engineer-set limits', source: 'engineer', sub: 'thermal' },
  { id: 'fuse', label: 'Fuse rating', unit: 'A', value: 30, min: 5, max: 150, step: 1, group: 'Engineer-set limits', source: 'engineer', sub: 'protection' },
  { id: 'bmsMax', label: 'BMS max charge current', unit: 'A', value: 25, min: 5, max: 150, step: 1, group: 'Engineer-set limits', source: 'engineer', sub: 'protection' },
  { id: 'cellsPerSensor', label: 'Cells per temperature sensor (max)', unit: '', value: 2, min: 1, max: 8, step: 1, group: 'Engineer-set limits', source: 'engineer', sub: 'sensing' },
]

// Team-proposed requirements for the demonstrator (not from the case study).
export const DEFAULT_REQUIREMENTS = [
  { id: 'REQ-01', text: 'Usable energy at least', metric: 'eUsable', op: '>=', value: 200, unit: 'Wh' },
  { id: 'REQ-02', text: 'Module mass at most', metric: 'mass', op: '<=', value: 3.0, unit: 'kg' },
  { id: 'REQ-03', text: 'Fast charge (CC phase) within', metric: 'tCharge', op: '<=', value: 1.0, unit: 'h' },
]

export const ASSUMPTIONS = [
  { id: 'ASM-01', text: 'Cell voltage, capacity, max charge rate and mass come from an example LFP prismatic datasheet; replace with the selected cell.' },
  { id: 'ASM-02', text: 'Internal resistance is constant over SoC and temperature (so heat scales with I²).' },
  { id: 'ASM-03', text: 'Cell specific heat is a typical value for LFP cells.' },
  { id: 'ASM-04', text: 'Passive cooling is modelled as one lumped thermal resistance from cell to ambient.' },
  { id: 'ASM-05', text: 'An aluminium heat spreader lowers that thermal resistance and adds mass per cell.' },
  { id: 'ASM-06', text: 'Each cell is one thermal node; no cell-to-cell heat sharing.' },
  { id: 'ASM-07', text: 'Ambient temperature reflects an outdoor solar installation.' },
  { id: 'ASM-08', text: 'Usable energy is limited by the chosen depth of discharge.' },
  { id: 'ASM-09', text: 'Charge time covers the constant-current phase only (start → end SoC); the CV tail is ignored.' },
  { id: 'ASM-10', text: 'Cost is a relative index (one cell = 1.0), not a price.' },
  { id: 'ASM-11', text: 'Module volume = cell volume × cell count × 1.3 packing factor (+10% with spreader).' },
]

// The three designs the case study asks us to compare (baseline + two alternatives).
export const OPTIONS = [
  { id: 'A', name: 'Baseline', blurb: '4S1P, 0.5C charge, passive cooling', patch: { S: 4, P: 1, iPack: 10, cooling: 'passive', sensors: 2 } },
  { id: 'B', name: 'Fast charge', blurb: '4S1P, 1C charge, aluminium heat spreader', patch: { S: 4, P: 1, iPack: 20, cooling: 'spreader', sensors: 2 } },
  { id: 'C', name: 'Parallel', blurb: '4S2P, same 20 A pack current, half the per-cell current', patch: { S: 4, P: 2, iPack: 20, cooling: 'passive', sensors: 4 } },
]

export const defaultParams = () => Object.fromEntries(PARAMS.map((p) => [p.id, p.value]))
export const paramDef = (id) => PARAMS.find((p) => p.id === id)
