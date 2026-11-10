import { useMemo } from 'react'
import { SUBSYSTEMS } from '../model/defaults.js'
import { fmt } from '../model/engine.js'

// temperature → colour (cool teal → amber → hot red), scaled between ambient and limit + 5 K
export function heat(t, amb, lim) {
  const x = Math.max(0, Math.min(1, (t - amb) / Math.max(lim + 5 - amb, 1)))
  const stops = [[25, 168, 180], [242, 169, 59], [242, 107, 58], [200, 40, 30]]
  const seg = x * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(seg))
  const f = seg - i
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f))
  return `rgb(${c.join(',')})`
}

// ---------------------------------------------------------------- battery module heat-map
export function PackView({ params, v, height = 230, compact }) {
  const { S, P, cooling, sensors } = params
  const cw = 46
  const ch = 84
  const gx = 16
  const gy = 18
  const W = S * cw + (S - 1) * gx + 60
  const H = P * ch + (P - 1) * gy + 70
  const col = heat(v.tPeak, params.ambient, params.tMax)
  const sensorPos = []
  for (let k = 0; k < sensors; k++) sensorPos.push(k)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} role="img" aria-label={`${S}S${P}P module heat map`}>
      <defs>
        <linearGradient id="cellg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity="1" />
          <stop offset="1" stopColor={col} stopOpacity="0.72" />
        </linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" /></filter>
      </defs>
      <ellipse cx={W / 2} cy={H / 2 + 4} rx={W / 2 - 6} ry={H / 2 - 6} fill={col} opacity={0.18} filter="url(#glow)" />
      {cooling === 'spreader' && <rect x={18} y={H - 26} width={W - 36} height={9} rx={2} fill="#9FB0C2" />}
      {Array.from({ length: P }).map((_, r) =>
        Array.from({ length: S }).map((__, c) => {
          const x = 30 + c * (cw + gx)
          const y = 26 + r * (ch + gy)
          return (
            <g key={`${r}-${c}`}>
              <rect x={x + 7} y={y - 7} width={10} height={7} rx={1} fill="#C9D3DD" />
              <rect x={x + cw - 17} y={y - 7} width={10} height={7} rx={1} fill="#C9D3DD" />
              {c < S - 1 && <rect x={x + cw - 15} y={y - 11} width={gx + 24} height={5} rx={1} fill="#AEBBC8" />}
              <rect x={x} y={y} width={cw} height={ch} rx={6} fill="url(#cellg)" stroke="rgba(255,255,255,.55)" />
              {!compact && <text x={x + cw / 2} y={y + ch / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">LFP</text>}
            </g>
          )
        }),
      )}
      {sensorPos.map((k) => {
        const total = S * P
        const idx = Math.min(total - 1, Math.round(((k + 0.5) / Math.max(sensors, 1)) * total - 0.5))
        const r = Math.floor(idx / S)
        const c = idx % S
        return <circle key={k} cx={30 + c * (cw + gx) + cw / 2} cy={26 + r * (ch + gy) + ch - 12} r={5} fill="#0B2545" stroke="#fff" strokeWidth="1.5" />
      })}
    </svg>
  )
}

