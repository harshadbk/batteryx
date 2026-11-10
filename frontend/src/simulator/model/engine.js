// BatteryWeave demo engine: physics calculations, deterministic rule checks,
// a dependency graph for impact propagation, grounded explanations and comparisons.
import { PARAMS, ASSUMPTIONS, OPTIONS, paramDef } from './defaults.js'

const HOUSING_BASE_KG = 0.3 // assumed enclosure + BMS board mass
const HOUSING_PER_CELL_KG = 0.05 // assumed busbars / fixings per cell
const SPREADER_COST = 0.15 // relative cost per cell
const BMS_COST = 1.0 // relative cost of BMS + enclosure

// ---------------------------------------------------------------- calculations (the "physics engine")
// Each calc declares its inputs so the dependency graph can be derived from the model itself.
export const CALCS = [
  { id: 'cells', label: 'Cell count', unit: '', sub: 'mechanical', deps: ['S', 'P'], formula: 'S × P', f: (v) => v.S * v.P },
  { id: 'vPack', label: 'Pack voltage', unit: 'V', sub: 'electrical', deps: ['S', 'vNom'], formula: 'S × V_nom', f: (v) => v.S * v.vNom },
  { id: 'capPack', label: 'Pack capacity', unit: 'Ah', sub: 'electrical', deps: ['P', 'capAh'], formula: 'P × C_cell', f: (v) => v.P * v.capAh },
  { id: 'eNom', label: 'Nominal energy', unit: 'Wh', sub: 'electrical', deps: ['vPack', 'capPack'], formula: 'V_pack × Ah_pack', f: (v) => v.vPack * v.capPack },
  { id: 'eUsable', label: 'Usable energy', unit: 'Wh', sub: 'electrical', deps: ['eNom', 'dod'], formula: 'E_nom × DoD', f: (v) => v.eNom * v.dod / 100 },
  { id: 'iCell', label: 'Current per cell', unit: 'A', sub: 'electrical', deps: ['iPack', 'P'], formula: 'I_pack ÷ P', f: (v) => v.iPack / v.P },
  { id: 'cRate', label: 'Cell C-rate', unit: 'C', sub: 'electrical', deps: ['iCell', 'capAh'], formula: 'I_cell ÷ C_cell', f: (v) => v.iCell / v.capAh },
  { id: 'tCharge', label: 'Charge time (CC phase)', unit: 'h', sub: 'control', deps: ['cRate', 'socStart', 'socEnd'], formula: '(SoC_end − SoC_start) ÷ C-rate', f: (v) => (v.socEnd - v.socStart) / 100 / v.cRate },
  { id: 'qCell', label: 'Heat per cell', unit: 'W', sub: 'thermal', deps: ['iCell', 'rInt'], formula: 'I_cell² × R_int', f: (v) => v.iCell ** 2 * v.rInt / 1000 },
  { id: 'qPack', label: 'Module heat', unit: 'W', sub: 'thermal', deps: ['qCell', 'cells'], formula: 'q_cell × cells', f: (v) => v.qCell * v.cells },
  { id: 'rth', label: 'Thermal resistance in use', unit: 'K/W', sub: 'thermal', deps: ['cooling', 'rthPassive', 'rthSpreader'], formula: 'cooling = spreader ? R_th,spreader : R_th,passive', f: (v) => (v.cooling === 'spreader' ? v.rthSpreader : v.rthPassive) },
  { id: 'mCellEff', label: 'Thermal mass per cell', unit: 'kg', sub: 'thermal', deps: ['cellMass', 'cooling', 'spreaderMass'], formula: 'm_cell (+ spreader mass)', f: (v) => v.cellMass + (v.cooling === 'spreader' ? v.spreaderMass : 0) },
  { id: 'tau', label: 'Thermal time constant', unit: 'min', sub: 'thermal', deps: ['mCellEff', 'cp', 'rth'], formula: 'm × c_p × R_th', f: (v) => v.mCellEff * v.cp * v.rth / 60 },
  { id: 'dTss', label: 'Steady-state temperature rise', unit: 'K', sub: 'thermal', deps: ['qCell', 'rth'], formula: 'q_cell × R_th', f: (v) => v.qCell * v.rth },
  { id: 'tPeak', label: 'Est. peak cell temperature', unit: '°C', sub: 'thermal', deps: ['ambient', 'dTss', 'tCharge', 'tau'], formula: 'T_amb + ΔT_ss × (1 − e^(−t/τ))', f: (v) => v.ambient + v.dTss * (1 - Math.exp(-(v.tCharge * 60) / v.tau)) },
  { id: 'mass', label: 'Module mass', unit: 'kg', sub: 'mechanical', deps: ['cells', 'cellMass', 'cooling', 'spreaderMass'], formula: 'cells × (m_cell + spreader) + housing', f: (v) => v.cells * (v.cellMass + (v.cooling === 'spreader' ? v.spreaderMass : 0)) + HOUSING_BASE_KG + HOUSING_PER_CELL_KG * v.cells },
  { id: 'volume', label: 'Module volume', unit: 'L', sub: 'mechanical', deps: ['cells', 'cellVol', 'cooling'], formula: 'cells × V_cell × 1.3 (× 1.1 with spreader)', f: (v) => v.cells * v.cellVol * 1.3 * (v.cooling === 'spreader' ? 1.1 : 1) },
  { id: 'cost', label: 'Relative cost', unit: 'index', sub: 'mechanical', deps: ['cells', 'cooling'], formula: 'cells × (1 + spreader) + BMS', f: (v) => v.cells * (1 + (v.cooling === 'spreader' ? SPREADER_COST : 0)) + BMS_COST },
  { id: 'sensorsReq', label: 'Sensors required', unit: '', sub: 'sensing', deps: ['cells', 'cellsPerSensor'], formula: 'ceil(cells ÷ cells per sensor)', f: (v) => Math.ceil(v.cells / v.cellsPerSensor) },
]

