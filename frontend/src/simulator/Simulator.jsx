import { useMemo, useState } from 'react'
import { OPTIONS, PARAMS, SUBSYSTEMS, defaultParams } from './model/defaults.js'
import { CALCS, downstream, evaluate, explain, fmt } from './model/engine.js'
import { DEFAULT_REQUIREMENTS } from './model/defaults.js'
import { DepGraph, PackView, TempCurve } from './components/charts.jsx'
import { Card, Est, Status, Tag } from './components/ui.jsx'

const SCENARIOS = [
  { label: 'Raise current to 1C', why: 'scenario: fast charge', patch: { iPack: 20 } },
  { label: 'Add heat spreader', why: 'scenario: cooling', patch: { cooling: 'spreader' } },
  { label: 'Switch to 4S2P', why: 'scenario: parallel', patch: { P: 2 } },
  { label: 'Hot day: 45 °C ambient', why: 'scenario: environment', patch: { ambient: 45 } },
  { label: 'Ageing: R doubles', why: 'scenario: ageing', patch: { rInt: 16 } },
]

const KPIS = [
  ['tCharge', 'Charge time', 'h', 2],
  ['eUsable', 'Usable energy', 'Wh', 0],
  ['tPeak', 'Peak cell temp', '°C', 1],
  ['qCell', 'Heat per cell', 'W', 2],
  ['mass', 'Module mass', 'kg', 2],
  ['cRate', 'Cell C-rate', 'C', 2],
]

