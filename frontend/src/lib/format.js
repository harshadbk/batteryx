export function fmt(x, digits = 3) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  if (typeof x !== 'number') return String(x)
  if (x !== 0 && (Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3)) return x.toExponential(2)
  const s = x.toPrecision(Math.max(digits, 1))
  const n = Number(s)
  return Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(n)
}

export function fmtFixed(x, d = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return Number(x).toFixed(d)
}

export const pct = (x, d = 1) => (x == null ? '—' : `${Number(x).toFixed(d)} %`)

export function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(ts).toLocaleTimeString()
}

export const STATUS_TONE = {
  PASS: 'green', MET: 'green', WARN: 'amber', SUGGEST: 'amber', FAIL: 'red', NOT_MET: 'red',
  NOT_EVALUATED: 'slate', MISS: 'red',
}

export const END_REASON = {
  target_soc: 'Reached target SOC',
  cv_current_cutoff: 'CV current fell to cut-off',
  min_voltage: 'Reached minimum cell voltage',
  soc_window_limit: 'Reached lower SOC limit',
  max_duration: 'Stopped at max duration',
  power_not_deliverable: 'Requested power not deliverable',
}
