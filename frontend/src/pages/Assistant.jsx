import {
  Bot, Calculator, CheckCircle2, ChevronDown, ClipboardCheck, FileText, Lightbulb, MessageSquarePlus, Plus, Send, ShieldAlert, ShieldCheck,
  Trash2, TriangleAlert, User, Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useNavigate } from 'react-router-dom'

import { RequirementsEditor } from '../components/design/DesignComponents'
import { Badge, cx, EmptyState, ErrorBox, LoadingBlock, Notice, PageHeader, Panel, Spinner, Tabs } from '../components/ui/core'
import { useFetch } from '../hooks/useApi'
import { api } from '../lib/api'
import { applyCandidate, designReady, payloadFor } from '../lib/design'
import { fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'

export const CAPABILITIES = [
  { mode: 'design_copilot', label: 'Design Copilot', icon: Lightbulb, needsFocus: false,
    text: 'Plain-language requirements → configurations built from database cells, each evaluated by the engine.',
    examples: ['We need a 12 V module with at least 400 Wh usable that charges within 1.5 h. Which configuration of our cells fits?', 'Suggest two alternatives to the baseline that reduce peak charge temperature.'] },
  { mode: 'analyst', label: 'Engineering Analyst', icon: Calculator, needsFocus: true,
    text: 'Interprets electrical and thermal simulation results of the focus design.',
    examples: ['Explain the charge and discharge behaviour of this design.', 'What drives the peak temperature, and how much margin is left to the limit?'] },
  { mode: 'safety', label: 'Safety Assistant', icon: ShieldAlert, needsFocus: true,
    text: 'Explains warnings, unevaluated checks, risks and constraints. Never certifies.',
    examples: ['Explain every warning and not-evaluated check and what input or test resolves it.', 'Which constraint limits the charge current?'] },
  { mode: 'optimizer', label: 'Optimization Advisor', icon: Wrench, needsFocus: false,
    text: 'Compares alternatives using your priorities and proposes engine-checked improvements.',
    examples: ['Our priorities: fast charging first, then low mass; cost matters less. Which design and what improvement?', 'Sweep the charge current on the baseline and recommend a value that keeps margin to the temperature limit.'] },
  { mode: 'report', label: 'Report Generator', icon: FileText, needsFocus: false,
    text: 'Writes an engineering summary whose every number is sourced and verified.',
    examples: ['Write the engineering summary for this project.'] },
]
const CAP = Object.fromEntries(CAPABILITIES.map((c) => [c.mode, c]))

const BASIS = {
  engine_estimate: ['volt', 'Engine estimate'], cell_database: ['green', 'Cell database'], model_documentation: ['slate', 'Model docs'],
  project_input: ['violet', 'Project input'], general_engineering_knowledge: ['slate', 'General knowledge'],
}

function Section({ title, count, children, defaultOpen = false, tone }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!count) return null
  return (
    <div className="rounded-md border border-slate-200">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-slate-700" onClick={() => setOpen(!open)} aria-expanded={open}>
        {title}<Badge tone={tone || 'slate'}>{count}</Badge><ChevronDown className={cx('ml-auto h-4 w-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-slate-100 p-3">{children}</div>}
    </div>
  )
}

function Refs({ refs, onShow }) {
  return refs?.filter(Boolean).map((r) => (
    <button key={r} onClick={() => onShow(r)} className="mr-1 rounded bg-volt-50 px-1 font-mono text-[10px] text-volt-700 hover:bg-volt-100" title="Show tool result">{r}</button>
  ))
}

function VerificationBadge({ v }) {
  if (!v) return null
  return v.passed ? (
    <Badge tone="green" title="Claims, numbers, references and wording checked against this turn's engine results"><ShieldCheck className="h-3 w-3" />Verified · {v.numbers_checked} numbers checked{v.repair_rounds ? ' · repaired' : ''}</Badge>
  ) : (
    <Badge tone="red" title="The backend found claims it could not verify. Treat flagged content as unreliable."><TriangleAlert className="h-3 w-3" />Verification failed · {v.error_count} issue{v.error_count === 1 ? '' : 's'}</Badge>
  )
}

function Turn({ turn, onAddCandidate, onUseReport }) {
  const s = turn.structured
  const v = turn.verification
  const [shown, setShown] = useState(null)
  const claimStatus = Object.fromEntries((v.claims || []).map((c, i) => [i, c.verification]))
  const issues = v.issues || []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="dark">{turn.capability}</Badge><VerificationBadge v={v} />
        <span className="text-[10px] text-slate-400">{turn.model} · {turn.tool_calls.length} tool calls · {turn.usage?.api_calls} API calls · {fmt(turn.latency_s, 3)} s</span>
      </div>
      {s.summary && <p className="text-sm font-medium text-slate-900">{s.summary}</p>}
      <div className="md text-sm text-slate-800"><ReactMarkdown remarkPlugins={[remarkGfm]}>{s.answer_markdown}</ReactMarkdown></div>
      {!v.passed && (
        <Notice tone="red"><b>The backend could not verify parts of this answer.</b>
          <ul className="mt-1 list-disc pl-4 text-xs">{issues.filter((i) => i.severity === 'error').map((i, k) => <li key={k}><span className="font-mono">{i.type}</span> ({i.where}): {i.detail}</li>)}</ul>
        </Notice>
      )}
      {s.report_sections.length > 0 && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          {s.report_sections.map((r) => (
            <div key={r.title}><div className="text-sm font-semibold text-slate-900">{r.title} <Refs refs={r.source_refs} onShow={setShown} /></div>
              <div className="md text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.body_markdown}</ReactMarkdown></div></div>
          ))}
          <button className="btn-secondary" onClick={() => onUseReport(turn)}><ClipboardCheck className="h-4 w-4" />Use in engineering report</button>
        </div>
      )}
      <div className="space-y-2">
        <Section title="Claims and sources" count={s.claims.length} defaultOpen>
          <table className="w-full text-xs">
            <thead><tr className="text-left label"><th className="py-1 pr-2">Statement</th><th className="py-1 pr-2 text-right">Value</th><th className="py-1 pr-2">Source</th><th className="py-1">Check</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {s.claims.map((c, i) => (
                <tr key={i}><td className="py-1 pr-2 text-slate-700">{c.statement}</td>
                  <td className="num py-1 pr-2 text-right font-medium">{c.value != null ? <>{fmt(c.value, 5)} <span className="unit">{c.unit}</span></> : '—'}</td>
                  <td className="py-1 pr-2"><Badge tone={BASIS[c.basis]?.[0]}>{BASIS[c.basis]?.[1] || c.basis}</Badge> {c.source_ref?.startsWith('T') && <Refs refs={[c.source_ref]} onShow={setShown} />}</td>
                  <td className="py-1">{claimStatus[i] === 'verified' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Badge tone="red">{claimStatus[i]}</Badge>}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Recommendations" count={s.recommendations.length} defaultOpen tone="volt">
          <ul className="space-y-2">{s.recommendations.map((r, i) => (
            <li key={i} className="text-sm"><div className="flex flex-wrap items-center gap-1.5"><Badge tone={r.priority === 'high' ? 'red' : r.priority === 'medium' ? 'amber' : 'slate'}>{r.priority}</Badge>
              <span className="font-medium text-slate-900">{r.action}</span>{r.verified ? <Badge tone="green">engine-checked</Badge> : <Badge>not engine-checked</Badge>}<Refs refs={r.source_refs} onShow={setShown} /></div>
              <div className="text-xs text-slate-600">{r.rationale}</div></li>
          ))}</ul>
        </Section>
        <Section title="Candidate designs (engine-evaluated)" count={s.candidate_designs.length} defaultOpen tone="volt">
          <ul className="space-y-2">{s.candidate_designs.map((c, i) => (
            <li key={i} className="rounded border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.name}</span><span className="text-xs text-slate-500">from {c.base_design}</span>
                {c.evaluated_ref ? <Refs refs={[c.evaluated_ref]} onShow={setShown} /> : <Badge tone="red">not evaluated</Badge>}
                <button className="btn-secondary ml-auto !py-0.5 text-xs" disabled={!v.passed} title={v.passed ? 'Add as a new design draft' : 'Only verified candidates can be added'} onClick={() => onAddCandidate(c)}><Plus className="h-3.5 w-3.5" />Add to project</button></div>
              <div className="mt-1 font-mono text-[11px] text-slate-600">{c.changes.map((ch) => `${ch.path} = ${ch.value}`).join(' · ') || 'no changes'}</div>
              <div className="text-xs text-slate-600">{c.verdict}</div>
            </li>
          ))}</ul>
        </Section>
        <Section title="Assumptions" count={s.assumptions.length}><ul className="list-disc pl-4 text-xs text-slate-700">{s.assumptions.map((x) => <li key={x}>{x}</li>)}</ul></Section>
        <Section title="Uncertainties" count={s.uncertainties.length}><ul className="list-disc pl-4 text-xs text-slate-700">{s.uncertainties.map((x) => <li key={x}>{x}</li>)}</ul></Section>
        <Section title="Missing inputs" count={s.missing_inputs.length} tone="amber"><ul className="list-disc pl-4 text-xs text-slate-700">{s.missing_inputs.map((x) => <li key={x}>{x}</li>)}</ul></Section>
        <Section title="Tool calls (backend engine and database)" count={turn.tool_calls.length}>
          <ul className="space-y-1 text-xs">{turn.tool_calls.map((t) => (
            <li key={t.ref} className="flex flex-wrap items-center gap-2"><Refs refs={[t.ref]} onShow={setShown} /><span className="font-mono">{t.name}</span>
              <span className="truncate font-mono text-[10px] text-slate-500" title={JSON.stringify(t.input)}>{JSON.stringify(t.input)}</span>
              {!t.ok && <Badge tone="red" title={t.error}>error: {t.error}</Badge>}</li>
          ))}</ul>
        </Section>
        {issues.some((i) => i.severity === 'warning') && <Section title="Verifier warnings" count={issues.filter((i) => i.severity === 'warning').length} tone="amber">
          <ul className="list-disc pl-4 text-xs">{issues.filter((i) => i.severity === 'warning').map((i, k) => <li key={k}>{i.type}: {i.detail}</li>)}</ul></Section>}
      </div>
      {shown && turn.tool_results?.[shown] && (
        <div className="rounded-md border border-volt-100 bg-volt-50/50 p-2">
          <div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold">Source {shown}: {turn.tool_calls.find((t) => t.ref === shown)?.name}</span><button className="text-volt-700 underline" onClick={() => setShown(null)}>close</button></div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-slate-700">{JSON.stringify(turn.tool_results[shown], null, 1)}</pre>
        </div>
      )}
      <p className="text-[11px] text-slate-500">{s.safety_notice} <span className="text-slate-400">{turn.label}</span></p>
    </div>
  )
}

function Copilot() {
  const { project, design } = useActiveDesign()
  const addDesign = useProject((s) => s.addDesign)
  const setAiReport = useProject((s) => s.setAiReport)
  const navigate = useNavigate()
  const status = useFetch(() => api.copilot.status(), [])
  const [mode, setMode] = useState('analyst')
  const [focus, setFocus] = useState(design?.name ?? '')
  const [convs, setConvs] = useState([])
  const [conv, setConv] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const endRef = useRef(null)
  const ready = project.designs.filter((d) => designReady(d).ok)

  const loadConvs = useCallback(async () => { try { setConvs(await api.copilot.conversations(project.id)) } catch { /* list optional */ } }, [project.id])
  useEffect(() => { loadConvs(); setConv(null) }, [loadConvs])
  useEffect(() => { if (!focus && ready[0]) setFocus(design?.name && designReady(design).ok ? design.name : ready[0].name) }, [ready.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth' }) }, [conv?.turns?.length, busy])

  const open = async (id) => { setError(null); try { setConv(await api.copilot.conversation(id)) } catch (e) { setError(e) } }
  const remove = async (id) => { if (!window.confirm('Delete this conversation?')) return; await api.copilot.removeConversation(id); if (conv?.id === id) setConv(null); loadConvs() }
  const send = async (text) => {
    const message = (text ?? input).trim()
    if (!message) return
    setBusy(true); setError(null); setInput('')
    const pending = { message, pending: true, mode }
    setConv((c) => ({ ...(c || { turns: [] }), turns: [...(c?.turns || []), pending] }))
    try {
      const r = await api.copilot.chat(project.id, { mode, message, conversation_id: conv?.id ?? null, focus_design: CAP[mode].needsFocus || focus ? focus || null : null })
      setConv(await api.copilot.conversation(r.conversation_id))
      loadConvs()
    } catch (e) {
      setError(e); setInput(message)
      setConv((c) => ({ ...c, turns: c.turns.filter((t) => t !== pending) }))
    } finally { setBusy(false) }
  }
  const addCandidate = (c) => {
    try { const name = addDesign(applyCandidate(project, c)); setNote(`Added "${name}" to the project as a draft. Re-run the analyses to review it.`) } catch (e) { setNote(e.message) }
  }
  const useReport = (turn) => { setAiReport(turn); navigate('/app/report') }

  if (status.loading) return <LoadingBlock />
  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />
  const s = status.data
  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <Panel title="Capability" bodyClass="p-2">
          <div className="space-y-1">{CAPABILITIES.map((c) => (
            <button key={c.mode} onClick={() => setMode(c.mode)} className={cx('flex w-full items-start gap-2 rounded-md px-2 py-2 text-left', mode === c.mode ? 'bg-volt-50 ring-1 ring-volt-300' : 'hover:bg-slate-50')}>
              <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-volt-600" /><span><span className="block text-sm font-medium text-slate-900">AI {c.label}</span><span className="block text-[11px] text-slate-500">{c.text}</span></span>
            </button>
          ))}</div>
        </Panel>
        <Panel title="Focus design">
          <select className="input" value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Focus design">
            <option value="">(none)</option>{ready.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
          {CAP[mode].needsFocus && !focus && <p className="mt-1 text-xs text-amber-700">This capability needs a focus design.</p>}
        </Panel>
        <Panel title="Conversations" subtitle="Saved per project" actions={<button className="btn-ghost !p-1" onClick={() => setConv(null)} title="New conversation"><MessageSquarePlus className="h-4 w-4" /></button>} bodyClass="p-2">
          {convs.length ? <ul className="space-y-0.5">{convs.map((c) => (
            <li key={c.id} className={cx('group flex items-center gap-1 rounded px-2 py-1 text-xs', conv?.id === c.id ? 'bg-slate-100' : 'hover:bg-slate-50')}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => open(c.id)} title={c.title}>{c.title}</button>
              <span className="text-[10px] text-slate-400">{c.turn_count}</span>
              <button className="opacity-0 group-hover:opacity-100" onClick={() => remove(c.id)} aria-label="Delete conversation"><Trash2 className="h-3 w-3 text-slate-400" /></button>
            </li>))}</ul> : <p className="px-2 py-1 text-xs text-slate-500">No conversations yet.</p>}
        </Panel>
      </div>
      <Panel title={`AI ${CAP[mode].label}`} subtitle={s.configured ? (s.provider === 'groq' ? `Groq · ${s.model}` : `Claude · ${s.model} · effort ${s.effort}`) : 'Copilot not configured'} bodyClass="p-0">
        {!s.configured ? (
          <div className="p-4"><Notice tone="slate">Add <span className="font-mono">GROQ_API_KEY</span> (or <span className="font-mono">ANTHROPIC_API_KEY</span>) to <span className="font-mono">backend/.env</span> and restart the backend.
            The key stays on the server and is never sent to the browser. See the backend README, section "Claude copilot".</Notice></div>
        ) : (
          <div className="flex h-[640px] flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {!conv?.turns?.length && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-600">Workflow: you describe the need → Claude interprets it → the <b>backend engine computes</b> → Claude analyses the results → the backend <b>verifies every number and reference</b> → you review and compare.</p>
                  {CAP[mode].examples.map((e) => <button key={e} className="block w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 hover:border-volt-300 hover:bg-volt-50" onClick={() => send(e)} disabled={busy || (CAP[mode].needsFocus && !focus)}>{e}</button>)}
                </div>
              )}
              {conv?.turns?.map((t, i) => (
                <div key={i} className="space-y-3">
                  <div className="flex justify-end gap-2"><div className="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 text-sm"><span className="mr-1 text-[10px] uppercase text-slate-400">{CAP[t.mode]?.label}{t.focus_design ? ` · ${t.focus_design}` : ''}</span><br />{t.message}</div><User className="h-6 w-6 rounded-full bg-slate-200 p-1" /></div>
                  {t.pending ? <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner />Claude is calling the engine and verifying the answer…</div>
                    : <div className="flex gap-2"><Bot className="h-6 w-6 shrink-0 rounded-full bg-volt-600 p-1 text-white" /><div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-3"><Turn turn={t} onAddCandidate={addCandidate} onUseReport={useReport} /></div></div>}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div className="border-t border-slate-200 p-3">
              {note && <Notice tone="volt" className="mb-2">{note} <button className="underline" onClick={() => setNote(null)}>dismiss</button></Notice>}
              <ErrorBox error={error} className="mb-2" />
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
                <input className="input" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} aria-label="Message to the copilot"
                  placeholder={CAP[mode].needsFocus && !focus ? 'Select a focus design first' : `Ask the ${CAP[mode].label}…`} />
                <button className="btn-primary" disabled={busy || !input.trim() || (CAP[mode].needsFocus && !focus)}>{busy ? <Spinner /> : <Send className="h-4 w-4" />}Send</button>
              </form>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}

function QuickExplain() {
  const { project, design } = useActiveDesign()
  const status = useFetch(() => api.ai.status(), [])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ask = async () => {
    const question = input.trim()
    if (!question || !design) return
    setBusy(true); setError(null); setInput('')
    try {
      const r = await api.ai.explain({ question, context_type: 'design', design: payloadFor(design, project), history: messages.map(({ role, content }) => ({ role, content })) })
      setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: r.answer, grounding: r.grounding }])
    } catch (e) { setError(e); setInput(question) } finally { setBusy(false) }
  }
  if (status.data && !status.data.configured) return <Notice tone="slate">Quick explain uses the Groq provider (GROQ_API_KEY), which is not configured.</Notice>
  return (
    <Panel title="Quick explain (Groq)" subtitle="Single-step grounded explanation of the active design. No tools, no project memory.">
      <div className="space-y-3">
        {messages.map((m, i) => <div key={i} className={cx('rounded-md px-3 py-2 text-sm', m.role === 'user' ? 'bg-slate-100' : 'border border-slate-200')}>
          {m.role === 'assistant' ? <><div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
            <VerificationBadge v={{ passed: m.grounding.passed, numbers_checked: m.grounding.numbers_checked, error_count: m.grounding.ungrounded_numbers.length }} /></> : m.content}</div>)}
        <ErrorBox error={error} />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask() }}>
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || !design} aria-label="Quick question" placeholder="Ask about the active design…" />
          <button className="btn-primary" disabled={busy || !input.trim()}>{busy ? <Spinner /> : <Send className="h-4 w-4" />}Ask</button>
        </form>
      </div>
    </Panel>
  )
}

export default function Assistant() {
  const { project } = useActiveDesign()
  const [tab, setTab] = useState('copilot')
  if (!project) return <EmptyState icon={Bot} title="No project open" action={<Link className="btn-primary" to="/app/projects">Open a project</Link>}>The copilot works on your project's designs, cells and requirements.</EmptyState>
  return (
    <div>
      <PageHeader kicker="Decide" title="AI engineering copilot"
        description="Claude interprets your request and calls the BatteryX engine and cell database as tools. The engine computes every value, and the backend checks each answer's numbers, sources and wording before you see it."
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'copilot', label: 'AI copilot' }, { value: 'quick', label: 'Quick explain' }, { value: 'reqs', label: 'Requirements from text' }]} />} />
      {tab === 'copilot' && <Copilot />}
      {tab === 'quick' && <QuickExplain />}
      {tab === 'reqs' && <Panel title="Requirements from plain text"><RequirementsEditor /></Panel>}
    </div>
  )
}
