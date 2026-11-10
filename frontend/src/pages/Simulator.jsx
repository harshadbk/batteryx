// Live what-if simulator: the stage-1 BatteryWeave prototype, merged into BatteryX as one page.
// It runs entirely in the browser (src/simulator/model), so it works even when the backend is offline.
// The backend engine remains the source of truth for project designs; this page is for exploring
// how one change ripples across subsystems, with a guided 5-step walkthrough and a dependency graph.
import { useMemo, useRef, useState } from 'react'

import { DEFAULT_REQUIREMENTS, OPTIONS, defaultParams } from '../simulator/model/defaults.js'
import { downstream, evaluate, graphEdges, graphNodes } from '../simulator/model/engine.js'
import SimulatorView from '../simulator/Simulator.jsx'
import '../simulator/simulator.css'

export default function Simulator() {
  const [params, setParams] = useState(() => ({ ...defaultParams(), ...OPTIONS[0].patch }))
  const requirements = DEFAULT_REQUIREMENTS
  const [log, setLog] = useState([])
  const [lastChange, setLastChange] = useState({ ids: [], before: null, stamp: 0 })
  const seq = useRef(0)

  const result = useMemo(() => evaluate(params, requirements), [params, requirements])
  const nodes = useMemo(() => graphNodes(requirements), [requirements])
  const edges = useMemo(() => graphEdges(nodes), [nodes])

  // apply a patch of input changes and record what the graph had to re-run
  const change = (patch, why = 'manual edit') => {
    const ids = Object.keys(patch).filter((k) => patch[k] !== params[k])
    if (!ids.length) return
    const before = evaluate(params, requirements)
    const next = { ...params, ...patch }
    const after = evaluate(next, requirements)
    const affected = downstream(ids, edges)
    const subs = new Set(nodes.filter((n) => affected.has(n.id)).map((n) => n.sub))
    const all = (r) => [...r.checks, r.control, ...r.reqs]
    const flips = all(after).filter((c) => {
      const o = all(before).find((x) => x.id === c.id)
      return o && o.status !== c.status
    }).map((c) => `${c.id} → ${c.status}`)
    seq.current += 1
    setLog((l) => [{ n: seq.current, time: new Date().toLocaleTimeString(), ids, why, affected: affected.size - ids.length, subs: [...subs], flips }, ...l].slice(0, 60))
    setLastChange({ ids, before, stamp: Date.now() })
    setParams(next)
  }

  return (
    <div className="bw">
      <SimulatorView params={params} requirements={requirements} result={result} nodes={nodes} edges={edges}
        change={change} log={log} lastChange={lastChange} />
      <p className="muted small" style={{ marginTop: 16 }}>
        In-browser concept model (stage-1 engine). Cell values are an example LFP datasheet and thermal values are assumptions;
        every number is an estimate and needs engineer validation. For project designs, use the backend-computed pages
        (Electrical, Thermal, BMS &amp; safety, Compare).
      </p>
    </div>
  )
}
