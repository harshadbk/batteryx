// Live contract test: the frontend's request builders against a RUNNING backend.
// Opt-in:  VITE_API_URL=http://localhost:8000 BATTERYX_CONTRACT=1 npx vitest run src/test/contract.test.js
import { describe, expect, it } from 'vitest'

import { api } from '../lib/api'
import { payloadFor } from '../lib/design'
import { buildMarkdown } from '../lib/report'
import { buildCompareRequest } from '../pages/Compare'

const live = process.env.BATTERYX_CONTRACT === '1'

describe.skipIf(!live)('live backend contract', () => {
  it('runs the full UI workflow against the real API', async () => {
    const health = await api.health()
    expect(health.status).toBe('ok')
    const ex = await api.examples()
    const reqs = ex.designs[0].requirements
    const designs = ex.designs.map(({ requirements, ...d }) => d)
    const project = await api.projects.create({ name: `contract-${Date.now()}`, application: 'test', designs, requirements: reqs })
    try {
      const p = await api.projects.get(project.id)
      expect(p.designs).toHaveLength(3)
      const A = payloadFor(p.designs[0], p)
      for (const m of ['configuration', 'energy', 'estimates', 'thermal', 'ageing', 'bms', 'mechanical', 'cost', 'simulate/charge', 'simulate/discharge']) {
        const r = await api.module(m, A)
        expect(r.result_type).toBe('ESTIMATE')
      }
      const ev = await api.evaluate(A)
      expect(ev.kpis.usable_energy_wh).toBeCloseTo(204.8, 3)
      const cmp = await api.compare(buildCompareRequest(p, p.designs[0].name, p.designs.slice(1).map((d) => d.name), { usable_energy_wh: 1, module_mass_kg: 1 }))
      expect(cmp.ranking).toHaveLength(3)
      const md = buildMarkdown({ project: p, evaluations: [ev], comparison: cmp, models: await api.models(), generatedAt: 'now' })
      expect(md).toContain('ESTIMATE')
      const varr = await api.variation(A, { samples: 50, capacity_tolerance_pct: 3, resistance_tolerance_pct: 10 })
      expect(varr.values.usable_energy_wh.p50).toBeGreaterThan(0)
      const ext = await api.ai.extract('store at least 200 Wh and weigh under 3 kg')
      expect(ext.requirements.length).toBeGreaterThan(0)
      const bad = await api.evaluate({ ...A, series: 0 }).catch((e) => e)
      expect(bad.code).toBe('validation_error')
      await api.projects.update(p.id, { ...p, designs: p.designs.slice(0, 2) })
      expect((await api.projects.get(p.id)).designs).toHaveLength(2)
    } finally {
      await api.projects.remove(project.id)
    }
  }, 120000)
})