export default function Simulator({ params, result, nodes, edges, change, log, lastChange, requirements }) {
  const [group, setGroup] = useState('Configuration')
  const [selected, setSelected] = useState('tPeak')
  const [step, setStep] = useState(-1)
  const groups = [...new Set(PARAMS.map((p) => p.group))]
  const affected = useMemo(() => (lastChange.ids.length ? downstream(lastChange.ids, edges) : new Set()), [lastChange, edges])
  const statusMap = useMemo(() => {
    const m = {}
    ;[...result.checks, result.control, ...result.reqs].forEach((c) => { m[c.id] = c.status })
    return m
  }, [result])
  const statusOf = (id) => (statusMap[id] && statusMap[id] !== 'PASS' ? statusMap[id] : undefined)
  const valueOf = (id) => {
    if (statusMap[id]) return statusMap[id]
    const x = result.v[id]
    if (typeof x === 'number') return fmt(x, Math.abs(x) >= 100 ? 0 : 2)
    return typeof x === 'string' ? x : undefined
  }
  const lines = lastChange.before ? explain(lastChange.before, result, lastChange.ids, params, requirements) : null
  const issues = [...result.checks, result.control, ...result.reqs].filter((c) => c.status !== 'PASS')
  const sel = nodes.find((n) => n.id === selected)
  const calc = CALCS.find((c) => c.id === selected)
  const pdef = PARAMS.find((p) => p.id === selected)
  const subsTouched = new Set(nodes.filter((n) => affected.has(n.id)).map((n) => n.sub))

  return (
    <div className="page sim">
      <Tour step={step} setStep={setStep} change={change} />

      <div className="sim-top">
        <div>
          <div className="kicker">Or explore freely</div>
          <h2 className="h-sub">Move any input. Every linked model re-runs.</h2>
        </div>
        <div className="scenario-row">
          {OPTIONS.map((o) => (
            <button key={o.id} className="chip-btn" onClick={() => change(o.patch, `load option ${o.id}`)} title={o.blurb}>Load {o.id}</button>
          ))}
          <span className="sep" />
          {SCENARIOS.map((s) => (
            <button key={s.label} className="chip-btn amber" onClick={() => change(s.patch, s.why)}>{s.label}</button>
          ))}
          <button className="chip-btn ghost" onClick={() => { setStep(-1); change({ ...defaultParams(), ...OPTIONS[0].patch }, 'reset') }}>Reset</button>
        </div>
      </div>

      <div className="sim-grid">
        {/* ---------------- inputs */}
        <aside className="panel inputs">
          <div className="tabs">
            {groups.map((g) => <button key={g} className={g === group ? 'on' : ''} onClick={() => setGroup(g)}>{g}</button>)}
          </div>
          <div className="param-list">
            {PARAMS.filter((p) => p.group === group).map((p) => (
              <div key={p.id} className={`param ${lastChange.ids.includes(p.id) ? 'changed' : ''}`} onClick={() => setSelected(p.id)}>
                <div className="param-h">
                  <span>{p.label}</span>
                  <b>{typeof params[p.id] === 'number' ? fmt(params[p.id], 2) : params[p.id]} {p.unit}</b>
                </div>
                {p.options ? (
                  <div className="seg">
                    {p.options.map((o) => (
                      <button key={o} className={params[p.id] === o ? 'on' : ''} onClick={() => change({ [p.id]: o })}>{o}</button>
                    ))}
                  </div>
                ) : (
                  <input type="range" min={p.min} max={p.max} step={p.step} value={params[p.id]}
                    onChange={(e) => change({ [p.id]: parseFloat(e.target.value) })} />
                )}
                <div className="param-f">
                  <Tag source={p.source} />
                  <span className="sub-l" style={{ color: SUBSYSTEMS[p.sub].color }}>{SUBSYSTEMS[p.sub].label}</span>
                  {p.asm && <span className="asm">{p.asm}</span>}
                </div>
              </div>
            ))}
          </div>
          <p className="muted small">Cell values are an example LFP datasheet. Replace them with your selected cell; the whole graph re-runs.</p>
        </aside>

        {/* ---------------- centre */}
        <section className="centre">
          <div className="viz-col">
            <Card kicker={`${params.S}S${params.P}P module · ${params.cooling}`} title="Estimated cell temperature" className="dark">
              <PackView params={params} v={result.v} height={210} />
              <div className="legend"><span className="cool" />ambient<span className="hot" />over limit<span className="dot" />sensor</div>
            </Card>
            <Card kicker="During charge" title="Temperature vs time" right={<Est />}>
              <TempCurve params={params} v={result.v} height={240} />
            </Card>
          </div>
        </section>
        {/* ---------------- results */}
        <aside className="panel results">
          <div className="kpis">
            {KPIS.map(([id, label, unit, d]) => (
              <div key={id} className={`kpi ${affected.has(id) ? 'hit' : ''}`} onClick={() => setSelected(id)}>
                <span>{label}</span>
                <b>{fmt(result.v[id], d)}<small> {unit}</small></b>
              </div>
            ))}
          </div>
          <div className="copilot">
            <div className="kicker">Copilot explanation <span className="muted">· grounded in the model above</span></div>
            {lines ? lines.map((l, i) => <p key={i}>{l}</p>) : (
              <p>{issues.length ? `${issues.length} item(s) need attention: ${issues.map((i) => i.id).join(', ')}. Try “Raise current to 1C” to see how a conflict is detected and explained.` : 'All checks pass. Try “Raise current to 1C”.'}</p>
            )}
          </div>
          <div className="checks">
            <div className="kicker">Constraint engine</div>
            {[...result.checks, result.control, ...result.reqs].map((c) => (
              <div key={c.id} className={`check ${affected.has(c.id) ? 'hit' : ''}`} onClick={() => setSelected(c.id)}>
                <Status s={c.status} small />
                <div><b>{c.id}</b> {c.label}<small>{c.detail}</small></div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <Card kicker="Dependency graph" title={lastChange.ids.length ? `Last change re-ran ${affected.size - lastChange.ids.length} linked items across ${subsTouched.size} subsystems` : 'Move any control to see what re-runs'}
            right={<div className="sub-legend">{Object.entries(SUBSYSTEMS).map(([k, s]) => <span key={k}><i style={{ background: s.color }} />{s.label}</span>)}</div>}
            className="graph-card">
            <DepGraph nodes={nodes} edges={edges} affected={affected} statusOf={statusOf} valueOf={valueOf}
              selected={selected} onSelect={setSelected} pulseKey={lastChange.stamp} height={0} />
          </Card>


      <div className="sim-bottom">
        <Card kicker="Inspector" title={sel ? (sel.kind === 'param' || sel.kind === 'calc' ? sel.label : `${sel.id} · ${sel.label}`) : 'Select a node'} className="inspector">
          {calc && (
            <div className="insp">
              <code>{calc.label} = {calc.formula}</code>
              <div className="insp-row">{calc.deps.map((d) => <span key={d} className="dep" onClick={() => setSelected(d)}>{d} = {typeof result.v[d] === 'number' ? fmt(result.v[d], 3) : result.v[d]}</span>)}</div>
              <div>Result: <b>{fmt(result.v[calc.id], 3)} {calc.unit}</b> <Est /></div>
            </div>
          )}
          {pdef && (
            <div className="insp">
              <div>Value <b>{String(params[pdef.id])} {pdef.unit}</b> <Tag source={pdef.source} /> {pdef.asm && <span className="asm">{pdef.asm}</span>}</div>
              <div className="muted">Feeds: {edges.filter((e) => e.from === pdef.id).map((e) => e.to).join(', ') || 'nothing'}</div>
            </div>
          )}
          {!calc && !pdef && sel && (
            <div className="insp">
              <div>Status <Status s={statusMap[sel.id] || 'PASS'} small /> {[...result.checks, result.control, ...result.reqs].find((c) => c.id === sel.id)?.detail}</div>
              <div className="muted">Depends on: {(sel.deps || []).join(', ')}</div>
            </div>
          )}
        </Card>
        <Card kicker="Change log" title="Every change, and what it touched" className="log">
          <div className="log-list">
            {log.length === 0 && <p className="muted">No changes yet.</p>}
            {log.map((e) => (
              <div key={e.n} className="log-row">
                <span className="t">#{e.n} {e.time}</span>
                <span><b>{e.ids.join(', ')}</b> <span className="muted">({e.why})</span></span>
                <span>{e.affected} items re-run · {e.subs.map((s) => SUBSYSTEMS[s].label).join(', ')}</span>
                <span className="flips">{e.flips.join(' · ') || 'no status change'}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- guided walkthrough
const BASE = () => defaultParams()
const run = (patch) => evaluate({ ...BASE(), ...patch }, DEFAULT_REQUIREMENTS)
const st = (r, id) => [...r.checks, r.control, ...r.reqs].find((c) => c.id === id)?.status

const TOUR = [
  {
    title: 'Start with the baseline design (Option A)',
    patch: { ...OPTIONS[0].patch },
    say: () => {
      const r = run(OPTIONS[0].patch).v
      return `A 4S1P LFP module charged at ${r.iPack} A (0.5C) with passive cooling. Peak cell temperature is about ${fmt(r.tPeak, 1)} °C, well inside the limit, but charging takes ${fmt(r.tCharge, 2)} h and our fast-charge requirement (REQ-03) asks for at most 1 h.`
    },
  },
  {
    title: 'Push for fast charge: double the current to 20 A (1C)',
    patch: { ...OPTIONS[0].patch, iPack: 20 },
    say: () => {
      const a = run(OPTIONS[0].patch)
      const b = run({ ...OPTIONS[0].patch, iPack: 20 })
      return `Charge time halves to ${fmt(b.v.tCharge, 2)} h, so REQ-03 now passes. But heat per cell follows I²R: ${fmt(a.v.qCell, 1)} → ${fmt(b.v.qCell, 1)} W (×4). Peak temperature rises to ${fmt(b.v.tPeak, 1)} °C, above the engineer's ${b.v.tMax} °C limit, so TH-01 is ${st(b, 'TH-01')}. The control model suggests ≤ ${fmt(b.control.iSafe, 1)} A. Watch the orange path in the dependency graph below.`
    },
  },
  {
    title: 'Resolve it: keep 20 A, add an aluminium heat spreader (Option B)',
    patch: { ...OPTIONS[1].patch },
    say: () => {
      const c = run({ ...OPTIONS[0].patch, iPack: 20 })
      const b = run(OPTIONS[1].patch)
      return `Same ${fmt(b.v.tCharge, 2)} h charge, but a lower thermal resistance brings the peak to ${fmt(b.v.tPeak, 1)} °C (TH-01 ${st(b, 'TH-01')}, margin ${fmt(b.v.tMax - b.v.tPeak, 1)} K). The trade: mass ${fmt(c.v.mass, 2)} → ${fmt(b.v.mass, 2)} kg and cost index ${fmt(c.v.cost, 2)} → ${fmt(b.v.cost, 2)}. EL-01 is ${st(b, 'EL-01')}: cells now run at their 1C datasheet maximum.`
    },
  },
  {
    title: 'Try another route: 4S2P at the same 20 A (Option C layout)',
    patch: { ...OPTIONS[2].patch, sensors: 2 },
    say: () => {
      const r = run({ ...OPTIONS[2].patch, sensors: 2 })
      return `Splitting the current over two parallel cells halves the per-cell current: heat drops to ${fmt(r.v.qCell, 1)} W and the peak to ${fmt(r.v.tPeak, 1)} °C, and energy doubles to ${fmt(r.v.eUsable, 0)} Wh. But the change ripples into other subsystems: mass ${fmt(r.v.mass, 2)} kg misses REQ-02, charge time ${fmt(r.v.tCharge, 2)} h misses REQ-03, and 8 cells now need ${r.v.sensorsReq} temperature sensors, so sensing rule SE-01 is ${st(r, 'SE-01')}.`
    },
  },
  {
    title: 'Result: compare all three and recommend, with stated risks',
    patch: { ...OPTIONS[1].patch },
    summary: true,
    say: () => {
      const b = run(OPTIONS[1].patch)
      return `Only Option B meets every requirement without a safety-rule failure, so it is recommended, with its risks stated: a thermal margin of ${fmt(b.v.tMax - b.v.tPeak, 1)} K and cells at their maximum charge rate. Every number here is an estimate from stated assumptions; the next step is a safe, low-voltage bench test to validate it.`
    },
  },
]

function Tour({ step, setStep, change }) {
  const go = (i) => {
    setStep(i)
    change({ ...BASE(), ...TOUR[i].patch }, `guided step ${i + 1}`)
  }
  if (step < 0) {
    return (
      <section className="tour intro">
        <div>
          <div className="kicker light">Guided simulation · 5 steps · about 1 minute</div>
          <h1>Change one parameter. See every consequence.</h1>
          <p>Follow one design decision, faster charging, as it ripples through electrical, thermal, mechanical, sensing, protection and control models, gets checked against engineer-set limits, and is resolved.</p>
        </div>
        <button className="btn start" onClick={() => go(0)}>▶ Start the guided simulation</button>
      </section>
    )
  }
  const t = TOUR[step]
  return (
    <section className="tour">
      <div className="tour-steps">
        {TOUR.map((x, i) => (
          <button key={i} className={`dot ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => go(i)} title={x.title}>{i + 1}</button>
        ))}
      </div>
      <div className="tour-body">
        <div className="kicker light">Step {step + 1} of {TOUR.length}</div>
        <h2>{t.title}</h2>
        <p>{t.say()}</p>
        {t.summary && (
          <div className="tour-table">
            {OPTIONS.map((o) => {
              const r = run(o.patch)
              const bad = [...r.checks, ...r.reqs].filter((c) => c.status === 'FAIL' || c.status === 'MISS')
              return (
                <div key={o.id} className={o.id === 'B' ? 'best' : ''}>
                  <b>{o.id} · {o.name}</b>
                  <span>{fmt(r.v.tCharge, 2)} h · {fmt(r.v.tPeak, 1)} °C · {fmt(r.v.eUsable, 0)} Wh · {fmt(r.v.mass, 2)} kg</span>
                  <em>{bad.length ? `misses ${bad.map((c) => c.id).join(', ')}` : 'meets all requirements'}</em>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="tour-nav">
        <button className="btn" disabled={step === 0} onClick={() => go(step - 1)}>← Back</button>
        {step < TOUR.length - 1
          ? <button className="btn start" onClick={() => go(step + 1)}>Next →</button>
          : <button className="btn start" onClick={() => go(0)}>↺ Replay</button>}
      </div>
    </section>
  )
}
