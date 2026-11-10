import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useFetch } from '../../hooks/useApi'
import { api } from '../../lib/api'
import { useProject } from '../../store/project'
import { Badge, ErrorBox, InfoTip, Spinner } from '../ui/core'
import { NumberInput } from '../ui/fields'

/** Electrical schematic of S series groups × P parallel cells (drawn from the design, not from results). */
export function TopologySchematic({ series, parallel }) {
  const S = Math.min(series, 32), P = Math.min(parallel, 16)
  const cw = 26, ch = 14, gx = 8, gy = 18, pad = 28
  const W = pad * 2 + P * cw + (P - 1) * gx + 40
  const H = pad * 2 + S * ch + (S - 1) * gy
  const rowY = (s) => pad + s * (ch + gy)
  const x0 = pad + 40
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-[420px] w-full" role="img" aria-label={`${series}S${parallel}P schematic`}>
      {Array.from({ length: S }, (_, s) => (
        <g key={s}>
          <text x={pad - 4} y={rowY(s) + ch / 2 + 4} fontSize="10" fill="#64748b" fontFamily="IBM Plex Mono">S{s + 1}</text>
          <line x1={x0 - 6} y1={rowY(s) - 3} x2={x0 + P * cw + (P - 1) * gx + 6} y2={rowY(s) - 3} stroke="#94a3b8" strokeWidth="1.5" />
          <line x1={x0 - 6} y1={rowY(s) + ch + 3} x2={x0 + P * cw + (P - 1) * gx + 6} y2={rowY(s) + ch + 3} stroke="#94a3b8" strokeWidth="1.5" />
          {Array.from({ length: P }, (_, p) => (
            <g key={p}>
              <rect x={x0 + p * (cw + gx)} y={rowY(s)} width={cw} height={ch} rx="2" fill={s % 2 ? '#5b6b8c' : '#0e8c99'} />
              <rect x={x0 + p * (cw + gx) + cw / 2 - 3} y={rowY(s) - 3} width="6" height="3" fill="#c0392b" />
            </g>
          ))}
          {s < S - 1 && (
            <line x1={s % 2 ? x0 - 6 : x0 + P * cw + (P - 1) * gx + 6} y1={rowY(s) + ch + 3}
              x2={s % 2 ? x0 - 6 : x0 + P * cw + (P - 1) * gx + 6} y2={rowY(s + 1) - 3} stroke="#b87333" strokeWidth="2.5" />
          )}
        </g>
      ))}
      <text x={x0 - 6} y={rowY(0) - 8} fontSize="11" fill="#c0392b" fontWeight="600">+ pack</text>
      <text x={(S - 1) % 2 ? x0 + P * cw + (P - 1) * gx - 30 : x0 - 6} y={rowY(S - 1) + ch + 16} fontSize="11" fill="#1f2937" fontWeight="600">− pack</text>
      {(series > 32 || parallel > 16) && <text x={pad} y={H - 4} fontSize="10" fill="#b45309">Truncated view</text>}
    </svg>
  )
}

