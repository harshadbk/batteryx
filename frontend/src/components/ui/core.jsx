import { AlertTriangle, CircleHelp, Inbox, Loader2, XCircle } from 'lucide-react'

import { FIELD_INDEX } from '../../lib/fields'
import { STATUS_TONE } from '../../lib/format'

const cx = (...a) => a.filter(Boolean).join(' ')
export { cx }

export function Panel({ title, subtitle, actions, children, className, bodyClass, id }) {
  return (
    <section id={id} className={cx('panel', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, kicker, description, actions, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {kicker && <div className="label text-volt-600">{kicker}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  volt: 'bg-volt-50 text-volt-700 border-volt-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  dark: 'bg-ink-800 text-slate-100 border-ink-700',
}

export function Badge({ tone = 'slate', children, className, title }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }) {
  const label = status === 'NOT_EVALUATED' ? 'NOT EVALUATED' : status === 'NOT_MET' ? 'NOT MET' : status
  return <Badge tone={STATUS_TONE[status] || 'slate'} className="font-mono tracking-wide">{label}</Badge>
}

export function DataStatusBadge({ status }) {
  if (status === 'datasheet') return <Badge tone="green" title="Transcribed from a cited manufacturer datasheet">Datasheet</Badge>
  if (status === 'user_entered') return <Badge tone="volt" title="Entered by a user; not verified against a datasheet">User-entered</Badge>
  if (status === 'illustrative_example') return <Badge tone="amber" title="Demo values, not a real product">Illustrative demo data</Badge>
  return null
}

export function InfoTip({ children, className }) {
  if (!children) return null
  return (
    <span className={cx('tip align-middle', className)} tabIndex={0} aria-label="More information">
      <CircleHelp className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600" />
      <span className="tip-body" role="tooltip">{children}</span>
    </span>
  )
}

export function Spinner({ className }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin', className)} />
}

export function LoadingBlock({ label = 'Loading…', className }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)}>
      <Spinner /> {label}
    </div>
  )
}

export function ErrorBox({ error, title, onRetry, className }) {
  if (!error) return null
  const details = Array.isArray(error.details) ? error.details : null
  return (
    <div className={cx('rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800', className)} role="alert">
      <div className="flex items-start gap-2">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title || error.message}</div>
          {title && <div className="mt-0.5">{error.message}</div>}
          {details && (
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {details.map((d, i) => {
                const path = (d.loc || []).filter((x) => x !== 'body').join('.')
                const label = FIELD_INDEX[path]?.label
                return <li key={i}><span className="font-mono">{label ? `${label} (${path})` : path || 'request'}</span>: {d.msg}</li>
              })}
            </ul>
          )}
          {typeof error.details === 'string' && <div className="mt-1 font-mono text-xs">{error.details}</div>}
        </div>
        {onRetry && <button className="btn-secondary !py-1 text-xs" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  )
}

export function Notice({ tone = 'amber', icon: Icon = AlertTriangle, children, className }) {
  const t = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    volt: 'border-volt-100 bg-volt-50 text-volt-900',
    red: 'border-red-200 bg-red-50 text-red-800',
  }[tone]
  return (
    <div className={cx('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', t, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <Icon className="h-8 w-8 text-slate-400" />
      <div className="mt-3 text-sm font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Stat({ label, value, unit, sub, tone, tip, className }) {
  const toneCls = { green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700' }[tone] || 'text-slate-900'
  return (
    <div className={cx('rounded-md border border-slate-200 bg-white px-3 py-2.5', className)}>
      <div className="flex items-center gap-1 label">{label}<InfoTip>{tip}</InfoTip></div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cx('num text-lg font-semibold', toneCls)}>{value}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('rounded px-3 py-1 text-xs font-medium', value === t.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function KV({ rows, className }) {
  return (
    <dl className={cx('grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm', className)}>
      {rows.filter(Boolean).map(([k, v, unit]) => (
        <div key={k} className="contents">
          <dt className="text-slate-600">{k}</dt>
          <dd className="num text-right font-medium text-slate-900">{v}{unit && <span className="unit ml-1">{unit}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}
