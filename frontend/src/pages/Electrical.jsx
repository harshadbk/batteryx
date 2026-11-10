import { useState } from 'react'

import { TimeSeriesChart } from '../components/charts/Charts'
import RequireDesign from '../components/layout/Gate'
import { Badge, EmptyState, Notice, PageHeader, Panel, Stat, Tabs } from '../components/ui/core'
import { FieldGrid } from '../components/ui/fields'
import { EstimateNote, FlagList, ModelCard, RunBar } from '../components/ui/results'
import { useDesignRun } from '../hooks/useApi'
import { api } from '../lib/api'
import { AGEING_FIELDS, OPERATING_FIELDS, SIM_FIELDS } from '../lib/fields'
import { END_REASON, fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'

function SimSummary({ v, mode, estimate }) {
  if (!v.end_reason) return <Notice tone="red">Simulation not run: see flags below for the missing inputs.</Notice>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="label">End condition</span><Badge tone={v.end_reason === 'max_duration' || v.end_reason === 'power_not_deliverable' ? 'amber' : 'volt'}>{END_REASON[v.end_reason] || v.end_reason}</Badge>
        {v.aged_state && <Badge tone="violet">Aged state (assumption)</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Duration" value={fmt(v.duration_h, 4)} unit="h" sub={`${fmt(v.duration_h * 60, 4)} min`} />
        <Stat label={mode === 'charge' ? 'Energy into pack' : 'Energy delivered'} value={fmt(v.terminal_energy_wh, 4)} unit="Wh" sub="at pack terminals" />
        <Stat label="Efficiency" value={fmt(v.efficiency_pct, 4)} unit="%" tip={mode === 'charge' ? 'Stored (OCV-based) ÷ input energy' : 'Delivered ÷ released (OCV-based) energy'} />
        <Stat label="Losses (I²R + RC)" value={fmt(v.ohmic_and_polarisation_loss_wh, 4)} unit="Wh" />
        <Stat label="Ah throughput" value={fmt(v.ah_throughput_pack, 4)} unit="Ah" />
        <Stat label="SOC" value={`${fmt(v.soc_start_pct, 3)} → ${fmt(v.soc_end_pct, 3)}`} unit="%" />
        <Stat label="Cell voltage range" value={`${fmt(v.cell_voltage_min_v, 4)}–${fmt(v.cell_voltage_max_v, 4)}`} unit="V" />
        <Stat label="Peak pack power" value={fmt(v.pack_power_peak_w, 4)} unit="W" />
        {mode === 'charge' && <Stat label="CC phase" value={fmt(v.cc_duration_h, 4)} unit="h" />}
        {mode === 'charge' && <Stat label="CV phase" value={fmt(v.cv_duration_h, 4)} unit="h" />}
        {v.cell_temp_peak_c != null && <Stat label="Est. peak cell temp" value={fmt(v.cell_temp_peak_c, 4)} unit="°C" sub="lumped thermal (simplified)" />}
        {estimate != null && <Stat label="Closed-form estimate" value={fmt(estimate, 4)} unit="h" sub="ideal coulomb counting" tip="From /estimates: ΔSOC ÷ C-rate (CC only) or Q·w ÷ I" />}
      </div>
    </div>
  )
}

function SimCharts({ v, mode, cell }) {
  const ts = v.timeseries
  if (!ts) return null
  const vRefs = [cell?.max_voltage_v && { y: cell.max_voltage_v, label: `V_max ${cell.max_voltage_v} V` }, cell?.min_voltage_v && { y: cell.min_voltage_v, label: `V_min ${cell.min_voltage_v} V`, color: '#5b6b8c' }].filter(Boolean)
  const syncId = `el-${mode}`
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div><div className="label mb-1">Pack voltage and current <span className="normal-case tracking-normal text-slate-400">(current and power &lt; 0 while charging)</span></div>
        <TimeSeriesChart ts={ts} syncId={syncId} series={[{ key: 'pack_voltage_v', label: 'Pack voltage', unit: 'V', color: '#0e8c99' }, { key: 'pack_current_a', label: 'Pack current', unit: 'A', color: '#7a5bb0', axis: 'right' }]} /></div>
      <div><div className="label mb-1">Cell terminal voltage</div>
        <TimeSeriesChart ts={ts} syncId={syncId} refLines={vRefs} series={[{ key: 'cell_voltage_v', label: 'Cell voltage', unit: 'V', color: '#0b7480' }]} /></div>
      <div><div className="label mb-1">State of charge</div>
        <TimeSeriesChart ts={ts} syncId={syncId} series={[{ key: 'soc_pct', label: 'SOC', unit: '%', color: '#2e7d4f' }]} /></div>
      <div><div className="label mb-1">Power and heat</div>
        <TimeSeriesChart ts={ts} syncId={syncId} series={[{ key: 'pack_power_w', label: 'Pack power', unit: 'W', color: '#334155' }, { key: 'pack_heat_w', label: 'Heat generated', unit: 'W', color: '#c77700', axis: 'right' }]} /></div>
    </div>
  )
}

