import { Award, GitCompare } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { MetricBarChart } from '../components/charts/Charts'
import { Badge, cx, EmptyState, ErrorBox, LoadingBlock, Notice, PageHeader, Panel, Spinner, StatusBadge } from '../components/ui/core'
import { EstimateNote, ModelCard } from '../components/ui/results'
import { useFetch } from '../hooks/useApi'
import { api } from '../lib/api'
import { designReady, payloadFor } from '../lib/design'
import { fmt } from '../lib/format'
import { useProject } from '../store/project'

const DEFAULT_WEIGHTS = { usable_energy_wh: 1, charge_time_cc_estimate_h: 1, peak_cell_temp_charge_c: 1, module_mass_kg: 1, module_volume_l: 1, relative_cost_index: 1 }

export function buildCompareRequest(project, baselineName, altNames, weights) {
  const byName = Object.fromEntries(project.designs.map((d) => [d.name, d]))
  return {
    baseline: payloadFor(byName[baselineName], project),
    alternatives: altNames.map((n) => payloadFor(byName[n], project)),
    weights: Object.fromEntries(Object.entries(weights).filter(([, w]) => w > 0)),
  }
}

function Recommendation({ rec, notes }) {
  if (!rec) return <Notice tone="red">No design is eligible for recommendation. Every design has at least one safety check FAIL.</Notice>
  const list = (title, items, tone) => items?.length ? (
    <div><div className={cx('label mb-1', tone)}>{title}</div><ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-700">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>
  ) : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Award className="h-5 w-5 text-volt-600" /><span className="text-lg font-semibold text-slate-900">{rec.design_name}</span><Badge tone="dark" className="font-mono">{rec.topology}</Badge>
        <Badge tone="volt">Recommended by the comparison engine</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {list('Why (improvements vs baseline)', rec.why, '!text-emerald-700')}
        {list('Trade-offs (worse than baseline)', rec.trade_offs, '!text-amber-700')}
      </div>
      {list('Risks and open issues', rec.risks, '!text-red-700')}
      {list('Model limitations', rec.model_limitations)}
      <Notice tone="volt"><b>Recommended next step:</b> {rec.recommended_next_step}</Notice>
      {notes?.map((n) => <Notice key={n} tone="slate">{n}</Notice>)}
    </div>
  )
}