const CALC_BY_ID = Object.fromEntries(CALCS.map((c) => [c.id, c]))

// ---------------------------------------------------------------- rules (the "constraint engine")
export const RULES = [
  { id: 'TH-01', sub: 'thermal', label: 'Peak cell temperature within engineer limit', deps: ['tPeak', 'tMax', 'tMargin'],
    eval: (v) => (v.tPeak > v.tMax ? 'FAIL' : v.tPeak > v.tMax - v.tMargin ? 'WARN' : 'PASS'),
    detail: (v) => `${fmt(v.tPeak, 1)} °C vs limit ${v.tMax} °C (margin ${fmt(v.tMax - v.tPeak, 1)} K)` },
  { id: 'EL-01', sub: 'electrical', label: 'Cell C-rate within datasheet maximum', deps: ['cRate', 'maxC'],
    eval: (v) => (v.cRate > v.maxC + 1e-9 ? 'FAIL' : v.cRate > 0.9 * v.maxC ? 'WARN' : 'PASS'),
    detail: (v) => `${fmt(v.cRate, 2)}C vs max ${v.maxC}C` },
  { id: 'PR-01', sub: 'protection', label: 'Pack current below fuse rating', deps: ['iPack', 'fuse'],
    eval: (v) => (v.iPack > v.fuse ? 'FAIL' : v.iPack > 0.8 * v.fuse ? 'WARN' : 'PASS'),
    detail: (v) => `${v.iPack} A vs fuse ${v.fuse} A` },
  { id: 'PR-02', sub: 'protection', label: 'Pack current within BMS charge limit', deps: ['iPack', 'bmsMax'],
    eval: (v) => (v.iPack > v.bmsMax ? 'FAIL' : v.iPack > 0.9 * v.bmsMax ? 'WARN' : 'PASS'),
    detail: (v) => `${v.iPack} A vs BMS ${v.bmsMax} A` },
  { id: 'SE-01', sub: 'sensing', label: 'Enough temperature sensors for the cell count', deps: ['sensors', 'sensorsReq'],
    eval: (v) => (v.sensors < v.sensorsReq ? 'FAIL' : 'PASS'),
    detail: (v) => `${v.sensors} fitted vs ${v.sensorsReq} required` },
]

