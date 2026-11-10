// Builds the engineering report (Markdown) purely from backend responses. No values are computed here.
// Traceability chain shown in the report: input (with source tag) → model (id, version, equations) → result → check / requirement.
import { getPath } from './design'
import { ALL_FIELDS, SOURCE_TAGS } from './fields'
import { fmt } from './format'

const KPI_ROWS = [
  ['pack_voltage_nominal_v', 'Nominal pack voltage', 'V'],
  ['pack_capacity_ah', 'Pack capacity', 'Ah'],
  ['nominal_energy_wh', 'Nominal energy', 'Wh'],
  ['usable_energy_wh', 'Usable energy', 'Wh'],
  ['charge_time_cc_estimate_h', 'Charge time, CC estimate', 'h'],
  ['charge_time_sim_h', 'Charge time, simulated', 'h'],
  ['discharge_energy_sim_wh', 'Delivered energy, simulated', 'Wh'],
  ['peak_cell_temp_charge_c', 'Est. peak cell temp, charge', '°C'],
  ['peak_cell_temp_discharge_c', 'Est. peak cell temp, discharge', '°C'],
  ['max_safe_charge_current_a', 'Max safe charge current', 'A'],
  ['module_mass_kg', 'Module mass', 'kg'],
  ['module_volume_l', 'Module volume', 'L'],
  ['gravimetric_energy_density_wh_per_kg', 'Gravimetric energy density', 'Wh/kg'],
  ['estimated_cost', 'Estimated cost', 'currency'],
  ['relative_cost_index', 'Relative cost index', 'index'],
]
export { KPI_ROWS }

