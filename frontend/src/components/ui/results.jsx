import { ChevronDown, FlaskConical, Play, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { timeAgo } from '../../lib/format'
import { SUBSYSTEM_COLORS } from '../../lib/fields'
import { Badge, cx, ErrorBox, Notice, Spinner, StatusBadge } from './core'

const SEV = {
  unsupported: { tone: 'red', label: 'Unsupported' },
  missing_input: { tone: 'amber', label: 'Missing input' },
  warning: { tone: 'amber', label: 'Warning' },
  assumption: { tone: 'violet', label: 'Assumption' },
  info: { tone: 'slate', label: 'Info' },
}

/** Flags returned by the backend: missing inputs, unsupported calculations, assumptions. */
export function FlagList({ flags, title = 'Model flags', defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const list = dedupe(flags || [])
  if (!list.length) return null
  const order = ['unsupported', 'missing_input', 'warning', 'assumption', 'info']
  list.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const counts = order.map((s) => [s, list.filter((f) => f.severity === s).length]).filter(([, n]) => n)
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <button className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-xs font-semibold text-slate-800">{title}</span>
        {counts.map(([s, n]) => <Badge key={s} tone={SEV[s].tone}>{n} {SEV[s].label.toLowerCase()}</Badge>)}
        <ChevronDown className={cx('ml-auto h-4 w-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {list.map((f, i) => (
            <li key={i} className="flex gap-2 px-3 py-2 text-xs">
              <Badge tone={SEV[f.severity]?.tone}>{SEV[f.severity]?.label || f.severity}</Badge>
              <div className="min-w-0">
                <span className="text-slate-700">{f.message}</span>
                <span className="ml-1.5 font-mono text-[10px] text-slate-400">{f.code}{f.field ? ` · ${f.field}` : ''}{f.module ? ` · ${f.module}` : ''}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function dedupe(flags) {
  const seen = new Set()
  return flags.filter((f) => {
    const k = `${f.code}|${f.field}|${f.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const FIDELITY = {
  closed_form: 'Closed-form',
  simplified_time_domain: 'Simplified time-domain',
  simplified_assumption: 'Simplified assumption',
  rule_check: 'Rule check',
  statistical: 'Statistical',
  aggregation: 'Aggregation',
}

/** Model metadata from the backend: label, equations, assumptions. */
export function ModelCard({ model }) {
  const [open, setOpen] = useState(false)
  if (!model) return null
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50">
      <button className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <FlaskConical className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-medium text-slate-800">{model.label}</span>
        <Badge tone={model.fidelity.startsWith('simplified') ? 'amber' : 'slate'}>{FIDELITY[model.fidelity] || model.fidelity}</Badge>
        <span className="font-mono text-[10px] text-slate-400">{model.id} v{model.version}</span>
        <ChevronDown className={cx('ml-auto h-4 w-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid gap-3 border-t border-slate-200 px-3 py-2 text-xs md:grid-cols-2">
          <div>
            <div className="label mb-1">Equations</div>
            <ul className="space-y-0.5 font-mono text-[11px] text-slate-700">{model.equations.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
          <div>
            <div className="label mb-1">Assumptions</div>
            <ul className="list-disc space-y-0.5 pl-4 text-slate-700">{model.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  )
}

/** Run button + status line used on every analysis page. */
export function RunBar({ label = 'Run', onRun, loading, at, stale, ready, error, hint }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={onRun} disabled={loading || !ready?.ok}>
          {loading ? <Spinner /> : at ? <RefreshCw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {loading ? 'Running…' : at ? `Re-run ${label.replace(/^Run\s+/i, '').toLowerCase()}` : label}
        </button>
        {at && !loading && <span className="text-xs text-slate-500">Last run {timeAgo(at)} · backend computed</span>}
        {stale && !loading && <Badge tone="amber">Inputs changed since last run</Badge>}
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {ready && !ready.ok && <Notice tone="slate">{ready.reason}</Notice>}
      <ErrorBox error={error} />
    </div>
  )
}

export function EstimateNote({ children }) {
  return (
    <p className="text-[11px] leading-relaxed text-slate-500">
      <span className="font-semibold text-slate-600">Estimate, not a measurement.</span>{' '}
      {children || 'Values are computed by the BatteryX backend from the stated inputs and assumptions; validate with test data before relying on them.'}
    </p>
  )
}

export function ChecksTable({ checks, compact }) {
  if (!checks?.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left label">
            <th className="py-2 pr-3">Check</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Result</th>
            {!compact && <th className="py-2 pr-3">Limit source</th>}{!compact && <th className="py-2">Basis</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {checks.map((c) => (
            <tr key={c.id} className="align-top">
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SUBSYSTEM_COLORS[c.subsystem] || '#94a3b8' }} title={c.subsystem} />
                  <span className="font-mono text-xs text-slate-500">{c.id}</span>
                </div>
                <div className="text-slate-800">{c.description}</div>
              </td>
              <td className="py-2 pr-3"><StatusBadge status={c.status} /></td>
              <td className="py-2 pr-3 text-xs text-slate-700 num">{c.detail}</td>
              {!compact && <td className="py-2 pr-3 text-xs text-slate-500">{c.limit_source || '—'}</td>}
              {!compact && <td className="py-2 text-xs text-slate-500">{c.basis || '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
