import { TopologySchematic } from '../components/design/DesignComponents'
import RequireDesign from '../components/layout/Gate'
import { InfoTip, LoadingBlock, PageHeader, Panel, Stat } from '../components/ui/core'
import { FieldGrid, Stepper } from '../components/ui/fields'
import { EstimateNote, FlagList, ModelCard, RunBar } from '../components/ui/results'
import { useDesignRun } from '../hooks/useApi'
import { api } from '../lib/api'
import { OPERATING_FIELDS } from '../lib/fields'
import { fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'

/** S×P editor with live backend sizing (configuration + energy endpoints). */
export function TopologyEditor() {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const run = useDesignRun('topology', async (p) => {
    const [configuration, energy] = await Promise.all([api.module('configuration', p), api.module('energy', p)])
    return { configuration, energy }
  }, { auto: true })
  const c = run.data?.configuration?.values
  const e = run.data?.energy?.values
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-6">
          <Stepper label="Cells in series (S)" value={design.series} min={1} max={32} onChange={(v) => updateActive('series', v)} />
          <Stepper label="Cells in parallel (P)" value={design.parallel} min={1} max={16} onChange={(v) => updateActive('parallel', v)} />
          <div className="pb-1 text-sm text-slate-600">= <span className="num font-semibold text-slate-900">{design.series * design.parallel}</span> cells</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3"><TopologySchematic series={design.series} parallel={design.parallel} /></div>
        <p className="text-xs text-slate-500">Schematic of the electrical topology (S groups of P parallel cells, series links in copper). The physical layout is set under Mechanical packaging.</p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Live sizing from the backend</span><InfoTip>Each change calls POST /configuration and /energy. Nothing is computed in the browser.</InfoTip>
          {run.loading && <span className="text-volt-700">updating…</span>}
        </div>
        <RunBar label="Recalculate" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error} />
        {!run.data && run.loading && <LoadingBlock />}
        {c && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Nominal voltage" value={fmt(c.pack_voltage_nominal_v, 4)} unit="V" tip="S × V_cell,nom" />
              <Stat label="Voltage range" value={c.pack_voltage_min_v != null ? `${fmt(c.pack_voltage_min_v, 4)}–${fmt(c.pack_voltage_max_v, 4)}` : '—'} unit="V" sub={c.pack_voltage_max_v == null ? 'cell V limits missing' : null} />
              <Stat label="Capacity" value={fmt(c.pack_capacity_ah, 4)} unit="Ah" tip="P × Q_cell" />
              <Stat label="Nominal energy" value={fmt(e?.nominal_energy_wh, 4)} unit="Wh" tip="V_nom × Q_pack" />
              <Stat label="Usable energy" value={fmt(e?.usable_energy_wh, 4)} unit="Wh" sub={`SOC window ${fmt(e?.usable_soc_window_pct, 3)} %`} />
              <Stat label="Pack resistance (cells)" value={c.pack_resistance_cells_ohm != null ? fmt(c.pack_resistance_cells_ohm * 1000, 4) : '—'} unit="mΩ" tip="S × R0 / P, interconnect excluded" />
              <Stat label="Max charge current" value={fmt(c.max_charge_current_cell_limited_a, 4)} unit="A" sub="cell-limited" />
              <Stat label="Max discharge current" value={fmt(c.max_discharge_current_cell_limited_a, 4)} unit="A" sub="cell-limited" />
              <Stat label="Charge C-rate" value={fmt(e?.charge_c_rate, 3)} unit="C" sub={e?.charge_current_a ? `${fmt(e.charge_current_a)} A` : 'no charge current set'} />
            </div>
            <EstimateNote />
            <FlagList flags={[...(run.data.configuration.flags || []), ...(run.data.energy.flags || [])]} defaultOpen={false} />
            <ModelCard model={run.data.configuration.model} />
            <ModelCard model={run.data.energy.model} />
          </>
        )}
      </div>
    </div>
  )
}

export default function Topology() {
  const { design } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  return (
    <RequireDesign>
      <PageHeader kicker="Design" title="Series-parallel configuration" description="Set how many cells are connected in series (voltage) and in parallel (capacity, current sharing)." />
      <div className="space-y-5">
        <Panel><TopologyEditor /></Panel>
        <Panel title="Usable window" subtitle="Defines usable energy">
          <FieldGrid fields={OPERATING_FIELDS.filter((f) => ['operating.soc_min_pct', 'operating.soc_max_pct'].includes(f.path))} data={design} onChange={updateActive} />
        </Panel>
      </div>
    </RequireDesign>
  )
}