const esc = (s) => String(s ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ')
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n')

function collect(evaluations, severities) {
  const seen = new Map()
  evaluations.forEach((ev) => ev.flags.filter((f) => severities.includes(f.severity)).forEach((f) => {
    const k = `${f.code}|${f.message}`
    if (!seen.has(k)) seen.set(k, { ...f, designs: [] })
    if (!seen.get(k).designs.includes(ev.design_name)) seen.get(k).designs.push(ev.design_name)
  }))
  return [...seen.values()]
}
export const collectAssumptions = (ev) => collect(ev, ['assumption'])
export const collectLimitations = (ev) => collect(ev, ['unsupported', 'missing_input', 'warning'])

export function inputRows(evaluations) {
  const rows = [
    ['Cell', '', 'Design', ...evaluations.map((e) => e.cell.id)],
    ['Series × parallel', '', 'Design', ...evaluations.map((e) => e.topology)],
  ]
  ALL_FIELDS.forEach((f) => {
    const vals = evaluations.map((e) => getPath(e.inputs || {}, f.path))
    if (vals.every((v) => v === undefined || v === null)) return
    rows.push([f.label, f.unit || '', SOURCE_TAGS[f.source]?.label || f.source || '', ...vals.map((v) => (v === undefined || v === null ? '— (not set)' : typeof v === 'number' ? fmt(v, 5) : v))])
  })
  return rows
}

export function buildMarkdown({ project, evaluations, comparison, models, generatedAt, aiSummary }) {
  const L = []
  let n = 0
  const h = (title) => L.push(`## ${++n}. ${title}`, '')
  L.push(`# Engineering report: ${project.name}`, '')
  L.push(`Generated ${generatedAt} by BatteryX AI from backend calculations.`, '')
  L.push(`> **Result type: ESTIMATE.** ${evaluations[0]?.disclaimer ?? ''}`, '')
  if (aiSummary) {
    const v = aiSummary.verification
    L.push('## AI-generated engineering summary', '',
      `> Written by the BatteryX copilot (${aiSummary.model}) from engine tool results. Backend verification: **${v.passed ? 'passed' : `FAILED (${v.error_count} issue${v.error_count === 1 ? '' : 's'})`}**, ${v.numbers_checked} numbers checked. AI text is an explanation, not engineering approval.`, '')
    aiSummary.structured.report_sections.forEach((sec) => L.push(`### ${sec.title}`, '', sec.body_markdown, '', sec.source_refs.length ? `_Sources: ${sec.source_refs.join(', ')}_` : '', ''))
    if (!v.passed) L.push('**Verification issues:**', ...v.issues.filter((i) => i.severity === 'error').map((i) => `- ${i.type}: ${i.detail}`), '')
  }
  h('Application and scope')
  L.push(`- Application: ${project.application || 'not stated'}`, `- Description: ${project.description || '—'}`, `- Designs evaluated: ${evaluations.map((e) => `${e.design_name} (${e.topology}, ${e.role})`).join('; ')}`, '')
  h('Requirements')
  L.push(project.requirements.length ? table(['Id', 'Metric', 'Target', 'Note'], project.requirements.map((q) => [q.id, q.metric, `${q.operator} ${q.value} ${q.unit ?? ''}`, q.description ?? ''])) : '_No requirements defined._', '')
  h('Cells and data sources')
  const cells = [...new Map(evaluations.map((e) => [e.cell.id, e.cell])).values()]
  L.push(table(['Cell', 'Chemistry', 'Data status', 'Datasheet reference'], cells.map((c) => [c.id, c.chemistry, c.data_status, c.datasheet_ref || 'none recorded'])), '')
  if (cells.some((c) => c.data_status === 'illustrative_example')) L.push('> One or more cells use **illustrative example data**, not a real product datasheet. Results demonstrate the method only.', '')
  h('Design inputs and provenance')
  L.push('_Source tags: Design = design choice; Operating = operating condition; Engineer limit = engineer-set (not datasheet); Assumption = modelling assumption that needs justification or measurement. Inputs not set are reported by the engine as missing or defaulted (see Assumptions and Limitations)._', '')
  L.push(table(['Input', 'Unit', 'Source', ...evaluations.map((e) => e.design_name)], inputRows(evaluations)), '')
  h('Results (model estimates)')
  const trace = Object.assign({}, ...evaluations.map((e) => e.kpi_trace || {}).reverse())
  L.push(table(['Metric', 'Unit', ...evaluations.map((e) => e.design_name), 'Computed by (model)'],
    KPI_ROWS.map(([k, label, unit]) => [label, unit, ...evaluations.map((e) => fmt(e.kpis[k], 4)), trace[k] ? `${trace[k].model_id} v${trace[k].model_version}` : '—'])), '')
  h('Requirement compliance')
  L.push(table(['Design', ...project.requirements.map((q) => q.id)], evaluations.map((e) => [e.design_name, ...project.requirements.map((q) => e.requirements.find((r) => r.id === q.id)?.status ?? '—')])), '')
  h('Safety and monitoring checks')
  L.push('_Design-screening rule checks; not a safety certification._', '')
  evaluations.forEach((e) => {
    L.push(`### ${e.design_name}`, '', table(['Check', 'Status', 'Result', 'Limit source', 'Basis'], e.modules.bms.values.checks.map((c) => [`${c.id} ${c.description}`, c.status, c.detail, c.limit_source ?? '—', c.basis ?? '—'])), '')
  })
  if (comparison) {
    h('Design comparison')
    L.push(table(['Rank', 'Design', 'Eligible', 'Score', 'Requirements not met'], [...comparison.ranking].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((r) => [r.rank ?? '—', r.design_name, r.eligible ? 'yes' : 'no (safety FAIL)', fmt(r.score, 4), r.requirements_not_met.join('; ') || 'none'])), '')
    L.push(`Weights used: ${Object.entries(comparison.weights_used).map(([k, w]) => `${k} = ${w}`).join(', ')}`, '')
    const rec = comparison.recommendation
    if (rec) {
      L.push(`### Recommendation: ${rec.design_name} (${rec.topology})`, '')
      if (rec.why.length) L.push('**Why:**', ...rec.why.map((x) => `- ${x}`), '')
      if (rec.trade_offs.length) L.push('**Trade-offs:**', ...rec.trade_offs.map((x) => `- ${x}`), '')
      if (rec.risks.length) L.push('**Risks:**', ...rec.risks.map((x) => `- ${x}`), '')
      L.push(`**Recommended next step:** ${rec.recommended_next_step}`, '')
    } else L.push('_No design is eligible for recommendation._', '')
    comparison.notes.forEach((x) => L.push(`> ${x}`, ''))
  }
  h('Assumptions')
  const asm = collectAssumptions(evaluations)
  L.push(asm.length ? asm.map((a) => `- ${a.message} _(${a.code}; ${a.designs.join(', ')})_`).join('\n') : '_No engine-applied assumptions._', '')
  h('Limitations, missing inputs and unsupported calculations')
  const lim = collectLimitations(evaluations)
  L.push(lim.length ? lim.map((a) => `- **${a.severity}**: ${a.message} _(${a.code}; ${a.designs.join(', ')})_`).join('\n') : '_None reported._', '')
  h('Safety precautions')
  L.push('- No physical test results are included in this report; all values are model estimates.', '- Any validation experiment should use low voltage (below 60 V DC), a fused circuit, temperature monitoring and supervision, and should follow the cell manufacturer’s handling instructions.', '- Checks in this report screen the design; they are not a certification to any standard.', '')
  if (models?.length) {
    L.push('## Appendix: models and equations', '')
    models.forEach((m) => { L.push(`### ${m.label} (${m.id} v${m.version})`, '', ...m.equations.map((e) => `- \`${e}\``), '', '_Assumptions:_', ...m.assumptions.map((a) => `- ${a}`), '') })
  }
  return L.join('\n')
}
