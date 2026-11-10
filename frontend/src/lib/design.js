// Design draft helpers. Drafts may be incomplete while being configured; the backend validates on every run.

export function blankDesign(name = 'New design') {
  return {
    name,
    role: 'alternative',
    description: '',
    cell_id: null,
    series: 4,
    parallel: 1,
    operating: {},
    thermal: { cooling: { type: 'natural_convection' } },
    limits: {},
    mechanical: {},
    cost: {},
    ageing: { method: 'none' },
    simulation: {},
  }
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function setPath(obj, path, value) {
  const [k, ...rest] = path.split('.')
  const base = obj && typeof obj === 'object' ? obj : {}
  if (!rest.length) return { ...base, [k]: value }
  return { ...base, [k]: setPath(base[k], rest.join('.'), value) }
}

/** Remove null / empty-string values recursively so the backend applies its documented defaults and flags. */
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue
      if (v === null || v === undefined || v === '') continue
      const c = clean(v)
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue
      out[k] = c
    }
    return out
  }
  return value
}

/** API payload for a design: cleaned draft + the project's shared requirements. */
/** Requirements still being edited (no target value or id yet) are saved with the project but not sent to the engine. */
export function completeRequirements(reqs) {
  return (reqs ?? []).filter((r) => r && String(r.id ?? '').trim() && r.metric && Number.isFinite(r.value))
}

export function payloadFor(design, project) {
  const d = clean({ ...design, requirements: completeRequirements(project?.requirements) })
  if (d.cell) delete d.cell_id
  return d
}

export function designKey(design, project) {
  return JSON.stringify(payloadFor(design, project))
}

export function designReady(design) {
  if (!design) return { ok: false, reason: 'No design selected.' }
  if (!design.cell_id && !design.cell) return { ok: false, reason: 'Select a cell for this design first.' }
  if (!Number.isInteger(design.series) || design.series < 1) return { ok: false, reason: 'Series count (S) must be a whole number ≥ 1.' }
  if (!Number.isInteger(design.parallel) || design.parallel < 1) return { ok: false, reason: 'Parallel count (P) must be a whole number ≥ 1.' }
  return { ok: true }
}

export function uniqueName(base, existing) {
  const names = new Set(existing)
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

export const topology = (d) => (d ? `${d.series}S${d.parallel}P` : '—')

/** Turn an AI-proposed, engine-evaluated candidate (base design + whitelisted changes) into a project design draft. */
export function applyCandidate(project, candidate) {
  const base = project.designs.find((d) => d.name === candidate.base_design)
  if (!base) throw new Error(`Base design '${candidate.base_design}' is not in the project`)
  let d = structuredClone(base)
  for (const { path, value } of candidate.changes) {
    if (path === 'copy_cooling_from' || path === 'copy_mechanical_from') {
      const src = project.designs.find((x) => x.name === value)
      if (!src) throw new Error(`Design '${value}' not found`)
      const key = path === 'copy_cooling_from' ? 'thermal' : 'mechanical'
      d = { ...d, [key]: structuredClone(src[key] || {}) }
    } else {
      d = setPath(d, path, value)
      if (path === 'cell_id') delete d.cell
    }
  }
  return {
    ...d, name: candidate.name, role: 'alternative',
    description: `Proposed by the AI copilot from "${candidate.base_design}" (engine-evaluated ${candidate.evaluated_ref}). ${candidate.verdict}`.trim(),
  }
}