export const SAFETY_RULES = ['TH-01', 'EL-01', 'PR-01', 'PR-02', 'SE-01']

export function fmt(x, d = 2) {
  if (typeof x !== 'number' || !isFinite(x)) return String(x)
  return x.toFixed(d).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m)) || '0'
}

// ---------------------------------------------------------------- evaluate a design
export function evaluate(params, requirements) {
  const v = { ...params }
  for (const c of CALCS) v[c.id] = c.f(v)
  const checks = RULES.map((r) => ({ id: r.id, sub: r.sub, label: r.label, deps: r.deps, status: r.eval(v), detail: r.detail(v), kind: 'rule' }))
  const reqs = requirements.map((q) => {
    const x = v[q.metric]
    const ok = q.op === '>=' ? x >= q.value : x <= q.value
    return { id: q.id, label: `${q.text} ${q.value} ${q.unit}`, deps: [q.metric], status: ok ? 'PASS' : 'MISS', detail: `${fmt(x)} ${q.unit} vs ${q.op === '>=' ? '≥' : '≤'} ${q.value} ${q.unit}`, kind: 'requirement' }
  })
  const control = controlSuggestion(params, requirements, v)
  return { v, checks, reqs, control }
}

// Control subsystem: the highest pack current that keeps the estimated peak temperature inside the warning margin.
export function maxSafeCurrent(params) {
  let lo = 0.1
  let hi = 200
  const temp = (i) => {
    const v = { ...params, iPack: i }
    for (const c of CALCS) v[c.id] = c.f(v)
    return v
  }
  const ok = (i) => {
    const v = temp(i)
    return v.tPeak <= v.tMax - v.tMargin && v.cRate <= v.maxC + 1e-9 && i <= v.fuse && i <= v.bmsMax
  }
  if (!ok(lo)) return 0
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

function controlSuggestion(params, requirements, v) {
  const iSafe = maxSafeCurrent(params)
  const over = params.iPack > iSafe + 1e-6
  return {
    id: 'CT-01', sub: 'control', label: 'Charge-current recommendation', deps: ['tPeak', 'cRate', 'iPack'],
    status: over ? 'SUGGEST' : 'PASS', iSafe,
    detail: over ? `Derate to ≤ ${fmt(iSafe, 1)} A to stay inside all limits` : `Current is within all limits (max ≈ ${fmt(iSafe, 1)} A)`,
    kind: 'rule',
  }
}

// ---------------------------------------------------------------- dependency graph
export function graphNodes(requirements) {
  const nodes = []
  const used = new Set()
  CALCS.forEach((c) => c.deps.forEach((d) => used.add(d)))
  RULES.forEach((r) => r.deps.forEach((d) => used.add(d)))
  PARAMS.forEach((p) => { if (used.has(p.id)) nodes.push({ id: p.id, label: p.label, layer: 0, sub: p.sub, kind: 'param' }) })
  CALCS.forEach((c) => nodes.push({ id: c.id, label: c.label, layer: 1, sub: c.sub, kind: 'calc', deps: c.deps }))
  RULES.forEach((r) => nodes.push({ id: r.id, label: r.label, layer: 2, sub: r.sub, kind: 'rule', deps: r.deps }))
  nodes.push({ id: 'CT-01', label: 'Charge-current recommendation', layer: 2, sub: 'control', kind: 'rule', deps: ['tPeak', 'cRate', 'iPack'] })
  requirements.forEach((q) => nodes.push({ id: q.id, label: `${q.text.replace(' at least', ' ≥').replace(' at most', ' ≤').replace('Fast charge (CC phase) within', 'Charge ≤')} ${q.value} ${q.unit}`, layer: 3, sub: CALC_BY_ID[q.metric]?.sub || 'electrical', kind: 'requirement', deps: [q.metric] }))
  return nodes
}

export function graphEdges(nodes) {
  const ids = new Set(nodes.map((n) => n.id))
  const edges = []
  nodes.forEach((n) => (n.deps || []).forEach((d) => { if (ids.has(d)) edges.push({ from: d, to: n.id }) }))
  return edges
}

// Everything downstream of the changed inputs: this is what the platform re-runs.
export function downstream(changedIds, edges) {
  const out = new Set(changedIds)
  let grew = true
  while (grew) {
    grew = false
    for (const e of edges) {
      if (out.has(e.from) && !out.has(e.to)) { out.add(e.to); grew = true }
    }
  }
  return out
}

// Upstream trace of one node: all inputs it ultimately depends on.
export function upstream(id, edges) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const e of edges) {
      if (out.has(e.to) && !out.has(e.from)) { out.add(e.from); grew = true }
    }
  }
  return out
}