/** Shared project requirements, with AI / rule-based extraction from plain text. */
export function RequirementsEditor() {
  const project = useProject((s) => s.project)
  const setRequirements = useProject((s) => s.setRequirements)
  const { data: metrics } = useFetch(() => api.metrics(), [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [proposal, setProposal] = useState(null)
  const reqs = project?.requirements || []
  const weightable = metrics ? Object.entries(metrics).filter(([, m]) => m.better !== 'info') : []
  const update = (i, patch) => setRequirements(reqs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const nextId = () => `REQ-${String(reqs.length + 1).padStart(2, '0')}`

  const extract = async () => {
    setBusy(true); setError(null); setProposal(null)
    try { setProposal(await api.ai.extract(text)) } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const accept = (items) => {
    const start = reqs.length
    setRequirements([...reqs, ...items.map((q, k) => ({ id: `REQ-${String(start + k + 1).padStart(2, '0')}`, metric: q.metric, operator: q.operator, value: q.value, unit: q.unit, description: q.description }))])
    setProposal(null)
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-slate-200 text-left label"><th className="py-1.5 pr-2">Id</th><th className="py-1.5 pr-2">Metric</th><th className="py-1.5 pr-2">Op</th><th className="py-1.5 pr-2">Target</th><th className="py-1.5 pr-2">Note</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {reqs.map((r, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-2"><input className="input !w-20 font-mono" value={r.id} onChange={(e) => update(i, { id: e.target.value })} /></td>
                <td className="py-1.5 pr-2">
                  <select className="input" value={r.metric} onChange={(e) => update(i, { metric: e.target.value, unit: metrics?.[e.target.value]?.unit })}>
                    {!metrics?.[r.metric] && <option value={r.metric}>{r.metric}</option>}
                    {weightable.map(([k, m]) => <option key={k} value={k}>{m.label} [{m.unit}]</option>)}
                  </select>
                </td>
                <td className="py-1.5 pr-2"><select className="input !w-16" value={r.operator} onChange={(e) => update(i, { operator: e.target.value })}><option>{'>='}</option><option>{'<='}</option></select></td>
                <td className="py-1.5 pr-2"><div className="flex items-center gap-1"><NumberInput className="!w-24" value={r.value} onChange={(v) => update(i, { value: v })} step="any" /><span className="unit">{metrics?.[r.metric]?.unit}</span></div></td>
                <td className="py-1.5 pr-2"><input className="input" value={r.description || ''} onChange={(e) => update(i, { description: e.target.value })} /></td>
                <td className="py-1.5"><button className="btn-ghost !p-1" onClick={() => setRequirements(reqs.filter((_, j) => j !== i))} aria-label="Remove requirement"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
            {!reqs.length && <tr><td colSpan={6} className="py-4 text-center text-sm text-slate-500">No requirements yet. Requirements are shared by every design in the project and checked on every evaluation.</td></tr>}
          </tbody>
        </table>
      </div>
      <button className="btn-secondary" disabled={!weightable.length} onClick={() => setRequirements([...reqs, { id: nextId(), metric: 'usable_energy_wh', operator: '>=', value: null, unit: 'Wh' }])}>
        <Plus className="h-4 w-4" />Add requirement
      </button>
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Sparkles className="h-3.5 w-3.5 text-volt-600" />Extract from text
          <InfoTip>The AI (or the rule-based parser if AI is not configured) proposes requirements. Values not found in your text are rejected by the backend. Confirm each before use.</InfoTip></div>
        <textarea className="input min-h-[64px]" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Outdoor solar storage module: store at least 200 Wh, weigh under 3 kg, charge within 1 hour, keep cells below 45 C." />
        <button className="btn-secondary mt-2" onClick={extract} disabled={busy || text.trim().length < 3}>{busy && <Spinner />}Propose requirements</button>
        <ErrorBox error={error} className="mt-2" />
        {proposal && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs"><Badge tone={proposal.source === 'ai' ? 'volt' : 'slate'}>{proposal.source === 'ai' ? 'AI proposal' : 'Rule-based parser'}</Badge><span className="text-slate-600">{proposal.note}</span></div>
            {proposal.requirements.length ? (
              <ul className="space-y-1 text-sm">{proposal.requirements.map((q) => (
                <li key={q.id} className="num rounded border border-slate-200 bg-white px-2 py-1"><span className="font-mono text-xs">{metrics?.[q.metric]?.label || q.metric}</span> {q.operator} <b>{q.value}</b> {q.unit} <span className="text-xs text-slate-500">({q.confidence}) {q.description}</span></li>
              ))}</ul>
            ) : <p className="text-sm text-slate-500">No requirement could be mapped to a platform metric.</p>}
            {proposal.rejected?.length > 0 && <p className="text-xs text-amber-800">Rejected by backend validation: {proposal.rejected.map((r) => r.reason).join('; ')}</p>}
            {proposal.unmapped?.length > 0 && <p className="text-xs text-slate-600">Not mapped: {proposal.unmapped.map((u) => u.text || JSON.stringify(u)).join('; ')}</p>}
            {proposal.requirements.length > 0 && <div className="flex gap-2"><button className="btn-primary" onClick={() => accept(proposal.requirements)}>Confirm & add all</button><button className="btn-ghost" onClick={() => setProposal(null)}>Discard</button></div>}
          </div>
        )}
      </div>
    </div>
  )
}
