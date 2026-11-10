import { lazy, Suspense, useState } from 'react'

import { HBarChart } from '../components/charts/Charts'
import RequireDesign from '../components/layout/Gate'
import { Badge, EmptyState, KV, LoadingBlock, Notice, PageHeader, Panel, Stat, Tabs } from '../components/ui/core'
import { FieldGrid } from '../components/ui/fields'
import { EstimateNote, FlagList, ModelCard, RunBar } from '../components/ui/results'
import { useDesignRun } from '../hooks/useApi'
import { api } from '../lib/api'
import { getPath } from '../lib/design'
import { BUSBAR_FIELDS, COST_FIELDS, MECHANICAL_FIELDS } from '../lib/fields'
import { fmt } from '../lib/format'
import { useActiveDesign, useProject } from '../store/project'

const PackView3D = lazy(() => import('../components/three/PackView3D'))

const MASS_LABELS = { cells_kg: 'Cells', cooling_kg: 'Cooling', interconnect_fixings_kg: 'Fixings / interconnect', busbars_kg: 'Busbars', housing_kg: 'Housing', bms_kg: 'BMS' }

export default function Packaging() {
  const { design, cell } = useActiveDesign()
  const updateActive = useProject((s) => s.updateActive)
  const [colorMode, setColorMode] = useState('group')
  const run = useDesignRun('packaging', async (p) => {
    const [mechanical, cost, thermal] = await Promise.all([api.module('mechanical', p), api.module('cost', p), api.module('thermal', p)])
    return { mechanical, cost, thermal }
  })
  const m = run.data?.mechanical?.values
  const c = run.data?.cost?.values
  const th = run.data?.thermal?.values
  const busbarOn = !!getPath(design, 'mechanical.busbar')
  const peak = th?.charge?.peak_temp_c
  const envelope = m?.envelope_length_mm != null ? `${fmt(m.envelope_length_mm, 4)} × ${fmt(m.envelope_width_mm, 4)} × ${fmt(m.envelope_height_mm, 4)} mm` : null
  return (
    <RequireDesign>
      <PageHeader kicker="Analysis" title="Mechanical packaging" description="Module envelope, mass roll-up, busbar sizing and cost, with a 3D view generated from the backend layout and the cell's datasheet geometry." />
      <div className="space-y-5">
        <Panel title="Layout, mass and cost inputs">
          <div className="space-y-5">
            <FieldGrid fields={MECHANICAL_FIELDS} data={design} onChange={updateActive} />
            <div>
              <label className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={busbarOn} onChange={(e) => updateActive('mechanical.busbar', e.target.checked ? { material: 'copper', current_density_a_per_mm2: null, thickness_mm: null } : null)} />
                Size series busbars
              </label>
              {busbarOn && <FieldGrid fields={BUSBAR_FIELDS} data={design} onChange={updateActive} />}
            </div>
            <div><div className="label mb-2">Cost</div><FieldGrid fields={COST_FIELDS} data={design} onChange={updateActive} /></div>
          </div>
          <div className="mt-4"><RunBar label="Run packaging analysis" onRun={run.run} loading={run.loading} at={run.at} stale={run.stale} ready={run.ready} error={run.error} /></div>
        </Panel>
        {m ? (
          <>
            <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
              <Panel title="3D module view" bodyClass="p-0"
                actions={<Tabs value={colorMode} onChange={setColorMode} tabs={[{ value: 'group', label: 'Series groups' }, { value: 'temp', label: 'Est. temperature' }]} />}>
                <div className="h-[420px] overflow-hidden rounded-b-lg">
                  <Suspense fallback={<LoadingBlock label="Loading 3D view…" />}>
                    <PackView3D rows={m.grid_rows} cols={m.grid_cols} cellCount={m.cell_count} cell={cell}
                      gapMm={design.mechanical?.cell_gap_mm} wallMm={design.mechanical?.wall_thickness_mm}
                      colorMode={colorMode} temp={peak} tempRange={[th?.ambient_c ?? 0, th?.charge?.limit_c ?? (peak ?? 0) + 5]} showBusbars={!!m.busbar} envelope={envelope} />
                  </Suspense>
                </div>
                <div className="space-y-1 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                  <div>Drag to orbit · scroll to zoom. {m.grid_rows} rows × {m.grid_cols} columns from the backend layout.</div>
                  {m.volume_basis !== 'envelope_from_dimensions' && <div className="text-amber-700">Cell dimensions missing: cells are drawn with schematic proportions, not to scale.</div>}
                  {colorMode === 'temp' && <div>{peak != null ? `All cells shown at the lumped estimate ${fmt(peak, 4)} °C (charge). The simplified model has no cell-to-cell spread.` : 'No temperature estimate available (thermal inputs missing).'}</div>}
                </div>
              </Panel>
              <div className="space-y-5">
                <Panel title="Envelope">
                  {m.envelope_length_mm != null ? (
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Length" value={fmt(m.envelope_length_mm, 4)} unit="mm" /><Stat label="Width" value={fmt(m.envelope_width_mm, 4)} unit="mm" /><Stat label="Height" value={fmt(m.envelope_height_mm, 4)} unit="mm" />
                      <Stat label="Volume" value={fmt(m.envelope_volume_l, 4)} unit="L" /><Stat label="Packing efficiency" value={fmt(m.packing_efficiency_pct, 3)} unit="%" />
                    </div>
                  ) : m.module_volume_l != null ? (
                    <div className="space-y-2"><Stat label="Module volume (fallback)" value={fmt(m.module_volume_l, 4)} unit="L" sub="cell volume × packing factor" /><Badge tone="amber">L × W × H unsupported: cell dimensions missing</Badge></div>
                  ) : <p className="text-sm text-slate-500">Volume not computable (see flags).</p>}
                </Panel>
                <Panel title="Mass">
                  {m.module_mass_kg != null ? (
                    <>
                      <Stat label="Module mass" value={fmt(m.module_mass_kg, 4)} unit="kg" sub={m.mass_excludes?.length ? `excludes: ${m.mass_excludes.map((k) => MASS_LABELS[k] || k).join(', ')}` : 'all components included'} />
                      <HBarChart unit="kg" rows={Object.entries(m.mass_breakdown_kg).map(([k, v]) => ({ name: MASS_LABELS[k] || k, value: v }))} />
                    </>
                  ) : <p className="text-sm text-slate-500">Mass not computable: cell mass missing.</p>}
                </Panel>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <Panel title="Busbars (series links)">
                {m.busbar ? <KV rows={[['Material', m.busbar.material], ['Design current', fmt(m.busbar.design_current_a, 4), 'A'], ['Cross-section', fmt(m.busbar.cross_section_mm2, 4), 'mm²'],
                  ['Width at thickness', fmt(m.busbar.width_mm, 4), 'mm'], ['Links × length', `${m.busbar.series_links} × ${fmt(m.busbar.link_length_mm, 4)}`, 'mm'],
                  ['Total resistance', fmt(m.busbar.resistance_total_ohm * 1000, 4), 'mΩ'], ['Mass', fmt(m.busbar.mass_kg * 1000, 4), 'g'], ['Loss at design current', fmt(m.busbar.loss_at_design_current_w, 4), 'W']]} />
                  : <p className="text-sm text-slate-500">{busbarOn ? 'Busbar not sized (see flags).' : 'Enable "Size series busbars" to estimate cross-section, resistance and mass.'}</p>}
              </Panel>
              <Panel title="Cost">
                <div className="space-y-3">
                  {c?.estimated_cost != null ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Estimated cost" value={fmt(c.estimated_cost, 5)} unit={c.currency} sub={c.cost_excludes?.length ? `excludes: ${c.cost_excludes.join(', ')}` : 'complete BOM'} />
                      <Stat label="Cost per kWh (nominal)" value={fmt(c.cost_per_kwh_nominal, 5)} unit={`${c.currency}/kWh`} />
                    </div>
                  ) : <Notice tone="slate">No currency estimate: no cell price available. Prices are user inputs; none are built in.</Notice>}
                  <Stat label="Relative cost index" value={fmt(c?.relative_cost_index, 4)} unit="index" sub={c?.relative_cost_index_note} />
                </div>
              </Panel>
            </div>
            <EstimateNote />
            <FlagList flags={[...run.data.mechanical.flags, ...run.data.cost.flags]} />
            <ModelCard model={run.data.mechanical.model} />
            <ModelCard model={run.data.cost.model} />
          </>
        ) : <EmptyState title="No packaging results yet">Run the analysis to compute the envelope, mass breakdown and the 3D layout from the backend.</EmptyState>}
      </div>
    </RequireDesign>
  )
}
