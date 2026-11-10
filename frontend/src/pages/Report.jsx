import { Download, FileJson, FileText, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'

import { Badge, EmptyState, ErrorBox, Notice, PageHeader, Panel, Spinner } from '../components/ui/core'
import { useFetch } from '../hooks/useApi'
import { api } from '../lib/api'
import { designReady, payloadFor } from '../lib/design'
import { buildMarkdown } from '../lib/report'
import { useProject } from '../store/project'
import { buildCompareRequest } from './Compare'

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Report() {
  const project = useProject((s) => s.project)
  const ready = useMemo(() => (project?.designs || []).filter((d) => designReady(d).ok), [project])
  const [selected, setSelected] = useState([])
  const [withComparison, setWithComparison] = useState(true)
  const [state, setState] = useState({ busy: false, error: null, report: null })
  const aiReport = useProject((s) => s.aiReport)
  const setAiReport = useProject((s) => s.setAiReport)
  const [withAi, setWithAi] = useState(false)
  const [ai, setAi] = useState({ busy: false, error: null })
  const aiStatus = useFetch(() => api.copilot.status(), [])
  useEffect(() => { if (aiReport) setWithAi(true) }, [aiReport])
  useEffect(() => { setSelected(ready.map((d) => d.name)) }, [project?.id, ready.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <EmptyState icon={FileText} title="No project open" action={<Link className="btn-primary" to="/app/projects">Open a project</Link>} />

  const generate = async () => {
    setState({ busy: true, error: null, report: null })
    try {
      const designs = project.designs.filter((d) => selected.includes(d.name))
      const ordered = [...designs.filter((d) => d.role === 'baseline'), ...designs.filter((d) => d.role !== 'baseline')]
      const [evaluations, models] = await Promise.all([Promise.all(ordered.map((d) => api.evaluate(payloadFor(d, project)))), api.models()])
      let comparison = null
      if (withComparison && ordered.length >= 2) {
        comparison = await api.compare(buildCompareRequest(project, ordered[0].name, ordered.slice(1).map((d) => d.name),
          { usable_energy_wh: 1, charge_time_cc_estimate_h: 1, peak_cell_temp_charge_c: 1, module_mass_kg: 1, module_volume_l: 1, relative_cost_index: 1 }))
      }
      const generatedAt = new Date().toLocaleString()
      const aiSummary = withAi && aiReport ? aiReport : null
      const markdown = buildMarkdown({ project, evaluations, comparison, models, generatedAt, aiSummary })
      setState({ busy: false, error: null, report: { markdown, raw: { project, evaluations, comparison, models, generatedAt, aiSummary } } })
    } catch (e) { setState({ busy: false, error: e, report: null }) }
  }
  const slug = project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

  return (
    <div>
      <div className="no-print">
        <PageHeader kicker="Decide" title="Engineering report"
          description="Generates a traceable report from fresh backend runs: application, requirements, data sources, results, checks, comparison, assumptions, limitations and model equations." />
        <Panel title="Report contents" className="mb-5">
          {ready.length ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-5 gap-y-2">{ready.map((d) => (
                <label key={d.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(d.name)} onChange={(e) => setSelected(e.target.checked ? [...selected, d.name] : selected.filter((n) => n !== d.name))} />{d.name}{d.role === 'baseline' && <span className="text-xs text-volt-700">(baseline)</span>}</label>
              ))}</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={withComparison} onChange={(e) => setWithComparison(e.target.checked)} />Include design comparison (default weights, baseline first)</label>
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={withAi} disabled={!aiReport} onChange={(e) => setWithAi(e.target.checked)} />Include AI-written engineering summary (Claude)</label>
                {aiReport ? <Badge tone={aiReport.verification.passed ? 'green' : 'red'}>{aiReport.verification.passed ? 'verified' : 'verification failed'} · {aiReport.structured.report_sections.length} sections</Badge>
                  : <span className="text-xs text-slate-500">none generated yet</span>}
                <button className="btn-secondary !py-1 text-xs" disabled={ai.busy || !aiStatus.data?.configured} title={aiStatus.data?.configured ? '' : 'Claude not configured on the backend'}
                  onClick={async () => {
                    setAi({ busy: true, error: null })
                    try { const r = await api.copilot.chat(project.id, { mode: 'report', message: 'Write the engineering summary for this project.' }); setAiReport(r.turn); setAi({ busy: false, error: null }) } catch (e) { setAi({ busy: false, error: e }) }
                  }}>{ai.busy && <Spinner />}Generate with Claude</button>
              </div>
              <ErrorBox error={ai.error} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={generate} disabled={state.busy || !selected.length}>{state.busy ? <Spinner /> : <FileText className="h-4 w-4" />}Generate report</button>
                {state.report && <>
                  <button className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print / save as PDF</button>
                  <button className="btn-secondary" onClick={() => download(`${slug}-report.md`, state.report.markdown, 'text/markdown')}><Download className="h-4 w-4" />Markdown</button>
                  <button className="btn-secondary" onClick={() => download(`${slug}-results.json`, JSON.stringify(state.report.raw, null, 2), 'application/json')}><FileJson className="h-4 w-4" />Raw results (JSON)</button>
                </>}
              </div>
              <ErrorBox error={state.error} />
            </div>
          ) : <Notice tone="slate">No ready designs. Select a cell for at least one design first.</Notice>}
        </Panel>
      </div>
      {state.report ? (
        <article className="panel print-page mx-auto max-w-4xl px-8 py-8">
          <div className="md text-sm leading-relaxed text-slate-800"><ReactMarkdown remarkPlugins={[remarkGfm]}>{state.report.markdown}</ReactMarkdown></div>
        </article>
      ) : !state.busy && <div className="no-print"><EmptyState icon={FileText} title="No report generated yet">Choose the designs and generate. Every value in the report comes from a backend run made at generation time.</EmptyState></div>}
    </div>
  )
}
