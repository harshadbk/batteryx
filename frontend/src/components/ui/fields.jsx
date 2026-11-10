import { useEffect, useState } from 'react'

import { getPath } from '../../lib/design'
import { SOURCE_TAGS } from '../../lib/fields'
import { cx, InfoTip } from './core'

export function SourceTag({ source }) {
  const s = SOURCE_TAGS[source]
  if (!s) return null
  return <span title={s.tip} className={cx('rounded border px-1 py-px text-[10px] font-medium leading-none', s.cls)}>{s.label}</span>
}

/** Numeric input that keeps the raw text while typing and emits null for empty. */
export function NumberInput({ value, onChange, min, max, step, integer, id, disabled, className }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => {
    if (value === null || value === undefined) setText((t) => (t === '' || t === '-' ? t : ''))
    else if (Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input id={id} type="number" inputMode="decimal" className={cx('input', className)} value={text} min={min} max={max} step={step} disabled={disabled}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t === '') return onChange(null)
        const n = Number(t)
        if (Number.isFinite(n)) onChange(integer ? Math.round(n) : n)
      }} />
  )
}

export function Field({ field, value, onChange, compact }) {
  const id = `f-${field.path}`
  let input
  if (field.type === 'select') {
    input = (
      <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {!field.options.some((o) => o.value === value) && <option value="">—</option>}
        {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  } else if (field.type === 'text') {
    input = <input id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
  } else {
    input = <NumberInput id={id} value={value} onChange={onChange} min={field.min} max={field.max} step={field.step} integer={field.integer} />
  }
  return (
    <div className={compact ? '' : 'min-w-0'}>
      <label htmlFor={id} className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-700">
        <span>{field.label}</span>
        {field.unit && <span className="unit">[{field.unit}]</span>}
        <InfoTip>{field.help}</InfoTip>
        <span className="ml-auto"><SourceTag source={field.source} /></span>
      </label>
      {input}
    </div>
  )
}

export function FieldGrid({ fields, data, onChange, cols = 'sm:grid-cols-2 xl:grid-cols-3' }) {
  return (
    <div className={cx('grid grid-cols-1 gap-x-4 gap-y-3', cols)}>
      {fields.map((f) => <Field key={f.path} field={f} value={getPath(data, f.path)} onChange={(v) => onChange(f.path, v)} />)}
    </div>
  )
}

export function Stepper({ value, onChange, min = 1, max = 99, label, unit }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div>
      {label && <div className="mb-1 text-xs font-medium text-slate-700">{label} {unit && <span className="unit">[{unit}]</span>}</div>}
      <div className="flex items-stretch">
        <button className="btn-secondary rounded-r-none px-3" onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Decrease ${label}`}>−</button>
        <input className="input w-16 rounded-none border-x-0 text-center" value={value} aria-label={label}
          onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) set(n) }} />
        <button className="btn-secondary rounded-l-none px-3" onClick={() => set(value + 1)} disabled={value >= max} aria-label={`Increase ${label}`}>+</button>
      </div>
    </div>
  )
}