export default function Compare() {
  const project = useProject((s) => s.project)
  const comparison = useProject((s) => s.comparison)
  const setComparison = useProject((s) => s.setComparison)
  const { data: metrics } = useFetch(() => api.metrics(), [])
  const ready = useMemo(() => (project?.designs || []).filter((d) => designReady(d).ok), [project])
  const [baseline, setBaseline] = useState(null)
  const [alts, setAlts] = useState([])
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS)
  const [state, setState] = useState({ busy: false, error: null })
  const [metric, setMetric] = useState('usable_energy_wh')

  useEffect(() => {
    if (!project) return
    const b = ready.find((d) => d.role === 'baseline')?.name ?? ready[0]?.name ?? null
    setBaseline(b)
    setAlts(ready.filter((d) => d.name !== b).map((d) => d.name))
  }, [project?.id, ready.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <EmptyState icon={GitCompare} title="No project open" action={<Link className="btn-primary" to="/app/projects">Open a project</Link>} />
  if (ready.length < 2)
    return (
      <div><PageHeader kicker="Decide" title="Design comparison" />
        <EmptyState icon={GitCompare} title="Need at least two ready designs" action={<Link className="btn-primary" to="/app/projects">Go to projects</Link>}>
          The comparison needs a baseline and at least one alternative with a cell selected (the case study asks for two alternatives). Load the stage-1 examples A/B/C to try it.
        </EmptyState></div>
    )

  const request = baseline ? buildCompareRequest(project, baseline, alts.filter((a) => a !== baseline), weights) : null
  const key = JSON.stringify(request)
  const data = comparison?.data
  const stale = comparison && comparison.key !== key
  const run = async () => {
    setState({ busy: true, error: null })
    try { setComparison({ key, data: await api.compare(request) }); setState({ busy: false, error: null }) } catch (e) { setState({ busy: false, error: e }) }
  }
  const weightable = metrics ? Object.entries(metrics).filter(([, m]) => m.better !== 'info') : []
  const designs = data?.designs || []
  const target = project.requirements.find((q) => q.metric === metric)

  return (
    <div>
      <PageHeader kicker="Decide" title="Design comparison workspace"
        description="Constraint-first comparison: designs with a safety FAIL are excluded, missed requirements are penalised, then a weighted normalised score ranks the rest." />
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <Panel title="Designs to compare">
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs font-medium text-slate-700">Baseline</label>
                <select className="input" value={baseline ?? ''} onChange={(e) => { setBaseline(e.target.value); setAlts(alts.filter((a) => a !== e.target.value)) }}>
                  {ready.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select></div>
              <div><div className="mb-1 text-xs font-medium text-slate-700">Alternatives</div>
                <div className="space-y-1">{ready.filter((d) => d.name !== baseline).map((d) => (
                  <label key={d.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={alts.includes(d.name)} onChange={(e) => setAlts(e.target.checked ? [...alts, d.name] : alts.filter((a) => a !== d.name))} />{d.name}<span className="font-mono text-xs text-slate-500">{d.series}S{d.parallel}P</span></label>
                ))}</div></div>
              {project.requirements.length === 0 && <Notice tone="slate">No project requirements set. Add them on the Projects page so they're checked in the comparison.</Notice>}
            </div>
          </Panel>
          <Panel title="Preference weights" subtitle="Weights express preference, not engineering fact. 0 excludes a metric.">
            {metrics ? (
              <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                {weightable.map(([k, m]) => (
                  <label key={k} className="text-xs">
                    <div className="flex justify-between"><span className="text-slate-700">{m.label} <span className="unit">[{m.unit}] {m.better === 'high' ? '↑' : '↓'}</span></span><span className="num font-medium">{weights[k] ?? 0}</span></div>
                    <input type="range" min={0} max={3} step={0.5} value={weights[k] ?? 0} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="w-full accent-volt-600" />
                  </label>
                ))}
              </div>
            ) : <LoadingBlock />}
          </Panel>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={run} disabled={state.busy || !alts.length}>{state.busy ? <Spinner /> : <GitCompare className="h-4 w-4" />}Run comparison</button>
          {stale && <Badge tone="amber">Selection, weights or designs changed since last run</Badge>}
          {!alts.length && <span className="text-xs text-slate-500">Select at least one alternative.</span>}
        </div>
        <ErrorBox error={state.error} />

        {data ? (
          <>
            <Panel title="Recommendation"><Recommendation rec={data.recommendation} notes={data.notes} /></Panel>
            <Panel title="Ranking">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr className="border-b border-slate-200 text-left label"><th className="py-2 pr-3">Rank</th><th className="py-2 pr-3">Design</th><th className="py-2 pr-3">Eligible</th><th className="py-2 pr-3 text-right">Score</th><th className="py-2 pr-3 text-right">Rank value</th><th className="py-2 pr-3">Safety</th><th className="py-2">Requirements not met</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...data.ranking].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((r) => (
                      <tr key={r.design_name} className="align-top">
                        <td className="num py-2 pr-3 font-semibold">{r.rank ?? '—'}</td>
                        <td className="py-2 pr-3"><div className="font-medium">{r.design_name}</div><div className="font-mono text-xs text-slate-500">{r.topology} · {r.cell_id}</div>{r.role === 'baseline' && <Badge tone="volt">Baseline</Badge>}</td>
                        <td className="py-2 pr-3">{r.eligible ? <Badge tone="green">Eligible</Badge> : <Badge tone="red">Safety FAIL</Badge>}</td>
                        <td className="num py-2 pr-3 text-right">{fmt(r.score, 4)}</td>
                        <td className="num py-2 pr-3 text-right">{fmt(r.rank_value, 4)}</td>
                        <td className="py-2 pr-3 text-xs">
                          {r.safety_fails.map((x) => <div key={x} className="text-red-700">{x}</div>)}
                          {r.safety_warnings.map((x) => <div key={x} className="text-amber-700">{x}</div>)}
                          {r.checks_not_evaluated.length > 0 && <div className="text-slate-500">{r.checks_not_evaluated.length} not evaluated</div>}
                          {!r.safety_fails.length && !r.safety_warnings.length && <span className="text-emerald-700">no FAIL / WARN</span>}
                        </td>
                        <td className="py-2 text-xs text-red-700">{r.requirements_not_met.join('; ') || <span className="text-slate-500">none</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="grid gap-5 xl:grid-cols-2">
              <Panel title="Metric explorer" actions={
                <select className="input !w-auto !py-1" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">
                  {Object.entries(data.metrics).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>}>
                <MetricBarChart unit={data.metrics[metric]?.unit} target={target}
                  rows={designs.map((d) => ({ name: d.design_name, value: d.kpis[metric], highlight: d.design_name === data.recommendation?.design_name }))} />
                <p className="text-xs text-slate-500">{data.metrics[metric]?.better === 'high' ? 'Higher is better.' : data.metrics[metric]?.better === 'low' ? 'Lower is better.' : 'Informational metric.'} The recommended design is highlighted{target ? '; the dashed line is the project requirement.' : '.'}</p>
              </Panel>
              <Panel title="Score composition" subtitle="Normalised 0–1 per metric within this comparison (1 = best)">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-200 text-left label"><th className="py-1.5 pr-2">Metric (weight)</th>{data.ranking.map((r) => <th key={r.design_name} className="py-1.5 pr-2">{r.design_name}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(data.weights_used).map(([k, w]) => (
                        <tr key={k}><td className="py-1.5 pr-2 text-xs text-slate-700">{data.metrics[k]?.label} <span className="num text-slate-400">({w})</span></td>
                          {data.ranking.map((r) => (
                            <td key={r.design_name} className="py-1.5 pr-2">
                              <div className="flex items-center gap-1.5"><div className="h-2 w-16 rounded bg-slate-100"><div className="h-2 rounded bg-volt-500" style={{ width: `${(r.score_parts[k] ?? 0) * 100}%` }} /></div><span className="num text-xs">{fmt(r.score_parts[k], 3)}</span></div>
                            </td>))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            <Panel title="Change vs baseline" subtitle="Green = better, amber = worse, per the metric's direction">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead><tr className="border-b border-slate-200 text-left label"><th className="py-1.5 pr-3">Metric</th><th className="py-1.5 pr-3 text-right">Baseline</th>{data.ranking.filter((r) => r.role !== 'baseline').map((r) => <th key={r.design_name} className="py-1.5 pr-3 text-right">{r.design_name}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(data.metrics).map(([k, m]) => {
                      const base = designs[0]?.kpis[k]
                      if (base == null) return null
                      return (
                        <tr key={k}>
                          <td className="py-1.5 pr-3 text-slate-700">{m.label} <span className="unit">[{m.unit}]</span></td>
                          <td className="num py-1.5 pr-3 text-right">{fmt(base, 4)}</td>
                          {data.ranking.filter((r) => r.role !== 'baseline').map((r) => {
                            const dv = r.delta_vs_baseline[k]
                            if (!dv) return <td key={r.design_name} className="py-1.5 pr-3 text-right text-slate-400">—</td>
                            const good = m.better === 'info' || dv.delta === 0 ? null : (dv.delta > 0) === (m.better === 'high')
                            return <td key={r.design_name} className={cx('num py-1.5 pr-3 text-right', good === true && 'text-emerald-700', good === false && 'text-amber-700')}>
                              {fmt(dv.value, 4)} <span className="text-[11px]">({dv.delta_pct != null ? `${dv.delta_pct > 0 ? '+' : ''}${fmt(dv.delta_pct, 3)} %` : '—'})</span></td>
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Per-design check status">
              <div className="grid gap-4 md:grid-cols-3">
                {designs.map((d) => (
                  <div key={d.design_name} className="rounded-md border border-slate-200 p-3">
                    <div className="mb-2 font-medium">{d.design_name}</div>
                    <div className="space-y-1">{d.modules.bms.values.checks.map((c) => <div key={c.id} className="flex items-center gap-2 text-xs"><StatusBadge status={c.status} /><span className="font-mono text-slate-500">{c.id}</span><span className="truncate text-slate-700" title={c.detail}>{c.description}</span></div>)}</div>
                  </div>
                ))}
              </div>
            </Panel>
            <EstimateNote />
            <ModelCard model={data.model} />
          </>
        ) : <EmptyState icon={GitCompare} title="No comparison yet">Choose the baseline and alternatives, adjust weights if needed, then run the comparison.</EmptyState>}
      </div>
    </div>
  )
}
