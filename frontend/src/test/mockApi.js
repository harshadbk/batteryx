// Serves REAL backend responses (captured in fixtures.json) to the UI under test.
import { vi } from 'vitest'

import fx from './fixtures.json'

const json = (data, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))

export function installMockApi({ aiConfigured = false, claudeConfigured = false } = {}) {
  const calls = []
  global.fetch = vi.fn((url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : undefined
    calls.push({ method, path, body })
    if (path === '/health') return json(fx.health)
    if (path === '/api/v1/models') return json(fx.models)
    if (path === '/api/v1/metrics') return json(fx.metrics)
    if (path === '/api/v1/cells') return json(fx.cells)
    if (path === '/api/v1/examples/designs') return json(fx.examples)
    if (path === '/api/v1/ai/status') return json({ ...fx.ai_status, configured: aiConfigured })
    if (path === '/api/v1/copilot/status') return json({ ...fx.copilot_status, configured: claudeConfigured })
    if (path.match(/^\/api\/v1\/copilot\/projects\/[^/]+\/chat$/)) return json(fx.copilot_chat)
    if (path.match(/^\/api\/v1\/copilot\/projects\/[^/]+\/conversations$/)) return json(fx.copilot_conversations)
    if (path.startsWith('/api/v1/copilot/conversations/')) return method === 'DELETE' ? json(null, 204) : json(fx.copilot_conversation)
    if (path === '/api/v1/projects' && method === 'GET') return json(fx.projects)
    if (path.startsWith('/api/v1/projects/') && method === 'GET') return json(fx.project)
    if (path.startsWith('/api/v1/projects/') && method === 'PUT') return json({ ...fx.project, ...body, updated_at: new Date().toISOString() })
    if (path === '/api/v1/designs/evaluate') return json(fx.evaluate[body.name] ?? fx.evaluate['A - Baseline'])
    if (path === '/api/v1/designs/compare') return json(fx.compare)
    if (path === '/api/v1/variation') return json(fx.variation)
    if (path === '/api/v1/ai/explain') return json({ answer: 'TH-01 passes at 39.058 °C.', grounding: { numbers_checked: 1, ungrounded_numbers: [], passed: true }, provider: 'stub', model: 'stub', label: 'AI-generated explanation' })
    const m = path.replace('/api/v1/', '')
    if (fx.modules[m]) return json(fx.modules[m])
    return json({ error: { code: 'not_found', message: `unmocked ${method} ${path}` } }, 404)
  })
  return calls
}

export { fx }