export function subsystemsTouched(ids, nodes) {
  const s = new Set()
  nodes.forEach((n) => { if (ids.has(n.id)) s.add(n.sub) })
  return s
}

// ---------------------------------------------------------------- grounded explanations ("copilot")
export function explain(before, after, changed, params, requirements) {
  const lines = []
  const b = before.v
  const a = after.v
  const ch = changed.map((id) => `${paramDef(id)?.label || id} ${fmtVal(id, b[id])} → ${fmtVal(id, a[id])}`)
  if (ch.length) lines.push(`You changed ${ch.join(', ')}.`)
  const delta = (id, d = 2) => {
    const c = CALC_BY_ID[id]
    if (Math.abs(a[id] - b[id]) < 1e-9) return null
    const ratio = b[id] !== 0 ? a[id] / b[id] : null
    return `${c.label.charAt(0).toLowerCase() + c.label.slice(1)} ${fmt(b[id], d)} → ${fmt(a[id], d)} ${c.unit}${ratio && Math.abs(ratio - 1) > 0.05 ? ` (×${fmt(ratio, 2)})` : ''}`
  }
  const elec = ['iCell', 'cRate', 'tCharge', 'eUsable'].map((x) => delta(x)).filter(Boolean)
  if (elec.length) lines.push(`Electrical: ${elec.join('; ')}.`)
  const th = ['qCell', 'dTss', 'tPeak'].map((x) => delta(x, 1)).filter(Boolean)
  if (th.length) {
    let s = `Thermal: ${th.join('; ')}.`
    if (a.iCell !== b.iCell && a.rInt === b.rInt) s += ' Heat follows I²R, so it moves with the square of the per-cell current.'
    lines.push(s)
  }
  const mech = ['mass', 'volume', 'cost'].map((x) => delta(x)).filter(Boolean)
  if (mech.length) lines.push(`Mechanical / cost: ${mech.join('; ')}.`)
  const all = (r) => [...r.checks, r.control, ...r.reqs]
  const flips = all(after).filter((c) => {
    const old = all(before).find((x) => x.id === c.id)
    return old && old.status !== c.status
  })
  flips.forEach((c) => {
    const old = all(before).find((x) => x.id === c.id)
    lines.push(`${c.id} ${c.label}: ${old.status} → ${c.status} (${c.detail}).`)
  })
  const bad = after.checks.filter((c) => c.status === 'FAIL')
  if (bad.length) {
    const alts = whatIfs(params, requirements)
    lines.push(`Options the model can check for you: ${alts.map((x) => `${x.label} → peak ${fmt(x.tPeak, 1)} °C, charge ${fmt(x.tCharge, 2)} h`).join('; ')}.`)
  }
  if (!lines.length) lines.push('No inputs changed yet. Move a control to see its impact propagate.')
  lines.push('All numbers are estimates from the stated assumptions; an engineer must validate before acceptance.')
  return lines
}

