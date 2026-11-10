import { Activity, ArrowRight, BatteryCharging, Bot, Boxes, FileText, GitCompare, Grid3x3, ShieldCheck, Thermometer, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge, cx } from '../components/ui/core'
import { useFetch } from '../hooks/useApi'
import { api, API_DOCS_URL } from '../lib/api'

const MODULES = [
  { icon: Grid3x3, title: 'Configuration studio', to: '/app/wizard', text: 'Cell database with provenance, S×P topology, operating conditions, limits.' },
  { icon: Zap, title: 'Electrical simulation', to: '/app/electrical', text: '1-RC equivalent-circuit model, CC-CV charge, CC/CP discharge.' },
  { icon: Thermometer, title: 'Thermal analysis', to: '/app/thermal', text: 'Lumped thermal network coupled to the electrical model. Clearly labelled simplified.' },
  { icon: ShieldCheck, title: 'BMS & safety', to: '/app/safety', text: 'Limit checks, fuse–BMS coordination, sensing coverage, max safe current, Monte-Carlo.' },
  { icon: Boxes, title: 'Mechanical packaging', to: '/app/packaging', text: 'Envelope, mass roll-up, busbar sizing and a 3D module view.' },
  { icon: GitCompare, title: 'Design comparison', to: '/app/compare', text: 'Baseline vs alternatives: constraint-first ranking, trade-offs and risks.' },
  { icon: Bot, title: 'AI engineering assistant', to: '/app/assistant', text: 'Explains engine results; every number it writes is verified.' },
  { icon: FileText, title: 'Engineering report', to: '/app/report', text: 'Assumptions, sources, results, checks and limitations in one document.' },
]

const FLOW = ['Requirements', 'Cell', 'Topology', 'Simulate', 'Check limits', 'Compare', 'Report']

function SystemStatus() {
  const health = useFetch(() => api.health(), [])
  const ai = useFetch(() => api.ai.status(), [])
  const models = useFetch(() => api.models(), [])
  const row = (label, state, okText) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-2 text-slate-100">
        <span className={cx('h-2 w-2 rounded-full', state.data ? 'bg-emerald-400' : state.error ? 'bg-red-400' : 'bg-slate-500')} />
        {state.data ? okText(state.data) : state.error ? 'unavailable' : 'checking…'}
      </span>
    </div>
  )
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      <div className="label !text-slate-400">Live system status</div>
      <div className="mt-2 divide-y divide-white/10">
        {row('Simulation API', health, (d) => `online · v${d.version}`)}
        {row('Database', health, (d) => (d.database?.backend === 'mongodb' ? `MongoDB · ${d.database.database}` : `SQL${d.database?.fallback_reason ? ' (fallback)' : ''}`))}
        {row('Engineering models', models, (d) => `${d.length} registered`)}
        {row('AI assistant', ai, (d) => (d.configured ? `${d.provider} · ${d.model}` : 'not configured'))}
      </div>
      {health.error && <p className="mt-3 text-xs text-red-300">Start the backend: <span className="font-mono">python -m uvicorn app.main:app --port 8000</span></p>}
    </div>
  )
}

export default function Landing() {
  const models = useFetch(() => api.models(), [])
  return (
    <div className="min-h-screen bg-white">
      <section className="grid-bg relative overflow-hidden bg-ink-950 text-white">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2"><BatteryCharging className="h-6 w-6 text-volt-300" /><span className="font-semibold tracking-tight">BATTERYX <span className="text-volt-300">AI</span></span></div>
          <div className="flex items-center gap-2">
            <a className="btn-ghost !text-slate-300 hover:!bg-white/10" href={API_DOCS_URL} target="_blank" rel="noreferrer">API docs</a>
            <Link className="btn-primary" to="/app/projects">Open workspace</Link>
          </div>
        </nav>
        <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-10 lg:grid-cols-[1.4fr_1fr] lg:pt-16">
          <div>
            <Badge tone="dark" className="!border-volt-700 !text-volt-300">TELIPORT S4 · Case Study 2 · Battery energy system design</Badge>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Change one parameter.<br /><span className="text-volt-300">See every consequence.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              A reusable engineering platform for configuring, simulating, checking and comparing battery modules from cell to system level.
              Physics computes, rules check and AI explains. The engineer decides.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary !px-5 !py-2.5 text-base" to="/app/projects">Start a design <ArrowRight className="h-4 w-4" /></Link>
              <Link className="btn !border !border-white/20 !px-5 !py-2.5 text-base text-white hover:bg-white/10" to="/app/compare">Compare designs</Link>
              <Link className="btn !border !border-white/20 !px-5 !py-2.5 text-base text-white hover:bg-white/10" to="/app/simulator"><Activity className="h-4 w-4" /> Live simulator</Link>
            </div>
          </div>
          <SystemStatus />
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="label">Unified engineering workflow</div>
          <ol className="mt-4 flex flex-wrap items-center gap-2">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800"><span className="mr-1.5 font-mono text-xs text-volt-600">{i + 1}</span>{s}</span>
                {i < FLOW.length - 1 && <ArrowRight className="h-4 w-4 text-slate-400" />}
              </li>
            ))}
          </ol>
          <p className="mt-4 max-w-3xl text-sm text-slate-600">
            Every module reads and writes one shared design state, so a change to the charge current propagates to heat, temperature,
            protection checks, the ranking and the report. No hand-copying between spreadsheets.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Eight integrated modules</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <Link key={m.title} to={m.to} className="panel group p-5 transition hover:border-volt-300 hover:shadow-md">
              <m.icon className="h-5 w-5 text-volt-600" />
              <div className="mt-3 font-semibold text-slate-900 group-hover:text-volt-700">{m.title}</div>
              <p className="mt-1 text-sm text-slate-600">{m.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Engineering honesty, built in</h2>
            <ul className="mt-5 space-y-3 text-sm text-slate-700">
              {[
                ['Numbers come from physics, not from the AI.', 'The AI only explains engine results, and the backend checks every number it writes.'],
                ['Missing data is flagged, never invented.', 'If a datasheet value is absent, dependent calculations report “missing input” or “unsupported”.'],
                ['Every input carries a source tag.', 'Datasheet, design choice, engineer limit or assumption, carried through to the report.'],
                ['Simplified models are labelled as such.', 'Thermal and ageing models state their limitations in every response.'],
                ['Checks screen designs; they do not certify them.', 'Physical testing to the applicable standards is still required.'],
              ].map(([h, t]) => <li key={h}><span className="font-semibold text-slate-900">{h}</span> {t}</li>)}
            </ul>
          </div>
          <div className="panel p-5">
            <div className="label">Registered engineering models (live from the API)</div>
            {models.data ? (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {models.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-slate-800">{m.label}</span>
                    <span className="font-mono text-[11px] text-slate-500">{m.fidelity.replaceAll('_', ' ')}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-500">{models.error ? 'Backend offline: model list unavailable.' : 'Loading…'}</p>}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-slate-500">
        <span>BatteryX AI · Team Bit Manipulators · Walchand College of Engineering, Sangli</span>
        <span>All outputs are model estimates, not measurements, and not a safety certification.</span>
      </footer>
    </div>
  )
}