function AgeingPanel() {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const run = useDesignRun('ageing', (p) => api.module('ageing', p))
  const v = run.data?.values
  return (
    <Panel title="Ageing assumption" subtitle="SIMPLIFIED linear assumption. This is not a degradation model.">
      <FieldGrid fields={AGEING_FIELDS} data={design} onChange={updateActive} cols="sm:grid-cols-2 xl:grid-cols-4" />
      <div className="mt-4"><RunBar label="Evaluate ageing" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error} /></div>
      {v && (
        <div className="mt-4 space-y-3">
          {v.evaluated ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Capacity retention" value={fmt(v.capacity_retention_pct, 4)} unit="%" />
              <Stat label="Resistance factor" value={fmt(v.resistance_factor, 4)} unit="×" />
              <Stat label="Usable energy aged" value={fmt(v.usable_energy_aged_wh, 4)} unit="Wh" sub={`fresh ${fmt(v.usable_energy_fresh_wh, 4)} Wh`} />
              {v.charge_thermal_aged && <Stat label="Est. peak temp aged (charge)" value={fmt(v.charge_thermal_aged.peak_temp_c, 4)} unit="°C" />}
            </div>
          ) : <Notice tone="slate">Ageing not evaluated for this design (see flags).</Notice>}
          <FlagList flags={run.data.flags} defaultOpen={!v.evaluated} />
          <ModelCard model={run.data.model} />
        </div>
      )}
    </Panel>
  )
}

export default function Electrical() {
  const { design, cell } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const [tab, setTab] = useState('charge')
  const run = useDesignRun('electrical', async (p) => {
    const [charge, discharge, estimates] = await Promise.all([api.module('simulate/charge', p), api.module('simulate/discharge', p), api.module('estimates', p)])
    return { charge, discharge, estimates }
  })
  const res = run.data?.[tab]
  const est = run.data?.estimates?.values
  return (
    <RequireDesign>
      <PageHeader kicker="Analysis" title="Electrical simulation"
        description="Time-domain 1-RC equivalent-circuit model with CC-CV charge and constant-current or constant-power discharge, solved by the backend for a representative cell and scaled to the pack." />
      <div className="space-y-5">
        <Panel title="Load case and solver settings">
          <FieldGrid fields={OPERATING_FIELDS} data={design} onChange={updateActive} cols="sm:grid-cols-2 xl:grid-cols-3" />
          <details className="mt-4"><summary className="cursor-pointer text-xs font-medium text-slate-600">Solver settings</summary>
            <div className="mt-3"><FieldGrid fields={SIM_FIELDS} data={design} onChange={updateActive} /></div></details>
          <div className="mt-4"><RunBar label="Run charge & discharge simulation" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error} /></div>
        </Panel>
        {run.data ? (
          <Panel title="Results" actions={<Tabs value={tab} onChange={setTab} tabs={[{ value: 'charge', label: 'Charge (CC-CV)' }, { value: 'discharge', label: 'Discharge' }]} />}>
            <div className="space-y-5">
              <SimSummary v={res.values} mode={tab} estimate={tab === 'charge' ? est?.charge_time_cc_h : est?.discharge_time_h} />
              <SimCharts v={res.values} mode={tab} cell={cell} />
              <EstimateNote />
              <FlagList flags={[...res.flags, ...(run.data.estimates.flags || [])]} />
              <ModelCard model={res.model} />
              <ModelCard model={run.data.estimates.model} />
            </div>
          </Panel>
        ) : <EmptyState title="No simulation results yet">Set the charge and discharge load case above and run the simulation. Charts appear here from the backend response.</EmptyState>}
        <AgeingPanel />
        {cell && !cell.ocv_curve?.length && <Notice>This cell has no OCV–SOC table, so OCV is held at nominal voltage and the CV phase is not modelled. Add the datasheet curve under Cell selection for a realistic voltage trace.</Notice>}
      </div>
    </RequireDesign>
  )
}
