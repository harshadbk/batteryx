// Thin client for the BatteryX FastAPI backend. Every simulation value shown in the UI comes through here.
import { API_BASE as BASE } from '../config'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request(method, path, body, { signal } = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError(0, 'network_error', BASE ? `Backend not reachable at ${BASE}. Check the deployed server and retry.` : 'Backend not reachable. Start the FastAPI server (port 8000) and retry.')
  }
  if (res.status === 204) return null
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const er = data?.error
    throw new ApiError(res.status, er?.code || 'http_error', er?.message || `HTTP ${res.status}`, er?.details)
  }
  return data
}

const post = (p, b, o) => request('POST', p, b, o)
const get = (p, o) => request('GET', p, undefined, o)

export const api = {
  health: () => get('/health'),
  models: () => get('/api/v1/models'),
  metrics: () => get('/api/v1/metrics'),
  examples: () => get('/api/v1/examples/designs'),
  cells: {
    list: () => get('/api/v1/cells'),
    get: (id) => get(`/api/v1/cells/${encodeURIComponent(id)}`),
    create: (cell) => post('/api/v1/cells', cell),
    remove: (id) => request('DELETE', `/api/v1/cells/${encodeURIComponent(id)}`),
  },
  projects: {
    list: () => get('/api/v1/projects'),
    get: (id) => get(`/api/v1/projects/${id}`),
    create: (p) => post('/api/v1/projects', p),
    update: (id, p) => request('PUT', `/api/v1/projects/${id}`, p),
    remove: (id) => request('DELETE', `/api/v1/projects/${id}`),
  },
  /** module: configuration | energy | estimates | thermal | ageing | bms | mechanical | cost | simulate/charge | simulate/discharge */
  module: (module, design, o) => post(`/api/v1/${module}`, design, o),
  variation: (design, variation) => post('/api/v1/variation', { design, variation }),
  evaluate: (design) => post('/api/v1/designs/evaluate', design),
  compare: (req) => post('/api/v1/designs/compare', req),
  copilot: {
    status: () => get('/api/v1/copilot/status'),
    chat: (projectId, body) => post(`/api/v1/copilot/projects/${projectId}/chat`, body),
    conversations: (projectId) => get(`/api/v1/copilot/projects/${projectId}/conversations`),
    conversation: (id) => get(`/api/v1/copilot/conversations/${id}`),
    removeConversation: (id) => request('DELETE', `/api/v1/copilot/conversations/${id}`),
  },
  ai: {
    status: () => get('/api/v1/ai/status'),
    explain: (req) => post('/api/v1/ai/explain', req),
    extract: (text) => post('/api/v1/ai/extract-requirements', { text }),
  },
}

export const API_DOCS_URL = (BASE || 'http://localhost:8000') + '/docs'
