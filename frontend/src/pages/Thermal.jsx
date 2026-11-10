import { useState } from 'react'

import { SweepChart, TimeSeriesChart } from '../components/charts/Charts'
import RequireDesign from '../components/layout/Gate'
import { Badge, EmptyState, ErrorBox, Notice, PageHeader, Panel, Spinner, Stat, Tabs } from '../components/ui/core'
import { FieldGrid } from '../components/ui/fields'
import { EstimateNote, FlagList, ModelCard, RunBar } from '../components/ui/results'
import { useDesignRun } from '../hooks/useApi'
import { api } from '../lib/api'
import { payloadFor, setPath } from '../lib/design'
import { OPERATING_FIELDS, THERMAL_FIELDS } from '../lib/fields'
import { fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'

function ScenarioCard({ s, title }) {
  if (!s) return null
  const reach = s.reaches_limit_within_duration
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">{title}</span>
        {s.limit_c != null && <Badge tone={reach ? 'red' : 'green'}>{reach ? 'reaches limit' : 'stays below limit'}</Badge>}</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Heat per cell" value={fmt(s.heat_per_cell_w, 4)} unit="W" tip="I_cell² × R0" />
        <Stat label="Peak temperature" value={fmt(s.peak_temp_c, 4)} unit="°C" sub={`after ${fmt(s.duration_h, 4)} h`} />
        <Stat label="Steady-state rise" value={fmt(s.steady_state_rise_k, 4)} unit="K" tip="q × R_th" />
        <Stat label="Time to limit" value={s.limit_c == null ? '—' : s.time_to_limit_min == null ? 'never' : fmt(s.time_to_limit_min, 4)} unit={s.time_to_limit_min != null ? 'min' : ''} sub={s.limit_c != null ? `limit ${s.limit_c} °C` : 'no limit set'} />
      </div>
    </div>
  )
}

function CurrentSweep() {
  const { project, design } = useActiveDesign()
  const [state, setState] = useState({ busy: false, error: null, points: null, limit: null })
  const base = design.operating?.charge_current_a
  const run = async () => {
    setState({ busy: true, error: null, points: null })
    try {
      const factors = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
      const results = await Promise.all(factors.map((k) => api.module('thermal', payloadFor(setPath(design, 'operating.charge_current_a', +(base * k).toFixed(4)), project))))
      const points = results.map((r, i) => ({ x: base * factors[i], y: r.values.charge?.peak_temp_c })).filter((p) => p.y != null)
      setState({ busy: false, error: null, points, limit: results[0].values.charge?.limit_c })
    } catch (e) { setState({ busy: false, error: e, points: null }) }
  }
  return (
    <Panel title="Peak temperature vs charge current" subtitle="Backend sweep: /thermal is called once per current, from 0.25× to 2× the design charge current.">
      {!base ? <Notice tone="slate">Set a pack charge current to run the sweep.</Notice> : (
        <div className="space-y-3">
          <button className="btn-secondary" onClick={run} disabled={state.busy}>{state.busy && <Spinner />}Run sweep (8 backend calls)</button>
          <ErrorBox error={state.error} />
          {state.points?.length ? <SweepChart points={state.points} xLabel="pack charge current [A]" yLabel="peak cell temp [°C]" refY={state.limit} refLabel={state.limit != null ? `limit ${state.limit} °C` : ''} />
            : state.points && <Notice tone="slate">The backend returned no temperatures (thermal inputs missing).</Notice>}
          {state.points?.length > 0 && <p className="text-xs text-slate-500">Heat scales with current squared, but higher current also shortens the charge, so the peak temperature trend reflects both effects.</p>}
        </div>
      )}
    </Panel>
  )
}

export default function Thermal() {
  const { design, cell } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const [tab, setTab] = useState('charge')
  const run = useDesignRun('thermal', async (p) => {
    const [thermal, charge, discharge] = await Promise.all([api.module('thermal', p), api.module('simulate/charge', p), api.module('simulate/discharge', p)])
    return { thermal, charge, discharge }
  })
  const t = run.data?.thermal?.values
  const sim = run.data?.[tab]?.values
  const lim = tab === 'charge' ? design?.limits?.max_cell_temp_charge_c ?? cell?.charge_temp_max_c : design?.limits?.max_cell_temp_discharge_c ?? cell?.discharge_temp_max_c
  const margin = design?.limits?.temp_warning_margin_k
  return (
    <RequireDesign>
      <PageHeader kicker="Analysis" title="Thermal analysis"
        description="Lumped single-node thermal model per cell, coupled to the electrical simulation. A screening estimate: no cell-to-cell conduction, internal gradients or entropic heat." />
      <Notice className="mb-5"><b>Simplified thermal model.</b> All cells are assumed identical, so hot centre cells and temperature spread are not captured. Use these values to compare options, not as design temperatures.</Notice>
      <div className="space-y-5">
        <Panel title="Cooling and thermal inputs">
          <FieldGrid fields={[OPERATING_FIELDS[0], ...THERMAL_FIELDS]} data={design} onChange={updateActive} />
          <div className="mt-4"><RunBar label="Run thermal analysis" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error} /></div>
        </Panel>
        {run.data ? (
          <>
            <Panel title="Thermal path">
              {t.thermal_resistance_k_per_w != null ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Stat label="R_th cell → ambient" value={fmt(t.thermal_resistance_k_per_w, 4)} unit="K/W" />
                  <Stat label="Thermal mass / cell" value={fmt(t.thermal_mass_per_cell_kg, 4)} unit="kg" />
                  <Stat label="Specific heat" value={fmt(t.specific_heat_j_per_kgk, 4)} unit="J/kg·K" />
                  <Stat label="Time constant τ" value={fmt(t.time_constant_min, 4)} unit="min" tip="m · c_p · R_th" />
                  <Stat label="Ambient" value={fmt(t.ambient_c, 4)} unit="°C" />
                </div>
              ) : <Notice tone="red">Thermal estimate not available: required inputs are missing (see flags).</Notice>}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ScenarioCard s={t.charge} title="Charge (CC phase, closed form)" />
                <ScenarioCard s={t.discharge} title="Discharge (closed form)" />
              </div>
            </Panel>
            <Panel title="Temperature transient (coupled simulation)" actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'charge', label: 'Charge' }, { value: 'discharge', label: 'Discharge' }]} />}>
              {sim?.timeseries?.cell_temp_c ? (
                <TimeSeriesChart ts={sim.timeseries} height={260}
                  refLines={[lim != null && { y: lim, label: `limit ${lim} °C` }, lim != null && margin != null && { y: lim - margin, label: `warning ${lim - margin} °C`, color: '#c77700' }].filter(Boolean)}
                  series={[{ key: 'cell_temp_c', label: 'Cell temperature', unit: '°C', color: '#c77700' }, { key: 'pack_heat_w', label: 'Pack heat', unit: 'W', color: '#94a3b8', axis: 'right' }]} />
              ) : <Notice tone="slate">No temperature trace: the simulation ran without complete thermal inputs or could not run (see flags).</Notice>}
              <div className="mt-3"><EstimateNote /></div>
            </Panel>
            <FlagList flags={[...run.data.thermal.flags, ...run.data[tab].flags]} />
            <ModelCard model={run.data.thermal.model} />
          </>
        ) : <EmptyState title="No thermal results yet">Enter the thermal path (R_th or h), specific heat and ambient temperature, then run the analysis.</EmptyState>}
        <CurrentSweep />
      </div>
    </RequireDesign>
  )
}
