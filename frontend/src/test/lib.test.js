import { describe, expect, it } from 'vitest'

import { blankDesign, clean, designReady, getPath, payloadFor, setPath, uniqueName } from '../lib/design'
import { fmt } from '../lib/format'
import { buildMarkdown, collectAssumptions } from '../lib/report'
import { fx } from './mockApi'

describe('design helpers', () => {
  it('sets nested paths immutably', () => {
    const d = blankDesign('X')
    const e = setPath(d, 'operating.charge_current_a', 10)
    expect(getPath(e, 'operating.charge_current_a')).toBe(10)
    expect(d.operating.charge_current_a).toBeUndefined()
  })
  it('cleans nulls and empty objects so backend defaults and flags apply', () => {
    expect(clean({ a: null, b: '', c: { d: null }, e: 0, f: [1], _ui: 1 })).toEqual({ e: 0, f: [1] })
  })
  it('builds the API payload with project requirements', () => {
    const r1 = { id: 'R1', metric: 'usable_energy_wh', operator: '>=', value: 100 }
    const draft = { id: 'R2', metric: 'usable_energy_wh', operator: '>=', value: null }
    const p = payloadFor({ ...blankDesign('X'), cell_id: 'C1' }, { requirements: [r1, draft] })
    expect(p.requirements).toEqual([r1])
    expect(p.cell_id).toBe('C1')
    expect(p.operating).toBeUndefined()
  })
  it('reports readiness', () => {
    expect(designReady(blankDesign()).ok).toBe(false)
    expect(designReady({ ...blankDesign(), cell_id: 'C' }).ok).toBe(true)
  })
  it('creates unique names', () => {
    expect(uniqueName('A', ['A', 'A 2'])).toBe('A 3')
  })
})

describe('format', () => {
  it('formats significant digits and missing values', () => {
    expect(fmt(39.0577, 4)).toBe('39.06')
    expect(fmt(null)).toBe('—')
    expect(fmt(204.8, 4)).toBe('204.8')
  })
})

describe('report', () => {
  const evaluations = Object.values(fx.evaluate)
  const md = buildMarkdown({ project: fx.project, evaluations, comparison: fx.compare, models: fx.models, generatedAt: 'T' })
  it('contains the required case-study sections', () => {
    for (const h of ['Application and scope', 'Requirements', 'Cells and data sources', 'Design inputs and provenance', 'Results (model estimates)', 'Safety and monitoring checks',
      'Design comparison', 'Assumptions', 'Limitations', 'Safety precautions', 'Appendix: models and equations']) expect(md).toContain(h)
  })
  it('labels estimates and illustrative data', () => {
    expect(md).toContain('ESTIMATE')
    expect(md).toContain('illustrative example data')
  })
  it('uses backend values verbatim', () => {
    expect(md).toContain(fmt(fx.evaluate['A - Baseline'].kpis.peak_cell_temp_charge_c, 4))
    expect(md).toContain(`Recommendation: ${fx.compare.recommendation.design_name}`)
  })
  it('traces inputs with source tags and results to model ids', () => {
    expect(md).toMatch(/\| Thermal resistance cell → ambient \| K\/W \| Assumption \| 6 \| 3 \| 6 \|/)
    expect(md).toMatch(/\| Pack charge current \(CC\) \| A \| Design \| 10 \| 20 \| 20 \|/)
    expect(md).toContain('thermal.lumped_single_node v1.0.0')
    expect(md).toContain('electrical.ecm_1rc v1.0.1')
  })
  it('collects engine assumptions', () => {
    expect(collectAssumptions(evaluations).length).toBeGreaterThan(0)
  })
})
