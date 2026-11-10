// Renders every page against REAL backend responses (fixtures.json) and exercises the main buttons.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { useProject } from '../store/project'
import { fx, installMockApi } from './mockApi'

vi.mock('../components/three/PackView3D', () => ({ default: (p) => <div data-testid="pack3d">3D {p.rows}×{p.cols}</div> }))

let calls
function openFixtureProject() {
  useProject.setState({
    project: structuredClone(fx.project), activeName: 'A - Baseline', results: {}, comparison: null,
    cells: fx.cells, cellsLoaded: true, saveState: 'saved', loading: false, loadError: null,
  })
}
const renderAt = (path) => render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></MemoryRouter>)
const click = (name) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
  calls = installMockApi()
  try { localStorage.clear() } catch { /* ignore */ }
  useProject.setState({ project: null, activeName: null, results: {}, comparison: null, cells: [], cellsLoaded: false })
  window.confirm = () => true
})

describe('landing', () => {
  it('shows live status from the API', async () => {
    renderAt('/')
    expect(await screen.findByText(/online · v/)).toBeInTheDocument()
    expect(await screen.findByText(`${fx.models.length} registered`)).toBeInTheDocument()
  })
})

describe('before a project is restored', () => {
  it.each(['/app/thermal', '/app/electrical', '/app/safety', '/app/packaging', '/app/topology', '/app/wizard', '/app/compare', '/app/report', '/app/assistant'])(
    '%s renders an empty state, not a crash', async (route) => {
      renderAt(route)
      expect((await screen.findAllByText(/No project open|Open or create a project/)).length).toBeGreaterThan(0)
      expect(screen.queryByText('This page failed to render.')).toBeNull()
    })
})

