import {
  Activity, BatteryCharging, Bot, Boxes, ClipboardList, Cpu, FileText, FolderKanban, GitCompare, Grid3x3, Menu, ShieldCheck, Thermometer, Wand2, Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { useFetch } from '../../hooks/useApi'
import { api } from '../../lib/api'
import { topology } from '../../lib/design'
import { useActiveDesign, useProject } from '../../store/project'
import { Badge, cx, DataStatusBadge, Notice } from '../ui/core'
import ErrorBoundary from './ErrorBoundary'

export const NAV = [
  { group: 'Workspace', items: [
    { to: '/app/projects', label: 'Projects', icon: FolderKanban },
    { to: '/app/wizard', label: 'Configuration wizard', icon: Wand2 },
    { to: '/app/simulator', label: 'Live simulator', icon: Activity },
  ] },
  { group: 'Design', items: [
    { to: '/app/cells', label: 'Cell selection', icon: Cpu },
    { to: '/app/topology', label: 'Series-parallel', icon: Grid3x3 },
  ] },
  { group: 'Analysis', items: [
    { to: '/app/electrical', label: 'Electrical', icon: Zap },
    { to: '/app/thermal', label: 'Thermal', icon: Thermometer },
    { to: '/app/safety', label: 'BMS & safety', icon: ShieldCheck },
    { to: '/app/packaging', label: 'Mechanical packaging', icon: Boxes },
  ] },
  { group: 'Decide', items: [
    { to: '/app/compare', label: 'Design comparison', icon: GitCompare },
    { to: '/app/assistant', label: 'AI assistant', icon: Bot },
    { to: '/app/report', label: 'Engineering report', icon: FileText },
  ] },
]

function SaveState() {
  const s = useProject((x) => x.saveState)
  const err = useProject((x) => x.saveError)
  const save = useProject((x) => x.save)
  const map = { saved: ['green', 'Saved'], saving: ['slate', 'Saving…'], dirty: ['slate', 'Unsaved changes'], error: ['red', 'Save failed'], idle: [null] }
  const [tone, label] = map[s] || [null]
  if (!tone) return null
  return (
    <span className="flex items-center gap-1.5">
      <Badge tone={tone} title={err?.message}>{label}</Badge>
      {s === 'error' && <button className="text-xs text-red-700 underline" onClick={save}>Retry</button>}
    </span>
  )
}

function DesignSwitcher() {
  const { project, design, cell } = useActiveDesign()
  const setActive = useProject((s) => s.setActive)
  if (!project) return <Link to="/app/projects" className="text-sm text-volt-700 hover:underline">Open or create a project →</Link>
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="label hidden sm:inline">Project</span>
      <span className="max-w-[180px] truncate text-sm font-semibold text-slate-900" title={project.name}>{project.name}</span>
      <span className="text-slate-300">/</span>
      {project.designs.length ? (
        <select className="input !w-auto max-w-[220px] !py-1" value={design?.name ?? ''} onChange={(e) => setActive(e.target.value)} aria-label="Active design">
          {project.designs.map((d) => <option key={d.name} value={d.name}>{d.name}{d.role === 'baseline' ? ' (baseline)' : ''}</option>)}
        </select>
      ) : <span className="text-sm text-slate-500">no designs yet</span>}
      {design && <Badge tone="dark" className="font-mono">{topology(design)}</Badge>}
      {cell && <DataStatusBadge status={cell.data_status} />}
      <SaveState />
    </div>
  )
}

function BackendStatus() {
  const { data, error } = useFetch(() => api.health(), [])
  const ok = !!data && !error
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-400">
      <span className={cx('h-2 w-2 rounded-full', ok ? 'bg-emerald-400' : error ? 'bg-red-400' : 'bg-slate-500')} />
      {ok ? <span>API v{data.version} · {data.database?.backend === 'mongodb' ? 'MongoDB' : 'SQL'}{data.database?.fallback_reason ? ' (fallback)' : ''}</span> : error ? 'Backend offline' : 'Connecting…'}
    </div>
  )
}

export default function AppShell() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const restoreLast = useProject((s) => s.restoreLast)
  const loadCells = useProject((s) => s.loadCells)
  const loadError = useProject((s) => s.loadError)
  const { cell } = useActiveDesign()
  useEffect(() => { restoreLast(); loadCells() }, [restoreLast, loadCells])
  useEffect(() => setOpen(false), [loc.pathname])

  const nav = (
    <nav className="flex h-full flex-col">
      <Link to="/" className="flex items-center gap-2 px-4 py-4">
        <BatteryCharging className="h-6 w-6 text-volt-300" />
        <span className="font-semibold tracking-tight text-white">BATTERYX <span className="text-volt-300">AI</span></span>
      </Link>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.group}</div>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to}
                className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm', isActive ? 'bg-volt-600/20 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                <it.icon className="h-4 w-4" />{it.label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-white/10 px-4 py-3">
        <BackendStatus />
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><ClipboardList className="h-3 w-3" />All results are model estimates</div>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 bg-ink-950 lg:block">{nav}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-ink-950">{nav}</aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur">
        <button className="btn-ghost -ml-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
        <DesignSwitcher />
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        {loadError && <Notice tone="red" className="mb-4">Could not open the last project: {loadError.message}</Notice>}
        {cell?.data_status === 'illustrative_example' && (
          <Notice className="no-print mb-4">
            <b>Illustrative demo data.</b> The active design uses cell <span className="font-mono">{cell.id}</span>, which holds example values, not a real product datasheet.
            Results demonstrate the method only. Add your selected cell from its datasheet under <Link className="underline" to="/app/cells">Cell selection</Link>.
          </Notice>
        )}
        <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
      </main>
    </div>
  )
}