function fmtVal(id, x) {
  const p = paramDef(id)
  return typeof x === 'number' ? `${fmt(x)}${p?.unit ? ' ' + p.unit : ''}` : x
}

export function whatIfs(params, requirements) {
  const run = (label, patch) => {
    const r = evaluate({ ...params, ...patch }, requirements)
    return { label, tPeak: r.v.tPeak, tCharge: r.v.tCharge }
  }
  const out = []
  const iSafe = maxSafeCurrent(params)
  if (iSafe > 0) out.push(run(`derate to ${fmt(iSafe, 1)} A`, { iPack: Math.floor(iSafe * 10) / 10 }))
  if (params.cooling !== 'spreader') out.push(run('add heat spreader', { cooling: 'spreader' }))
  out.push(run(`go ${params.S}S${params.P + 1}P`, { P: params.P + 1, sensors: Math.max(params.sensors, Math.ceil((params.S * (params.P + 1)) / params.cellsPerSensor)) }))
  return out
}

// ---------------------------------------------------------------- compare + recommend
export const METRICS = [
  { id: 'tCharge', label: 'Charge time', unit: 'h', better: 'low', d: 2 },
  { id: 'eUsable', label: 'Usable energy', unit: 'Wh', better: 'high', d: 0 },
  { id: 'tPeak', label: 'Est. peak temp', unit: '°C', better: 'low', d: 1 },
  { id: 'mass', label: 'Mass', unit: 'kg', better: 'low', d: 2 },
  { id: 'volume', label: 'Volume', unit: 'L', better: 'low', d: 1 },
  { id: 'cost', label: 'Relative cost', unit: 'index', better: 'low', d: 2 },
]

export function compareOptions(base, requirements, weights, options = OPTIONS) {
  const rows = options.map((o) => {
    const params = { ...base, ...o.patch }
    return { ...o, params, res: evaluate(params, requirements) }
  })
  // normalised 0..1 score per metric (1 = best among options)
  const scored = rows.map((r) => {
    let total = 0
    let wsum = 0
    const parts = {}
    METRICS.forEach((m) => {
      const xs = rows.map((x) => x.res.v[m.id])
      const lo = Math.min(...xs)
      const hi = Math.max(...xs)
      const x = r.res.v[m.id]
      const s = hi - lo < 1e-9 ? 1 : m.better === 'low' ? (hi - x) / (hi - lo) : (x - lo) / (hi - lo)
      parts[m.id] = s
      const w = weights[m.id] ?? 1
      total += s * w
      wsum += w
    })
    const safetyFail = r.res.checks.filter((c) => SAFETY_RULES.includes(c.id) && c.status === 'FAIL')
    const warns = r.res.checks.filter((c) => c.status === 'WARN')
    const misses = r.res.reqs.filter((q) => q.status === 'MISS')
    // requirements count more than preference weights
    const score = wsum ? total / wsum : 0
    const rank = safetyFail.length ? -1 : score - misses.length * 0.5
    return { ...r, parts, score, rank, safetyFail, warns, misses }
  })
  const eligible = scored.filter((r) => r.rank >= 0 || r.safetyFail.length === 0)
  const best = [...eligible].sort((x, y) => y.rank - x.rank)[0]
  return { rows: scored, best }
}

export function risksFor(row) {
  const out = []
  row.safetyFail.forEach((c) => out.push({ level: 'FAIL', text: `${c.id}: ${c.label} (${c.detail})` }))
  row.warns.forEach((c) => out.push({ level: 'WARN', text: `${c.id}: ${c.label} (${c.detail}); validate with a thermal test` }))
  row.misses.forEach((q) => out.push({ level: 'MISS', text: `${q.id}: ${q.label} not met (${q.detail})` }))
  if (row.res.control.status === 'SUGGEST') out.push({ level: 'SUGGEST', text: row.res.control.detail })
  return out
}

