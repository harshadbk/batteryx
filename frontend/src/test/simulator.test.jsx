// The live simulator (merged stage-1 BatteryWeave engine) must agree with the backend engine,
// and its page must render and react to a scenario. Reference values are the same ones pinned
// in backend/tests/test_prototype_parity_and_api.py, so the two engines cannot silently drift apart.
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import Simulator from '../pages/Simulator'
import { DEFAULT_REQUIREMENTS, OPTIONS, defaultParams } from '../simulator/model/defaults.js'
import { downstream, evaluate, graphEdges, graphNodes } from '../simulator/model/engine.js'

const REF = {
  A: { eUsable: 204.8, tCharge: 1.4, tPeak: 39.05773633016358, mass: 2.3, cost: 5.0, iSafe: 15.4048, el: 'PASS', miss: ['REQ-03'] },
  B: { eUsable: 204.8, tCharge: 0.7, tPeak: 42.63231556422748, mass: 2.62, cost: 5.6, iSafe: 20.0, el: 'WARN', miss: [] },
  C: { eUsable: 409.6, tCharge: 1.4, tPeak: 39.05773633016358, mass: 4.3, cost: 9.0, iSafe: 25.0, el: 'PASS', miss: ['REQ-02', 'REQ-03'] },
}
const run = (patch) => evaluate({ ...defaultParams(), ...patch }, DEFAULT_REQUIREMENTS)

describe('simulator engine parity with the backend', () => {
  it.each(OPTIONS.map((o) => [o.id, o]))('option %s matches backend reference values', (id, o) => {
    const r = run(o.patch)
    const ref = REF[id]
    for (const k of ['eUsable', 'tCharge', 'tPeak', 'mass', 'cost']) expect(r.v[k]).toBeCloseTo(ref[k], 3)
    expect(r.control.iSafe).toBeCloseTo(ref.iSafe, 2)
    expect(r.checks.find((c) => c.id === 'EL-01').status).toBe(ref.el)
    expect(r.checks.find((c) => c.id === 'TH-01').status).toBe('PASS')
    expect(r.reqs.filter((c) => c.status === 'MISS').map((c) => c.id)).toEqual(ref.miss)
  })

  it('flags TH-01 when design A is charged at 20 A (1C)', () => {
    const r = run({ ...OPTIONS[0].patch, iPack: 20 })
    expect(r.v.tPeak).toBeGreaterThan(r.v.tMax)
    expect(r.checks.find((c) => c.id === 'TH-01').status).toBe('FAIL')
  })

  it('a current change re-runs thermal, protection and requirement nodes', () => {
    const nodes = graphNodes(DEFAULT_REQUIREMENTS)
    const hit = downstream(['iPack'], graphEdges(nodes))
    for (const id of ['qCell', 'tPeak', 'TH-01', 'REQ-03']) expect(hit.has(id)).toBe(true)
  })
})

describe('simulator page', () => {
  it('renders, runs a scenario and logs what it touched', () => {
    render(<MemoryRouter><Simulator /></MemoryRouter>)
    expect(screen.getByText(/Change one parameter\. See every consequence\./)).toBeInTheDocument()
    expect(screen.getByText('No changes yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Raise current to 1C' }))
    expect(screen.queryByText('No changes yet.')).not.toBeInTheDocument()
    expect(screen.getAllByText(/TH-01 → FAIL/).length).toBeGreaterThan(0)
  })

  it('guided walkthrough advances through its steps', () => {
    render(<MemoryRouter><Simulator /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Start the guided simulation/ }))
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()
  })
})