// ---------------------------------------------------------------- temperature during charge
export function TempCurve({ params, v, height = 220 }) {
  const W = 520
  const H = 220
  const pad = { l: 42, r: 14, t: 14, b: 30 }
  const tEnd = Math.max(v.tCharge * 60, 1)
  const xMax = Math.max(tEnd * 1.15, 10)
  const T = (m) => params.ambient + v.dTss * (1 - Math.exp(-Math.min(m, tEnd) / v.tau))
  const yMin = Math.floor(params.ambient - 2)
  const yMax = Math.ceil(Math.max(params.tMax + 4, v.tPeak + 2))
  const X = (m) => pad.l + (m / xMax) * (W - pad.l - pad.r)
  const Y = (t) => H - pad.b - ((t - yMin) / (yMax - yMin)) * (H - pad.t - pad.b)
  const pts = []
  for (let i = 0; i <= 80; i++) {
    const m = (i / 80) * tEnd
    pts.push(`${X(m)},${Y(T(m))}`)
  }
  const ticksY = []
  for (let t = Math.ceil(yMin / 5) * 5; t <= yMax; t += 5) ticksY.push(t)
  const step = xMax > 120 ? 30 : xMax > 60 ? 15 : 10
  const ticksX = []
  for (let m = 0; m <= xMax; m += step) ticksX.push(m)
  const over = v.tPeak > params.tMax
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} role="img" aria-label="Estimated cell temperature during charge">
      <rect x={pad.l} y={Y(params.tMax)} width={W - pad.l - pad.r} height={Y(params.tMax - params.tMargin) - Y(params.tMax)} fill="#FFF3E0" />
      {ticksY.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="#E6ECF2" />
          <text x={pad.l - 6} y={Y(t) + 4} fontSize="11" textAnchor="end" fill="#55606E">{t}</text>
        </g>
      ))}
      {ticksX.map((m) => <text key={m} x={X(m)} y={H - 10} fontSize="11" textAnchor="middle" fill="#55606E">{m}</text>)}
      <text x={W - pad.r} y={H - 10} fontSize="11" textAnchor="end" fill="#55606E">min</text>
      <line x1={pad.l} x2={W - pad.r} y1={Y(params.tMax)} y2={Y(params.tMax)} stroke="#B23A48" strokeDasharray="5 4" strokeWidth="1.5" />
      <text x={pad.l + 6} y={Y(params.tMax) - 5} fontSize="11" textAnchor="start" fill="#B23A48" fontWeight="700">engineer limit {params.tMax} °C</text>
      <line x1={pad.l} x2={W - pad.r} y1={Y(params.ambient)} y2={Y(params.ambient)} stroke="#9FB0C2" strokeDasharray="2 4" />
      <polyline points={pts.join(' ')} fill="none" stroke={over ? '#C8401A' : '#0E8C99'} strokeWidth="3" strokeLinejoin="round" />
      <circle cx={X(tEnd)} cy={Y(v.tPeak)} r="5" fill={over ? '#C8401A' : '#0E8C99'} />
      <text x={X(tEnd) > W * 0.6 ? X(tEnd) - 8 : X(tEnd) + 8} textAnchor={X(tEnd) > W * 0.6 ? 'end' : 'start'} y={Y(v.tPeak) + (over ? -10 : 18)} fontSize="13" fontWeight="700" fill={over ? '#C8401A' : '#0B2545'}>
        {fmt(v.tPeak, 1)} °C at end of charge
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------- dependency graph
export function DepGraph({ nodes, edges, affected, statusOf, valueOf, selected, onSelect, pulseKey, height = 560 }) {
  const layout = useMemo(() => {
    const cols = [0, 1, 2, 3].map((l) => nodes.filter((n) => n.layer === l))
    const W = 1000
    const colX = [10, 255, 530, 790]
    const colW = [200, 230, 220, 205]
    const pos = {}
    const maxRows = Math.max(...cols.map((c) => c.length))
    const rowH = 27
    const H = maxRows * rowH + 40
    cols.forEach((c, l) => {
      const off = (H - c.length * rowH) / 2
      c.forEach((n, i) => { pos[n.id] = { x: colX[l], y: off + i * rowH, w: colW[l], h: 22 } })
    })
    return { pos, W, H }
  }, [nodes])
  const { pos, W, H } = layout
  const titles = ['INPUTS', 'PHYSICS CALCULATIONS', 'RULE CHECKS', 'REQUIREMENTS']
  const tx = [10, 255, 530, 790]
  return (
    <svg viewBox={`0 -24 ${W} ${H + 24}`} style={{ width: '100%', height: height || 'auto' }} className="depgraph" role="img" aria-label="Dependency graph">
      {titles.map((t, i) => <text key={t} x={tx[i]} y={-8} fontSize="11" letterSpacing="1.5" fill="#55606E" fontWeight="700">{t}</text>)}
      {edges.map((e, i) => {
        const a = pos[e.from]
        const b = pos[e.to]
        if (!a || !b) return null
        const on = affected.has(e.from) && affected.has(e.to)
        const sel = selected && (e.to === selected || e.from === selected)
        const x1 = a.x + a.w
        const y1 = a.y + a.h / 2
        const x2 = b.x
        const y2 = b.y + b.h / 2
        const mx = (x1 + x2) / 2
        return (
          <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none"
            stroke={on ? '#F2A93B' : sel ? '#0E8C99' : '#DCE3EA'} strokeWidth={on ? 2 : sel ? 1.6 : 1}
            className={on ? `flow k${pulseKey % 2}` : ''} opacity={on || sel ? 1 : 0.8} />
        )
      })}
      {nodes.map((n) => {
        const p = pos[n.id]
        const on = affected.has(n.id)
        const st = statusOf(n.id)
        const c = SUBSYSTEMS[n.sub]?.color || '#0B2545'
        const val = valueOf(n.id)
        const fill = st === 'FAIL' ? '#FDE4DC' : st === 'WARN' || st === 'SUGGEST' ? '#FFF3E0' : st === 'MISS' ? '#FBE9EC' : on ? '#FFF8EC' : '#fff'
        const stroke = st === 'FAIL' ? '#C8401A' : st === 'WARN' || st === 'SUGGEST' ? '#C77700' : st === 'MISS' ? '#B23A48' : on ? '#F2A93B' : selected === n.id ? '#0E8C99' : '#CBD5DF'
        return (
          <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect?.(n.id)} style={{ cursor: 'pointer' }} className={on ? `node-on k${pulseKey % 2}` : ''}>
            <rect width={p.w} height={p.h} rx={6} fill={fill} stroke={stroke} strokeWidth={selected === n.id ? 2.2 : 1.2} />
            <rect width={4} height={p.h} rx={2} fill={c} />
            <text x={10} y={15} fontSize="11.5" fill="#0B2545" fontWeight={on ? 700 : 500}>
              {trunc(n.kind === 'rule' || n.kind === 'requirement' ? `${n.id} ${shortLabel(n.label)}` : n.label, n.layer === 3 ? 25 : 26)}
            </text>
            {val !== undefined && (
              <text x={p.w - 6} y={15} fontSize="11.5" textAnchor="end" fill={st ? stroke : '#55606E'} fontWeight="700">{val}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const shortLabel = (s) => s.replace('within engineer limit', '').replace('within datasheet maximum', '').replace('below fuse rating', '≤ fuse').replace('within BMS charge limit', '≤ BMS').replace('Enough temperature sensors for the cell count', 'sensor count').replace('Charge-current recommendation', 'current advice')

// ---------------------------------------------------------------- simple bars
export function Bars({ items, unit, d = 1, better, height = 150, limit }) {
  const max = Math.max(...items.map((i) => i.value), limit || 0) * 1.15 || 1
  const W = 300
  const H = 150
  const bw = 54
  const gap = (W - items.length * bw) / (items.length + 1)
  const Y = (x) => H - 26 - (x / max) * (H - 50)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }}>
      <line x1="0" x2={W} y1={H - 26} y2={H - 26} stroke="#CBD5DF" />
      {limit !== undefined && (
        <g>
          <line x1="0" x2={W} y1={Y(limit)} y2={Y(limit)} stroke="#B23A48" strokeDasharray="4 3" />
          <text x={W - 2} y={Y(limit) - 4} fontSize="10" textAnchor="end" fill="#B23A48">{better === 'low' ? 'max' : 'min'} {fmt(limit, d)}</text>
        </g>
      )}
      {items.map((it, i) => {
        const x = gap + i * (bw + gap)
        return (
          <g key={it.id}>
            <rect x={x} y={Y(it.value)} width={bw} height={H - 26 - Y(it.value)} rx={4} fill={it.color} opacity={it.dim ? 0.45 : 1} />
            <text x={x + bw / 2} y={Y(it.value) - 6} fontSize="12" textAnchor="middle" fontWeight="700" fill="#0B2545">{fmt(it.value, d)}</text>
            <text x={x + bw / 2} y={H - 9} fontSize="12" textAnchor="middle" fontWeight="700" fill="#55606E">{it.id}</text>
          </g>
        )
      })}
      <text x="2" y="12" fontSize="10" fill="#55606E">{unit}{better ? (better === 'low' ? ' · lower is better' : ' · higher is better') : ''}</text>
    </svg>
  )
}

// ---------------------------------------------------------------- histogram
export function Histogram({ values, bins = 24, limit, warn, unit, color = '#0E8C99', height = 230 }) {
  const W = 560
  const H = 230
  const pad = { l: 38, r: 10, t: 12, b: 32 }
  const lo = Math.min(...values, warn ?? Infinity, limit ?? Infinity) - 0.2
  const hi = Math.max(...values, limit ?? -Infinity) + 0.2
  const w = (hi - lo) / bins
  const counts = new Array(bins).fill(0)
  values.forEach((x) => { counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++ })
  const cmax = Math.max(...counts)
  const X = (x) => pad.l + ((x - lo) / (hi - lo)) * (W - pad.l - pad.r)
  const Y = (c) => H - pad.b - (c / cmax) * (H - pad.t - pad.b)
  const ticks = []
  const span = hi - lo
  const step = span > 200 ? 50 : span > 40 ? 10 : span > 8 ? 2 : span > 3 ? 1 : 0.5
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(+t.toFixed(2))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }}>
      {counts.map((c, i) => {
        const x0 = lo + i * w
        const over = limit !== undefined && x0 + w / 2 > limit
        const inWarn = warn !== undefined && x0 + w / 2 > warn
        return <rect key={i} x={X(x0) + 1} y={Y(c)} width={Math.max(1, X(x0 + w) - X(x0) - 2)} height={H - pad.b - Y(c)} fill={over ? '#C8401A' : inWarn ? '#F2A93B' : color} rx={2} />
      })}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#CBD5DF" />
      {ticks.map((t) => <text key={t} x={X(t)} y={H - 12} fontSize="11" textAnchor="middle" fill="#55606E">{t}</text>)}
      <text x={W - pad.r} y={H - 0} fontSize="11" textAnchor="end" fill="#55606E">{unit}</text>
      {limit !== undefined && (
        <g>
          <line x1={X(limit)} x2={X(limit)} y1={pad.t} y2={H - pad.b} stroke="#B23A48" strokeDasharray="5 4" strokeWidth="1.5" />
          <text x={X(limit) - 4} y={pad.t + 10} fontSize="11" textAnchor="end" fill="#B23A48" fontWeight="700">limit</text>
        </g>
      )}
      {warn !== undefined && <line x1={X(warn)} x2={X(warn)} y1={pad.t} y2={H - pad.b} stroke="#C77700" strokeDasharray="2 4" />}
    </svg>
  )
}
