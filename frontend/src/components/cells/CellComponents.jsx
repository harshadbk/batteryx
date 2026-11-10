import { CheckCircle2, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { api } from '../../lib/api'
import { fmt } from '../../lib/format'
import { useProject } from '../../store/project'
import { Badge, cx, DataStatusBadge, ErrorBox, InfoTip, Notice, Spinner } from '../ui/core'
import { NumberInput } from '../ui/fields'

// Cell fields shown in detail views, with what each one unlocks when present.
export const CELL_FIELDS = [
  ['nominal_voltage_v', 'Nominal voltage', 'V', 'Pack voltage, energy'],
  ['capacity_ah', 'Capacity', 'Ah', 'Capacity, energy, C-rate'],
  ['max_voltage_v', 'Max (charge) voltage', 'V', 'CV phase, VL-01 check, pack max voltage'],
  ['min_voltage_v', 'Min (cut-off) voltage', 'V', 'Discharge cut-off, VL-02 check'],
  ['internal_resistance_mohm', 'Internal resistance R0', 'mΩ', 'Heat, voltage drop, simulation'],
  ['resistance_type', 'Resistance method', '', 'AC vs DC accuracy flag'],
  ['rc_r1_mohm', 'RC branch R1', 'mΩ', 'Polarisation dynamics'],
  ['rc_c1_f', 'RC branch C1', 'F', 'Polarisation dynamics'],
  ['max_charge_c_rate', 'Max charge rate', 'C', 'EL-01, max safe charge current'],
  ['max_discharge_c_rate', 'Max discharge rate', 'C', 'EL-02, PR-05, max power'],
  ['charge_temp_min_c', 'Charge temp min', '°C', 'TH-03'],
  ['charge_temp_max_c', 'Charge temp max', '°C', 'TH-01 limit fallback, TH-03'],
  ['discharge_temp_min_c', 'Discharge temp min', '°C', ''],
  ['discharge_temp_max_c', 'Discharge temp max', '°C', 'TH-02 limit fallback'],
  ['mass_kg', 'Mass', 'kg', 'Module mass, thermal mass'],
  ['volume_l', 'Volume', 'L', 'Volume fallback, packing efficiency'],
  ['specific_heat_j_per_kgk', 'Specific heat', 'J/kg·K', 'Thermal transient'],
  ['cycle_life_cycles', 'Cycle life', 'cycles', 'Linear ageing assumption'],
  ['cycle_life_eol_capacity_pct', 'Cycle life EOL capacity', '%', 'Linear ageing assumption'],
  ['unit_cost', 'Unit cost', '', 'Currency cost estimate'],
]

export function cellCompleteness(cell) {
  const keys = CELL_FIELDS.map((f) => f[0])
  let n = keys.filter((k) => cell[k] !== null && cell[k] !== undefined).length
  const hasDims = !!cell.dimensions && Object.values(cell.dimensions).some((v) => v)
  const hasOcv = !!cell.ocv_curve?.length
  n += (hasDims ? 1 : 0) + (hasOcv ? 1 : 0)
  return { filled: n, total: keys.length + 2, hasDims, hasOcv }
}

export function CellList({ cells, selectedId, onSelect, activeCellId }) {
  const [q, setQ] = useState('')
  const [chem, setChem] = useState('')
  const chems = [...new Set(cells.map((c) => c.chemistry))]
  const shown = useMemo(() => cells.filter((c) => (!chem || c.chemistry === chem) &&
    (!q || `${c.id} ${c.manufacturer || ''} ${c.model || ''}`.toLowerCase().includes(q.toLowerCase()))), [cells, q, chem])
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400" />
          <input className="input pl-8" placeholder="Search id, manufacturer, model" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cells" />
        </div>
        <select className="input !w-28" value={chem} onChange={(e) => setChem(e.target.value)} aria-label="Chemistry filter">
          <option value="">All</option>{chems.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {shown.map((c) => {
          const comp = cellCompleteness(c)
          return (
            <li key={c.id}>
              <button onClick={() => onSelect(c.id)} className={cx('flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50', selectedId === c.id && 'bg-volt-50')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm font-medium text-slate-900">{c.id}</span>
                    {activeCellId === c.id && <Badge tone="volt"><CheckCircle2 className="h-3 w-3" />in active design</Badge>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{[c.manufacturer, c.model].filter(Boolean).join(' · ') || 'No manufacturer/model'}</div>
                  <div className="num mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
                    <span>{c.chemistry}</span><span>{fmt(c.nominal_voltage_v)} V</span><span>{fmt(c.capacity_ah)} Ah</span>
                    <span>{c.form_factor || 'form factor —'}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <DataStatusBadge status={c.data_status} />
                  <span className="text-[10px] text-slate-500">{comp.filled}/{comp.total} fields</span>
                </div>
              </button>
            </li>
          )
        })}
        {!shown.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No cells match the filter.</li>}
      </ul>
    </div>
  )
}

export function CellDetail({ cell, onUse, isActive, onDelete }) {
  const comp = cellCompleteness(cell)
  const missing = CELL_FIELDS.filter(([k]) => cell[k] === null || cell[k] === undefined)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-base font-semibold text-slate-900">{cell.id}</div>
          <div className="text-sm text-slate-600">{[cell.manufacturer, cell.model].filter(Boolean).join(' · ') || '—'}</div>
          <div className="mt-1 flex flex-wrap gap-1.5"><DataStatusBadge status={cell.data_status} /><Badge>{cell.chemistry}</Badge>{cell.form_factor && <Badge>{cell.form_factor}</Badge>}<Badge tone="slate">{cell.origin}</Badge></div>
        </div>
        <div className="flex gap-2">
          {onUse && <button className="btn-primary" onClick={onUse} disabled={isActive}>{isActive ? 'Used in active design' : 'Use in active design'}</button>}
          {onDelete && cell.origin === 'user' && <button className="btn-danger" onClick={onDelete}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs"><span className="label">Data completeness</span><span className="num text-slate-600">{comp.filled} / {comp.total}</span></div>
        <div className="h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-volt-500" style={{ width: `${(comp.filled / comp.total) * 100}%` }} /></div>
      </div>
      {cell.datasheet_ref ? <div className="text-xs text-slate-600"><span className="label">Datasheet</span> <span className="ml-1">{cell.datasheet_ref}</span></div>
        : <Notice tone="slate">No datasheet reference recorded for this cell.</Notice>}
      {cell.notes && <p className="text-xs text-slate-600">{cell.notes}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left label"><th className="py-1.5 pr-3">Parameter</th><th className="py-1.5 pr-3 text-right">Value</th><th className="py-1.5">Needed for</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {CELL_FIELDS.map(([k, label, unit, use]) => {
              const v = cell[k]
              const miss = v === null || v === undefined
              return (
                <tr key={k}>
                  <td className="py-1.5 pr-3 text-slate-700">{label}</td>
                  <td className={cx('num py-1.5 pr-3 text-right', miss ? 'text-amber-700' : 'font-medium text-slate-900')}>
                    {miss ? 'not provided' : <>{typeof v === 'number' ? fmt(v, 5) : v}<span className="unit ml-1">{k === 'unit_cost' ? cell.currency : unit}</span></>}
                  </td>
                  <td className="py-1.5 text-xs text-slate-500">{use}</td>
                </tr>
              )
            })}
            <tr><td className="py-1.5 pr-3 text-slate-700">Dimensions</td><td className={cx('num py-1.5 pr-3 text-right', comp.hasDims ? 'text-slate-900' : 'text-amber-700')}>
              {comp.hasDims ? Object.entries(cell.dimensions).filter(([, v]) => v).map(([k, v]) => `${k.replace('_mm', '')} ${v}`).join(' × ') + ' mm' : 'not provided'}</td>
              <td className="py-1.5 text-xs text-slate-500">Envelope L×W×H, busbar length, R_th from h, 3D view</td></tr>
            <tr><td className="py-1.5 pr-3 text-slate-700">OCV–SOC curve</td><td className={cx('num py-1.5 pr-3 text-right', comp.hasOcv ? 'text-slate-900' : 'text-amber-700')}>{comp.hasOcv ? `${cell.ocv_curve.length} points` : 'not provided'}</td>
              <td className="py-1.5 text-xs text-slate-500">Realistic voltage, CV phase, voltage cut-offs</td></tr>
          </tbody>
        </table>
      </div>
      {missing.length > 0 && <p className="text-xs text-slate-500">Missing values are never filled in by the platform. Calculations that need them are reported as <em>missing input</em> or <em>unsupported</em>.</p>}
    </div>
  )
}

const EMPTY_FORM = { id: '', manufacturer: '', model: '', chemistry: 'LFP', form_factor: 'prismatic', data_status: 'datasheet', datasheet_ref: '', dimensions: {}, ocv_curve: [] }

export function CellForm({ onCreated, onCancel }) {
  const [c, setC] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const loadCells = useProject((s) => s.loadCells)
  const set = (k, v) => setC((x) => ({ ...x, [k]: v }))
  const num = (k, label, unit, tip) => (
    <div key={k}>
      <label className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-700">{label} {unit && <span className="unit">[{unit}]</span>}<InfoTip>{tip}</InfoTip></label>
      <NumberInput value={c[k] ?? null} onChange={(v) => set(k, v)} step="any" integer={k === 'cycle_life_cycles'} />
    </div>
  )
  const submit = async () => {
    setBusy(true); setError(null)
    const body = { ...c }
    for (const k of Object.keys(body)) if (body[k] === '' || body[k] === null) delete body[k]
    const dims = Object.fromEntries(Object.entries(c.dimensions).filter(([, v]) => v))
    if (Object.keys(dims).length) body.dimensions = dims; else delete body.dimensions
    const ocv = c.ocv_curve.filter((p) => p.soc !== null && p.ocv_v !== null)
    if (ocv.length) body.ocv_curve = ocv.map((p) => ({ soc: p.soc / 100, ocv_v: p.ocv_v })); else delete body.ocv_curve
    try {
      const created = await api.cells.create(body)
      await loadCells()
      onCreated?.(created)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <Notice tone="volt">Enter values exactly as stated on the datasheet. Leave a field empty if the datasheet does not give it. Do not estimate.</Notice>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Cell id *</label><input className="input font-mono" value={c.id} onChange={(e) => set('id', e.target.value)} placeholder="MFR-MODEL" /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Manufacturer</label><input className="input" value={c.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Model</label><input className="input" value={c.model} onChange={(e) => set('model', e.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Chemistry *</label>
          <select className="input" value={c.chemistry} onChange={(e) => set('chemistry', e.target.value)}>{['LFP', 'NMC', 'NCA', 'LTO', 'LMO', 'other'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Form factor</label>
          <select className="input" value={c.form_factor} onChange={(e) => set('form_factor', e.target.value)}>{['prismatic', 'cylindrical', 'pouch'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Data status *</label>
          <select className="input" value={c.data_status} onChange={(e) => set('data_status', e.target.value)}>
            <option value="datasheet">Datasheet (reference required)</option><option value="user_entered">User-entered (unverified)</option></select></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className="mb-1 block text-xs font-medium text-slate-700">Datasheet reference {c.data_status === 'datasheet' && '*'}</label>
          <input className="input" value={c.datasheet_ref} onChange={(e) => set('datasheet_ref', e.target.value)} placeholder="Document title, revision, date, URL" /></div>
      </div>
      <div className="label">Electrical</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {num('nominal_voltage_v', 'Nominal voltage *', 'V')}{num('capacity_ah', 'Capacity *', 'Ah')}{num('max_voltage_v', 'Max voltage', 'V', 'Charge cut-off voltage')}{num('min_voltage_v', 'Min voltage', 'V', 'Discharge cut-off voltage')}
        {num('internal_resistance_mohm', 'Internal resistance', 'mΩ')}
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Resistance method</label><input className="input" value={c.resistance_type || ''} onChange={(e) => set('resistance_type', e.target.value)} placeholder="ACIR 1 kHz / DCIR 10 s" /></div>
        {num('rc_r1_mohm', 'RC R1', 'mΩ', 'Give R1 and C1 together, only if characterised')}{num('rc_c1_f', 'RC C1', 'F')}
        {num('max_charge_c_rate', 'Max charge rate', 'C')}{num('max_discharge_c_rate', 'Max discharge rate', 'C')}
      </div>
      <div className="label">Thermal & physical</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {num('charge_temp_min_c', 'Charge temp min', '°C')}{num('charge_temp_max_c', 'Charge temp max', '°C')}{num('discharge_temp_min_c', 'Discharge temp min', '°C')}{num('discharge_temp_max_c', 'Discharge temp max', '°C')}
        {num('mass_kg', 'Mass', 'kg')}{num('volume_l', 'Volume', 'L')}{num('specific_heat_j_per_kgk', 'Specific heat', 'J/kg·K')}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(c.form_factor === 'cylindrical' ? [['diameter_mm', 'Diameter'], ['height_mm', 'Height']] : [['length_mm', 'Length'], ['width_mm', 'Width (thickness)'], ['height_mm', 'Height']]).map(([k, l]) => (
          <div key={k}><label className="mb-1 block text-xs font-medium text-slate-700">{l} <span className="unit">[mm]</span></label>
            <NumberInput value={c.dimensions[k] ?? null} onChange={(v) => set('dimensions', { ...c.dimensions, [k]: v })} step="any" /></div>
        ))}
      </div>
      <div className="label">Life & cost</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {num('cycle_life_cycles', 'Cycle life', 'cycles')}{num('cycle_life_eol_capacity_pct', 'EOL capacity', '%')}
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Cycle-life conditions</label><input className="input" value={c.cycle_life_conditions || ''} onChange={(e) => set('cycle_life_conditions', e.target.value)} placeholder="e.g. 25 °C, 0.5C/0.5C, 100 % DoD" /></div>
        {num('unit_cost', 'Unit cost', '')}
        <div><label className="mb-1 block text-xs font-medium text-slate-700">Currency</label><input className="input" value={c.currency || ''} onChange={(e) => set('currency', e.target.value)} placeholder="INR" /></div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2"><span className="label">OCV–SOC table</span><InfoTip>From the datasheet curve. SOC in %, OCV in V; SOC strictly increasing.</InfoTip>
          <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => set('ocv_curve', [...c.ocv_curve, { soc: null, ocv_v: null }])}><Plus className="h-3 w-3" />Add point</button></div>
        {c.ocv_curve.length > 0 && (
          <div className="grid max-w-md gap-1.5">
            {c.ocv_curve.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <NumberInput value={p.soc} onChange={(v) => set('ocv_curve', c.ocv_curve.map((q, j) => (j === i ? { ...q, soc: v } : q)))} step="any" /><span className="unit">% SOC</span>
                <NumberInput value={p.ocv_v} onChange={(v) => set('ocv_curve', c.ocv_curve.map((q, j) => (j === i ? { ...q, ocv_v: v } : q)))} step="any" /><span className="unit">V</span>
                <button className="btn-ghost !p-1" onClick={() => set('ocv_curve', c.ocv_curve.filter((_, j) => j !== i))} aria-label="Remove point"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <ErrorBox error={error} title="The backend rejected this cell" />
      <div className="flex gap-2">
        <button className="btn-primary" onClick={submit} disabled={busy || !c.id}>{busy && <Spinner />}Save cell to database</button>
        {onCancel && <button className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}
