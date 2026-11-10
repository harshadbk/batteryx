import { Copy, FolderOpen, Pencil, Play, Plus, Star, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge, DataStatusBadge, EmptyState, ErrorBox, LoadingBlock, Notice, PageHeader, Panel, Spinner, StatusBadge } from '../components/ui/core'
import { RequirementsEditor } from '../components/design/DesignComponents'
import { useFetch } from '../hooks/useApi'
import { api } from '../lib/api'
import { blankDesign, designReady, payloadFor, topology } from '../lib/design'
import { fmt } from '../lib/format'
import { useProject } from '../store/project'

function ProjectList() {
  const { data, loading, error, reload } = useFetch(() => api.projects.list(), [])
  const openProject = useProject((s) => s.openProject)
  const createProject = useProject((s) => s.createProject)
  const [form, setForm] = useState({ name: '', application: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const create = async () => {
    setBusy(true); setErr(null)
    try { await createProject(form); reload() } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const remove = async (id, name) => {
    if (!window.confirm(`Delete project "${name}" and all its designs? This cannot be undone.`)) return
    try { await api.projects.remove(id); reload() } catch (e) { setErr(e) }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Panel title="Projects" subtitle="Stored in the backend database">
        {loading ? <LoadingBlock /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length ? (
          <ul className="divide-y divide-slate-100">
            {data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.application || 'No application set'} · {p.design_count} design{p.design_count === 1 ? '' : 's'} · updated {new Date(p.updated_at).toLocaleString()}</div>
                </div>
                <button className="btn-primary" onClick={() => openProject(p.id)}><FolderOpen className="h-4 w-4" />Open</button>
                <button className="btn-ghost" onClick={() => remove(p.id, p.name)} aria-label={`Delete ${p.name}`}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No projects yet">Create your first project on the right. A project holds a baseline design, its alternatives and shared requirements.</EmptyState>}
        <ErrorBox error={err} className="mt-3" />
      </Panel>
      <Panel title="New project">
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-medium text-slate-700">Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Solar storage module" /></div>
          <div><label className="mb-1 block text-xs font-medium text-slate-700">Application</label><input className="input" value={form.application} onChange={(e) => setForm({ ...form, application: e.target.value })} placeholder="12 V stationary solar storage, outdoor" /></div>
          <div><label className="mb-1 block text-xs font-medium text-slate-700">Description</label><textarea className="input min-h-[72px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <button className="btn-primary w-full" onClick={create} disabled={busy || !form.name.trim()}>{busy ? <Spinner /> : <Plus className="h-4 w-4" />}Create project</button>
        </div>
      </Panel>
    </div>
  )
}

function DesignsTable() {
  const s = useProject()
  const navigate = useNavigate()
  const { project, activeName, cells } = s
  const [renaming, setRenaming] = useState(null)
  const [renameErr, setRenameErr] = useState(null)
  const [examples, setExamples] = useState({ busy: false, error: null })
  const [evalState, setEvalState] = useState({ busy: false, error: null, rows: null })

  const loadExamples = async () => {
    setExamples({ busy: true, error: null })
    try {
      const ex = await api.examples()
      if (!project.requirements.length && ex.designs[0]?.requirements) s.setRequirements(ex.designs[0].requirements)
      ex.designs.forEach((d) => { const { requirements, ...rest } = d; s.addDesign({ ...rest, description: `${d.description || ''} [Illustrative example inputs]` }) })
      setExamples({ busy: false, error: null })
    } catch (e) { setExamples({ busy: false, error: e }) }
  }
  const evaluateAll = async () => {
    setEvalState({ busy: true, error: null, rows: null })
    const rows = []
    for (const d of project.designs) {
      if (!designReady(d).ok) { rows.push({ name: d.name, skipped: designReady(d).reason }); continue }
      try { rows.push({ name: d.name, r: await api.evaluate(payloadFor(d, project)) }) } catch (e) { rows.push({ name: d.name, error: e }) }
    }
    setEvalState({ busy: false, error: null, rows })
  }

  return (
    <Panel title="Designs" subtitle="Baseline and alternatives. The active design is used by every analysis page."
      actions={<>
        <button className="btn-secondary" onClick={loadExamples} disabled={examples.busy}>{examples.busy && <Spinner />}Load stage-1 examples A/B/C</button>
        <button className="btn-primary" onClick={() => { s.addDesign(blankDesign(project.designs.length ? 'Alternative' : 'Baseline')); navigate('/app/wizard') }}><Plus className="h-4 w-4" />New design</button>
      </>}>
      <ErrorBox error={examples.error} className="mb-3" />
      {project.designs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-slate-200 text-left label"><th className="py-2 pr-3">Design</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Cell</th><th className="py-2 pr-3">Topology</th><th className="py-2 pr-3">Ready</th><th className="py-2 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {project.designs.map((d) => {
                const cell = d.cell ?? cells.find((c) => c.id === d.cell_id)
                const ready = designReady(d)
                return (
                  <tr key={d.name} className={d.name === activeName ? 'bg-volt-50/60' : ''}>
                    <td className="py-2 pr-3">
                      {renaming === d.name ? (
                        <form onSubmit={(e) => { e.preventDefault(); const r = s.renameDesign(d.name, e.target.elements.n.value); if (r && r !== 'unchanged') setRenameErr(r); else { setRenaming(null); setRenameErr(null) } }} className="flex gap-1">
                          <input name="n" className="input !py-1" defaultValue={d.name} autoFocus /><button className="btn-secondary !py-1">Save</button>
                        </form>
                      ) : (
                        <button className="text-left font-medium text-slate-900 hover:text-volt-700" onClick={() => s.setActive(d.name)}>{d.name}</button>
                      )}
                      {d.description && <div className="max-w-xs truncate text-xs text-slate-500" title={d.description}>{d.description}</div>}
                    </td>
                    <td className="py-2 pr-3">{d.role === 'baseline' ? <Badge tone="volt">Baseline</Badge> : <Badge>Alternative</Badge>}</td>
                    <td className="py-2 pr-3"><div className="font-mono text-xs">{d.cell_id || d.cell?.id || '—'}</div>{cell && <DataStatusBadge status={cell.data_status} />}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{topology(d)}</td>
                    <td className="py-2 pr-3">{ready.ok ? <Badge tone="green">Ready</Badge> : <Badge tone="amber" title={ready.reason}>Incomplete</Badge>}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <Link className="btn-ghost !px-2" to="/app/wizard" onClick={() => s.setActive(d.name)} title="Configure"><Wand2 className="h-4 w-4" /></Link>
                        <button className="btn-ghost !px-2" onClick={() => setRenaming(d.name)} title="Rename"><Pencil className="h-4 w-4" /></button>
                        <button className="btn-ghost !px-2" onClick={() => s.duplicateDesign(d.name)} title="Duplicate"><Copy className="h-4 w-4" /></button>
                        <button className="btn-ghost !px-2" onClick={() => s.setBaseline(d.name)} disabled={d.role === 'baseline'} title="Make baseline"><Star className="h-4 w-4" /></button>
                        <button className="btn-ghost !px-2" onClick={() => window.confirm(`Delete design "${d.name}"?`) && s.removeDesign(d.name)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {renameErr && <Notice tone="red" className="mt-2">{renameErr}</Notice>}
        </div>
      ) : <EmptyState title="No designs in this project">Create a design with the wizard, or load the stage-1 examples A/B/C (illustrative example inputs) to explore the platform.</EmptyState>}

      {project.designs.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-secondary" onClick={evaluateAll} disabled={evalState.busy}>{evalState.busy ? <Spinner /> : <Play className="h-4 w-4" />}Evaluate all designs</button>
            <span className="text-xs text-slate-500">Runs the full backend pipeline (all modules) on every ready design.</span>
          </div>
          {evalState.rows && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-slate-200 text-left label">
                  <th className="py-2 pr-3">Design</th><th className="py-2 pr-3 text-right">Usable energy [Wh]</th><th className="py-2 pr-3 text-right">CC charge [h]</th>
                  <th className="py-2 pr-3 text-right">Peak T charge [°C]</th><th className="py-2 pr-3 text-right">Mass [kg]</th><th className="py-2 pr-3">Safety checks</th><th className="py-2">Requirements</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {evalState.rows.map((row) => (
                    <tr key={row.name}>
                      <td className="py-2 pr-3 font-medium">{row.name}</td>
                      {row.r ? <>
                        <td className="num py-2 pr-3 text-right">{fmt(row.r.kpis.usable_energy_wh, 4)}</td>
                        <td className="num py-2 pr-3 text-right">{fmt(row.r.kpis.charge_time_cc_estimate_h, 3)}</td>
                        <td className="num py-2 pr-3 text-right">{fmt(row.r.kpis.peak_cell_temp_charge_c, 4)}</td>
                        <td className="num py-2 pr-3 text-right">{fmt(row.r.kpis.module_mass_kg, 3)}</td>
                        <td className="py-2 pr-3"><div className="flex flex-wrap gap-1">{['FAIL', 'WARN', 'PASS', 'NOT_EVALUATED'].map((k) => row.r.safety_summary[k] ? <span key={k} className="flex items-center gap-0.5"><StatusBadge status={k} /><span className="num text-xs">×{row.r.safety_summary[k]}</span></span> : null)}</div></td>
                        <td className="py-2 text-xs">{row.r.requirements.length ? `${row.r.requirements.filter((q) => q.status === 'MET').length}/${row.r.requirements.length} met` : 'none set'}</td>
                      </> : <td colSpan={6} className="py-2 text-xs text-amber-800">{row.skipped || row.error?.message}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">Backend-computed estimates. Open Design comparison for ranking and trade-offs.</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function ProjectMeta() {
  const project = useProject((s) => s.project)
  const updateMeta = useProject((s) => s.updateMeta)
  const closeProject = useProject((s) => s.closeProject)
  return (
    <Panel title="Project" actions={<button className="btn-secondary" onClick={closeProject}>Close project</button>}>
      <div className="grid gap-3 md:grid-cols-3">
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Name</label><input className="input" value={project.name} onChange={(e) => updateMeta({ name: e.target.value })} /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Application</label><input className="input" value={project.application || ''} onChange={(e) => updateMeta({ application: e.target.value })} /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Description</label><input className="input" value={project.description || ''} onChange={(e) => updateMeta({ description: e.target.value })} /></div>
      </div>
    </Panel>
  )
}

export default function Projects() {
  const project = useProject((s) => s.project)
  const loading = useProject((s) => s.loading)
  return (
    <div>
      <PageHeader kicker="Workspace" title={project ? project.name : 'Projects'}
        description={project ? 'Manage designs and shared requirements. Changes are saved to the backend automatically.' : 'Open a project or create a new one.'} />
      {loading ? <LoadingBlock label="Opening project…" /> : project ? (
        <div className="space-y-5">
          <ProjectMeta />
          <DesignsTable />
          <Panel title="Requirements" subtitle="Shared by every design; checked on every evaluation and used in the comparison.">
            <RequirementsEditor />
          </Panel>
        </div>
      ) : <ProjectList />}
    </div>
  )
}