describe('workspace pages', () => {
  beforeEach(openFixtureProject)

  it('projects: lists designs and evaluates all via the backend', async () => {
    renderAt('/app/projects')
    expect(screen.getAllByText('B - Fast charge + spreader').length).toBeGreaterThan(0)
    click(/Evaluate all designs/)
    expect(await screen.findByText('409.6')).toBeInTheDocument() // option C usable energy from backend
    expect(calls.filter((c) => c.path === '/api/v1/designs/evaluate')).toHaveLength(3)
  })

  it('illustrative data banner is shown for the example cell', () => {
    renderAt('/app/projects')
    expect(screen.getByText(/Illustrative demo data\./)).toBeInTheDocument()
  })

  it('cells: shows database cell and missing fields', () => {
    renderAt('/app/cells')
    expect(screen.getAllByText('EXAMPLE-LFP-20AH').length).toBeGreaterThan(0)
    expect(screen.getAllByText('not provided').length).toBeGreaterThan(3)
  })

  it('topology: live sizing from configuration + energy endpoints', async () => {
    renderAt('/app/topology')
    expect(await screen.findByText('12.8')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/v1/configuration')).toBe(true)
  })

  it('electrical: runs charge & discharge simulations', async () => {
    renderAt('/app/electrical')
    click(/Run charge & discharge simulation/)
    expect(await screen.findByText('Reached target SOC')).toBeInTheDocument()
    expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/api/v1/simulate/charge', '/api/v1/simulate/discharge', '/api/v1/estimates']))
  })

  it('thermal: shows backend peak temperature and simplified-model warning', async () => {
    renderAt('/app/thermal')
    expect(screen.getByText(/Simplified thermal model\./)).toBeInTheDocument()
    click(/Run thermal analysis/)
    expect((await screen.findAllByText('39.06')).length).toBeGreaterThan(0)
  })

  it('safety: renders backend checks and max safe current', async () => {
    renderAt('/app/safety')
    click(/Run safety checks/)
    expect(await screen.findByText('15.4')).toBeInTheDocument()
    expect(screen.getAllByText('TH-01').length).toBeGreaterThan(0)
  })

  it('packaging: mass from backend and 3D view', async () => {
    renderAt('/app/packaging')
    click(/Run packaging analysis/)
    expect(await screen.findByTestId('pack3d')).toHaveTextContent('3D 4×1')
    expect(screen.getByText('2.3')).toBeInTheDocument()
  })

  it('compare: recommendation comes from the comparison endpoint', async () => {
    renderAt('/app/compare')
    click(/Run comparison/)
    const panel = (await screen.findByText('Recommended by the comparison engine')).closest('section')
    expect(within(panel).getByText(fx.compare.recommendation.design_name)).toBeInTheDocument()
    const req = calls.find((c) => c.path === '/api/v1/designs/compare').body
    expect(req.baseline.name).toBe('A - Baseline')
    expect(req.alternatives.map((a) => a.name)).toEqual(['B - Fast charge + spreader', 'C - Parallel 4S2P'])
  })

  it('copilot: explains how to configure Claude when no key is set', async () => {
    renderAt('/app/assistant')
    expect(await screen.findByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument()
  })

  it('copilot: runs a capability, shows verified claims and adds an engine-evaluated candidate', async () => {
    calls = installMockApi({ claudeConfigured: true })
    renderAt('/app/assistant')
    fireEvent.click(await screen.findByText('AI Design Copilot'))
    fireEvent.click(screen.getByText(/We need a 12 V module/))
    expect(await screen.findByText(/numbers checked/)).toBeInTheDocument()
    const body = calls.find((c) => c.path.endsWith('/chat')).body
    expect(body.mode).toBe('design_copilot')
    expect(screen.getByText('A + 4S2P')).toBeInTheDocument()
    expect(screen.getAllByText('Engine estimate').length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: /Add to project/ }))
    const added = useProject.getState().project.designs.find((d) => d.name === 'A + 4S2P')
    expect(added.parallel).toBe(2)
    expect(added.description).toMatch(/engine-evaluated T2/)
  })

  it('copilot: quick explain (Groq) tab is preserved', async () => {
    calls = installMockApi({ aiConfigured: true })
    renderAt('/app/assistant')
    fireEvent.click(screen.getByRole('tab', { name: 'Quick explain' }))
    fireEvent.change(await screen.findByLabelText('Quick question'), { target: { value: 'Why?' } })
    click(/^Ask$/)
    expect(await screen.findByText(/numbers checked/)).toBeInTheDocument()
  })

  it('report: includes the verified Claude summary when selected', async () => {
    useProject.getState().setAiReport(fx.copilot_chat.turn)
    renderAt('/app/report')
    click(/Generate report/)
    expect(await screen.findByRole('heading', { name: 'AI-generated engineering summary' })).toBeInTheDocument()
  })

  it('report: generates from fresh backend runs', async () => {
    renderAt('/app/report')
    click(/Generate report/)
    expect(await screen.findByRole('heading', { name: /Engineering report: Fixture project/ })).toBeInTheDocument()
    expect(screen.getByText(/Recommendation: B - Fast charge \+ spreader/)).toBeInTheDocument()
  })

  it('wizard: edits a field, walks the steps and evaluates', async () => {
    renderAt('/app/wizard')
    click(/^4\s*Operating$/)
    const input = screen.getByLabelText(/Ambient temperature/)
    fireEvent.change(input, { target: { value: '30' } })
    expect(useProject.getState().project.designs[0].operating.ambient_c).toBe(30)
    click(/^8\s*Review$/)
    click(/Evaluate design/)
    expect(await screen.findByText('204.8')).toBeInTheDocument()
  })

  it('autosaves edits to the backend', async () => {
    vi.useFakeTimers()
    renderAt('/app/topology')
    act(() => useProject.getState().updateActive('series', 5))
    await act(async () => { vi.advanceTimersByTime(900) })
    vi.useRealTimers()
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path.startsWith('/api/v1/projects/'))).toBe(true))
    expect(calls.find((c) => c.method === 'PUT').body.designs[0].series).toBe(5)
  })
})