// ---------------------------------------------------------------- cell-variation sweep
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Builds N virtual modules from cells drawn with ±tolerance (treated as 3σ) on R and capacity.
export function variationSweep(params, { n = 400, tolR = 15, tolCap = 3, seed = 7 } = {}) {
  const rng = mulberry32(seed)
  const { S, P } = params
  const builds = []
  for (let k = 0; k < n; k++) {
    let worstT = -Infinity
    let minGroupAh = Infinity
    for (let s = 0; s < S; s++) {
      const rs = []
      const caps = []
      for (let p = 0; p < P; p++) {
        rs.push(params.rInt * (1 + (tolR / 100 / 3) * gauss(rng)))
        caps.push(params.capAh * (1 + (tolCap / 100 / 3) * gauss(rng)))
      }
      // parallel cells share current inversely to resistance
      const g = rs.map((r) => 1 / r)
      const gsum = g.reduce((x, y) => x + y, 0)
      const groupAh = caps.reduce((x, y) => x + y, 0)
      minGroupAh = Math.min(minGroupAh, groupAh)
      rs.forEach((r, i) => {
        const iCell = params.iPack * (g[i] / gsum)
        const capCell = caps[i]
        const cRate = iCell / capCell
        const tCharge = (params.socEnd - params.socStart) / 100 / (params.iPack / groupAh)
        const rth = params.cooling === 'spreader' ? params.rthSpreader : params.rthPassive
        const m = params.cellMass + (params.cooling === 'spreader' ? params.spreaderMass : 0)
        const tau = m * params.cp * rth / 60
        const dT = iCell ** 2 * r / 1000 * rth
        const t = params.ambient + dT * (1 - Math.exp(-(tCharge * 60) / tau))
        if (t > worstT) worstT = t
        void cRate
      })
    }
    const eUsable = S * params.vNom * minGroupAh * params.dod / 100
    builds.push({ worstT, eUsable })
  }
  return builds
}

export function summarize(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { min: s[0], p5: q(0.05), p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean }
}

// ---------------------------------------------------------------- requirement parser (demo of the copilot's first job)
export function parseRequirements(text) {
  const out = []
  const t = text.toLowerCase()
  const num = '(\\d+(?:\\.\\d+)?)'
  const tryAdd = (re, mk) => {
    const m = t.match(re)
    if (m) out.push({ ...mk(parseFloat(m[1]), m[2]), source: m[0] })
  }
  tryAdd(new RegExp(`(?:at least|minimum|min\\.?|>=?|store|stores|hold|holds)\\s*${num}\\s*(wh|kwh)`), (x, u) => ({ id: 'REQ-01', text: 'Usable energy at least', metric: 'eUsable', op: '>=', value: u === 'kwh' ? x * 1000 : x, unit: 'Wh', conf: 'high' }))
  tryAdd(new RegExp(`(?:under|below|at most|max(?:imum)?|less than|lighter than|<=?)\\s*${num}\\s*(kg)`), (x) => ({ id: 'REQ-02', text: 'Module mass at most', metric: 'mass', op: '<=', value: x, unit: 'kg', conf: 'high' }))
  tryAdd(new RegExp(`(?:charge|charging)[^.]*?(?:within|in|under|below)\\s*${num}\\s*(h|hr|hrs|hour|hours|min|mins|minutes)`), (x, u) => ({ id: 'REQ-03', text: 'Fast charge (CC phase) within', metric: 'tCharge', op: '<=', value: u.startsWith('m') ? +(x / 60).toFixed(2) : x, unit: 'h', conf: 'medium' }))
  tryAdd(new RegExp(`(?:below|under|at most|max(?:imum)?|keep[^.]*?under)\\s*${num}\\s*(°c|c|deg)`), (x) => ({ id: 'LIMIT', text: 'Proposed max cell temperature', metric: 'tPeak', op: '<=', value: x, unit: '°C', conf: 'needs engineer', limit: true }))
  return out
}

export { ASSUMPTIONS }
