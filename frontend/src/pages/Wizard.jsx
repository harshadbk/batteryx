import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { RequirementsEditor } from '../components/design/DesignComponents'
import RequireDesign from '../components/layout/Gate'
import { Badge, cx, Notice, PageHeader, Panel, Stat, StatusBadge } from '../components/ui/core'
import { FieldGrid } from '../components/ui/fields'
import { ChecksTable, EstimateNote, FlagList, RunBar } from '../components/ui/results'
import { useDesignRun } from '../hooks/useApi'
import { api } from '../lib/api'
import { getPath } from '../lib/design'
import { AGEING_FIELDS, BUSBAR_FIELDS, COST_FIELDS, LIMIT_FIELDS, MECHANICAL_FIELDS, OPERATING_FIELDS, THERMAL_FIELDS } from '../lib/fields'
import { fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'
import { CellPicker } from './Cells'
import { TopologyEditor } from './Topology'

const STEPS = ['Application', 'Cell', 'Topology', 'Operating', 'Thermal', 'Protection', 'Packaging & cost', 'Review']

function StepApplication() {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const project = useProject((s) => s.project)
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Design name</label><input className="input bg-slate-50" value={design.name} readOnly title="Rename from the Projects page" /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Role</label>
          <div className="pt-1.5">{design.role === 'baseline' ? <Badge tone="volt">Baseline</Badge> : <Badge>Alternative</Badge>} <span className="text-xs text-slate-500">(change on the Projects page)</span></div></div>
        <div className="md:col-span-2"><label className="mb-1 block text-xs font-medium text-slate-700">Design intent / description</label>
          <textarea className="input min-h-[64px]" value={design.description || ''} onChange={(e) => updateActive('description', e.target.value)} placeholder="What does this option change, and why?" /></div>
      </div>
      <Notice tone="slate">Application: <b>{project.application || 'not set'}</b>. Edit it on the Projects page.</Notice>
      <div><div className="label mb-2">Project requirements</div><RequirementsEditor /></div>
    </div>
  )
}

function StepFields({ groups }) {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="mb-2 flex items-center gap-2"><span className="label">{g.title}</span>{g.extra}</div>
          {g.note && <p className="mb-2 text-xs text-slate-500">{g.note}</p>}
          <FieldGrid fields={g.fields} data={design} onChange={updateActive} />
        </div>
      ))}
    </div>
  )
}

function BusbarToggle() {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const on = !!getPath(design, 'mechanical.busbar')
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      <input type="checkbox" checked={on} onChange={(e) => updateActive('mechanical.busbar', e.target.checked ? { material: 'copper', current_density_a_per_mm2: null, thickness_mm: null } : null)} />
      Size series busbars
    </label>
  )
}

function StepReview() {
  const run = useDesignRun('evaluate', (p) => api.evaluate(p))
  const r = run.data
  return (
    <div className="space-y-4">
      <RunBar label="Evaluate design" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error}
        hint="Runs every backend module: configuration, energy, simulations, thermal, ageing, BMS, mechanical, cost." />
      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Usable energy" value={fmt(r.kpis.usable_energy_wh, 4)} unit="Wh" />
            <Stat label="CC charge time (estimate)" value={fmt(r.kpis.charge_time_cc_estimate_h, 3)} unit="h" />
            <Stat label="Est. peak temp (charge)" value={fmt(r.kpis.peak_cell_temp_charge_c, 4)} unit="°C" />
            <Stat label="Module mass" value={fmt(r.kpis.module_mass_kg, 3)} unit="kg" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="label">Safety checks</span>
            {['FAIL', 'WARN', 'PASS', 'NOT_EVALUATED'].map((k) => (r.safety_summary[k] ? <span key={k} className="flex items-center gap-1"><StatusBadge status={k} /><span className="num">×{r.safety_summary[k]}</span></span> : null))}
          </div>
          {r.requirements.length > 0 && (
            <div className="space-y-1">
              <div className="label">Requirements</div>
              {r.requirements.map((q) => <div key={q.id} className="flex items-center gap-2 text-sm"><StatusBadge status={q.status} /><span className="font-mono text-xs">{q.id}</span><span className="num text-slate-700">{q.detail}</span></div>)}
            </div>
          )}
          <ChecksTable checks={r.modules.bms.values.checks} compact />
          <FlagList flags={r.flags} defaultOpen={false} />
          <EstimateNote />
          <div className="flex flex-wrap gap-2">
            {[['Electrical', '/app/electrical'], ['Thermal', '/app/thermal'], ['BMS & safety', '/app/safety'], ['Packaging', '/app/packaging'], ['Compare', '/app/compare']].map(([l, to]) => (
              <Link key={to} to={to} className="btn-secondary">{l} <ArrowRight className="h-3.5 w-3.5" /></Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function Wizard() {
  const [step, setStep] = useState(0)
  const { design } = useActiveDesign()
  const busbarOn = !!getPath(design || {}, 'mechanical.busbar')
  const content = [
    <StepApplication key="a" />,
    <CellPicker key="c" />,
    <TopologyEditor key="t" />,
    <StepFields key="o" groups={[{ title: 'Operating conditions', fields: OPERATING_FIELDS }]} />,
    <StepFields key="th" groups={[{ title: 'Cooling and thermal path', fields: THERMAL_FIELDS, note: 'Thermal values are usually assumptions until measured. Record the justification in "Source / justification".' }]} />,
    <StepFields key="p" groups={[{ title: 'Protection and monitoring (BMS)', fields: LIMIT_FIELDS }]} />,
    <StepFields key="m" groups={[
      { title: 'Mechanical', fields: MECHANICAL_FIELDS },
      { title: 'Busbars', fields: busbarOn ? BUSBAR_FIELDS : [], extra: <BusbarToggle /> },
      { title: 'Cost', fields: COST_FIELDS },
      { title: 'Ageing (simplified assumption)', fields: AGEING_FIELDS },
    ]} />,
    <StepReview key="r" />,
  ]
  return (
    <RequireDesign>
      <PageHeader kicker="Workspace" title="Battery configuration wizard" description="Configure the active design step by step. Every change is saved to the project automatically; empty fields are reported by the backend rather than guessed." />
      <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Wizard steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}
              className={cx('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
                i === step ? 'border-volt-600 bg-volt-600 text-white' : i < step ? 'border-volt-100 bg-volt-50 text-volt-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : <span className="font-mono">{i + 1}</span>}{s}
            </button>
          </li>
        ))}
      </ol>
      <Panel title={`${step + 1}. ${STEPS[step]}`}>
        {content[step]}
        <div className="mt-6 flex justify-between border-t border-slate-100 pt-4">
          <button className="btn-secondary" onClick={() => setStep(step - 1)} disabled={step === 0}><ArrowLeft className="h-4 w-4" />Back</button>
          {step < STEPS.length - 1 && <button className="btn-primary" onClick={() => setStep(step + 1)}>Next<ArrowRight className="h-4 w-4" /></button>}
        </div>
      </Panel>
      <EstimateNote>Every simulation result shown in this workspace comes from the BatteryX backend.</EstimateNote>
    </RequireDesign>
  )
}
