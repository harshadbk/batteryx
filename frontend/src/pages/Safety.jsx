import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { PercentileBand } from '../components/charts/Charts'
import RequireDesign from '../components/layout/Gate'
import { EmptyState, ErrorBox, InfoTip, KV, Notice, PageHeader, Panel, Spinner, Stat, StatusBadge } from '../components/ui/core'
import { FieldGrid, NumberInput } from '../components/ui/fields'
import { ChecksTable, EstimateNote, FlagList, ModelCard, RunBar } from '../components/ui/results'
import { useDesignRun } from '../hooks/useApi'
import { api } from '../lib/api'
import { payloadFor } from '../lib/design'
import { LIMIT_FIELDS } from '../lib/fields'
import { fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'

const SUBSYSTEMS = ['electrical', 'thermal', 'protection', 'sensing', 'control']

function VariationPanel() {
  const { project, design } = useActiveDesign()
  const [v, setV] = useState({ samples: 400, capacity_tolerance_pct: null, resistance_tolerance_pct: null, tolerance_is_3_sigma: true, seed: 7 })
  const [state, setState] = useState({ busy: false, error: null, data: null })
  const run = async () => {
    setState({ busy: true, error: null, data: null })
    try { setState({ busy: false, error: null, data: await api.variation(payloadFor(design, project), v) }) } catch (e) { setState({ busy: false, error: e, data: null }) }
  }
  const d = state.data?.values
  const field = (k, label, unit, tip, extra = {}) => (
    <div><label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">{label} <span className="unit">[{unit}]</span><InfoTip>{tip}</InfoTip></label>
      <NumberInput value={v[k]} onChange={(x) => setV({ ...v, [k]: x })} {...extra} /></div>
  )
  return (
    <Panel title="Cell-to-cell variation (Monte-Carlo)" subtitle="How manufacturing tolerance propagates to current sharing, worst-cell temperature and usable energy. Seeded and repeatable.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field('capacity_tolerance_pct', 'Capacity tolerance ±', '%', 'From the datasheet or supplier; there is no default.', { step: 0.5 })}
        {field('resistance_tolerance_pct', 'Resistance tolerance ±', '%', 'From the datasheet or supplier; there is no default.', { step: 1 })}
        {field('samples', 'Virtual builds', 'n', '10 – 20 000', { integer: true, step: 100 })}
        {field('seed', 'Random seed', '', 'Same seed → same result', { integer: true })}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={v.tolerance_is_3_sigma} onChange={(e) => setV({ ...v, tolerance_is_3_sigma: e.target.checked })} />Tolerance is ±3σ (otherwise ±1σ)</label>
      <button className="btn-secondary mt-3" onClick={run} disabled={state.busy || v.capacity_tolerance_pct == null || v.resistance_tolerance_pct == null}>{state.busy && <Spinner />}Run Monte-Carlo</button>
      <ErrorBox error={state.error} className="mt-3" />
      {d && (
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <PercentileBand label="Usable energy (weakest series group)" unit="Wh" s={d.usable_energy_wh} />
          <PercentileBand label="Highest parallel-cell current share" unit="%" s={d.max_cell_current_share_pct} />
          <PercentileBand label="Worst-cell temperature (charge)" unit="°C" s={d.worst_cell_temp_charge_c} />
          <PercentileBand label="Cell temperature spread" unit="K" s={d.cell_temp_spread_k} />
          <div className="md:col-span-2 space-y-2"><FlagList flags={state.data.flags} defaultOpen={false} /><ModelCard model={state.data.model} /></div>
        </div>
      )}
    </Panel>
  )
}

export default function Safety() {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const run = useDesignRun('bms', (p) => api.module('bms', p))
  const v = run.data?.values
  return (
    <RequireDesign>
      <PageHeader kicker="Analysis" title="BMS and safety monitoring"
        description="Deterministic rule checks against datasheet and engineer-set limits: electrical, thermal, protection coordination, sensing and the charge-current control limit." />
      <Notice icon={ShieldAlert} tone="amber" className="mb-5"><b>Design screening, not certification.</b> A check that is NOT EVALUATED is not a pass. Fuse time-current curves and BMS response times are not modelled.</Notice>
      <div className="space-y-5">
        <Panel title="Protection and monitoring limits">
          <FieldGrid fields={LIMIT_FIELDS} data={design} onChange={updateActive} />
          <div className="mt-4"><RunBar label="Run safety checks" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error} /></div>
        </Panel>
        {v ? (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {['FAIL', 'WARN', 'PASS', 'NOT_EVALUATED'].map((k) => (
                <Stat key={k} label={k.replace('_', ' ')} value={v.summary[k] ?? 0} unit="checks" tone={k === 'FAIL' && v.summary[k] ? 'red' : k === 'WARN' && v.summary[k] ? 'amber' : k === 'PASS' ? 'green' : undefined} />
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <Panel title="Rule checks" subtitle="Grouped by subsystem">
                <div className="space-y-5">
                  {SUBSYSTEMS.map((sub) => {
                    const cs = v.checks.filter((c) => c.subsystem === sub)
                    return cs.length ? <div key={sub}><div className="label mb-1 capitalize">{sub}</div><ChecksTable checks={cs} /></div> : null
                  })}
                </div>
              </Panel>
              <div className="space-y-5">
                <Panel title="Charge-current limit (CT-01)">
                  {v.max_safe_charge_current_a != null ? (
                    <div className="space-y-2">
                      <Stat label="Max safe charge current" value={fmt(v.max_safe_charge_current_a, 4)} unit="A" sub={`Design: ${fmt(design.operating?.charge_current_a)} A`} />
                      <div className="text-xs text-slate-600">Binding constraint: <b>{v.max_safe_charge_binding_constraints?.join(', ')}</b></div>
                      <StatusBadge status={v.checks.find((c) => c.id === 'CT-01')?.status} />
                    </div>
                  ) : <p className="text-sm text-slate-500">Not evaluated: needs cell C-rate, fuse/BMS limits or thermal inputs.</p>}
                </Panel>
                <Panel title="Passive balancing">
                  {v.balancing ? <KV rows={[['Time to balance', fmt(v.balancing.time_to_balance_h, 4), 'h'], ['Bleed heat per group', fmt(v.balancing.bleed_heat_per_group_w, 4), 'W']]} />
                    : <p className="text-sm text-slate-500">Set balancing current and SOC imbalance to estimate.</p>}
                  {v.balancing && <p className="mt-2 font-mono text-[11px] text-slate-500">{v.balancing.equation}</p>}
                </Panel>
              </div>
            </div>
            <p className="text-xs text-slate-600">{v.safety_disclaimer}</p>
            <EstimateNote />
            <FlagList flags={run.data.flags} />
            <ModelCard model={run.data.model} />
          </>
        ) : <EmptyState title="No safety check results yet">Set the protection limits and run the checks. Statuses and warnings come from the backend rule engine.</EmptyState>}
        <VariationPanel />
      </div>
    </RequireDesign>
  )
}
