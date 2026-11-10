// ─────────────────────────────────────────────────────────────────────────────
// BACKEND URL — paste your deployed backend link here (no trailing slash), e.g.
//   export const BACKEND_URL = 'https://batteryx-api.onrender.com'
//
// Leave it as '' for local development: Vite proxies /api to http://localhost:8000.
// A VITE_API_URL environment variable (e.g. set on Vercel/Netlify) overrides this value.
// ─────────────────────────────────────────────────────────────────────────────
export const BACKEND_URL = ''

export const API_BASE = (import.meta.env.VITE_API_URL || BACKEND_URL || '').trim().replace(/\/+$/, '')
