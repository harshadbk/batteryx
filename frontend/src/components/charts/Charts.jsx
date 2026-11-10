import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { fmt } from '../../lib/format'

const AXIS = { fontSize: 11, fill: '#64748b' }

function UnitTooltip({ active, payload, label, xLabel, units }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs shadow">
      <div className="mb-1 font-medium text-slate-700">{xLabel}: {fmt(label, 4)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-600">{p.name}</span>
          <span className="num ml-auto font-medium">{fmt(p.value, 4)} <span className="unit">{units[p.dataKey]}</span></span>
        </div>
      ))}
    </div>
  )
}

/**
 * Time-series chart for backend simulation output.
 * series: [{ key, label, unit, color, axis: 'left'|'right' }]; refLines: [{ y, label, color, axis }]
 */
export function TimeSeriesChart({ ts, series, refLines = [], height = 220, syncId }) {
  if (!ts?.time_s?.length) return null
  const data = ts.time_s.map((t, i) => {
    const row = { t: t / 60 }
    series.forEach((s) => { row[s.key] = ts[s.key]?.[i] ?? null })
    return row
  })
  const units = Object.fromEntries(series.map((s) => [s.key, s.unit]))
  const left = series.filter((s) => s.axis !== 'right')
  const right = series.filter((s) => s.axis === 'right')
  const axisLabel = (arr) => [...new Set(arr.map((s) => s.unit))].join(', ')
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} syncId={syncId} margin={{ top: 8, right: right.length ? 8 : 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#eef2f7" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickFormatter={(v) => fmt(v, 3)}
          label={{ value: 'time [min]', position: 'insideBottomRight', offset: -2, fontSize: 11, fill: '#94a3b8' }} />
        <YAxis yAxisId="left" tick={AXIS} width={56} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 3)}
          label={{ value: axisLabel(left), angle: -90, position: 'insideLeft', fontSize: 11, fill: '#94a3b8' }} />
        {right.length > 0 && (
          <YAxis yAxisId="right" orientation="right" tick={AXIS} width={56} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 3)}
            label={{ value: axisLabel(right), angle: 90, position: 'insideRight', fontSize: 11, fill: '#94a3b8' }} />
        )}
        <Tooltip content={<UnitTooltip xLabel="t [min]" units={units} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {refLines.map((r) => (
          <ReferenceLine key={r.label} yAxisId={r.axis || 'left'} y={r.y} stroke={r.color || '#b23a48'} strokeDasharray="5 4"
            label={{ value: r.label, fontSize: 10, fill: r.color || '#b23a48', position: 'insideTopRight' }} ifOverflow="extendDomain" />
        ))}
        {series.map((s) => (
          <Line key={s.key} yAxisId={s.axis === 'right' ? 'right' : 'left'} type="monotone" dataKey={s.key} name={`${s.label} [${s.unit}]`}
            stroke={s.color} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

/** One metric across designs. rows: [{ name, value, highlight }] */
export function MetricBarChart({ rows, unit, target, height = 240 }) {
  const data = rows.filter((r) => r.value !== null && r.value !== undefined)
  if (!data.length) return <div className="py-10 text-center text-sm text-slate-500">No design has a value for this metric.</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} interval={0} />
        <YAxis tick={AXIS} width={60} tickFormatter={(v) => fmt(v, 3)} label={{ value: unit, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#94a3b8' }} />
        <Tooltip formatter={(v) => [`${fmt(v, 4)} ${unit}`, 'value']} />
        {target && <ReferenceLine y={target.value} stroke="#b23a48" strokeDasharray="5 4" label={{ value: `${target.id} ${target.operator} ${target.value}`, fontSize: 10, fill: '#b23a48', position: 'insideTopRight' }} />}
        <Bar dataKey="value" isAnimationActive={false} radius={[3, 3, 0, 0]}
          label={{ position: 'top', fontSize: 11, fill: '#334155', formatter: (v) => fmt(v, 4) }}>
          {data.map((r) => <Cell key={r.name} fill={r.highlight ? '#0b7480' : '#94a3b8'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Horizontal bars, e.g. mass breakdown. rows: [{ name, value }] */
export function HBarChart({ rows, unit, color = '#5B6B8C', height }) {
  const data = rows.filter((r) => r.value !== null && r.value !== undefined)
  if (!data.length) return null
  return (
    <ResponsiveContainer width="100%" height={height || 36 * data.length + 30}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
        <CartesianGrid stroke="#eef2f7" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={(v) => fmt(v, 3)} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={130} />
        <Tooltip formatter={(v) => [`${fmt(v, 4)} ${unit}`, '']} />
        <Bar dataKey="value" fill={color} isAnimationActive={false} radius={[0, 3, 3, 0]}
          label={{ position: 'right', fontSize: 11, fill: '#334155', formatter: (v) => `${fmt(v, 3)}` }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** XY line chart for sweeps. points: [{ x, y }] */
export function SweepChart({ points, xLabel, yLabel, refY, refLabel, height = 220 }) {
  if (!points?.length) return null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#eef2f7" />
        <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickFormatter={(v) => fmt(v, 3)}
          label={{ value: xLabel, position: 'insideBottomRight', offset: -2, fontSize: 11, fill: '#94a3b8' }} />
        <YAxis tick={AXIS} width={56} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 3)}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#94a3b8' }} />
        <Tooltip formatter={(v) => [fmt(v, 4), yLabel]} labelFormatter={(v) => `${xLabel}: ${fmt(v, 4)}`} />
        {refY != null && <ReferenceLine y={refY} stroke="#b23a48" strokeDasharray="5 4" label={{ value: refLabel, fontSize: 10, fill: '#b23a48', position: 'insideTopRight' }} ifOverflow="extendDomain" />}
        <Line type="monotone" dataKey="y" stroke="#C77700" strokeWidth={2} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Percentile band (min · p5 · p50 · p95 · max) for Monte-Carlo results. */
export function PercentileBand({ label, unit, s }) {
  if (!s) return null
  const lo = s.min, hi = s.max
  const span = hi - lo || 1
  const pos = (v) => `${((v - lo) / span) * 100}%`
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="num text-slate-500">p50 <b className="text-slate-900">{fmt(s.p50, 4)}</b> <span className="unit">{unit}</span></span>
      </div>
      <div className="relative h-5 rounded bg-slate-100">
        <div className="absolute top-1 h-3 rounded bg-volt-100" style={{ left: pos(s.p5), width: `calc(${pos(s.p95)} - ${pos(s.p5)})` }} />
        <div className="absolute top-0 h-5 w-0.5 bg-volt-700" style={{ left: pos(s.p50) }} />
      </div>
      <div className="num mt-0.5 flex justify-between text-[10px] text-slate-500">
        <span>min {fmt(s.min, 4)}</span><span>p5 {fmt(s.p5, 4)}</span><span>p95 {fmt(s.p95, 4)}</span><span>max {fmt(s.max, 4)}</span>
      </div>
    </div>
  )
}
