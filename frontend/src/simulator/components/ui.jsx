import { SOURCES, SUBSYSTEMS } from '../model/defaults.js'

export function Status({ s, small }) {
  return <span className={`status s-${s} ${small ? 'sm' : ''}`}>{s}</span>
}

export function Tag({ source }) {
  const d = SOURCES[source]
  if (!d) return null
  return <span className={`tag t-${source}`} title={d.label}>{d.label}</span>
}

export function Est() {
  return <span className="tag t-est" title="Calculated from assumptions; not measured">Estimated</span>
}

export function SubDot({ sub }) {
  const s = SUBSYSTEMS[sub]
  return <span className="subdot" style={{ background: s?.color }} title={s?.label} />
}

export function Card({ title, kicker, children, className = '', right }) {
  return (
    <section className={`card ${className}`}>
      {(title || kicker) && (
        <header className="card-h">
          <div>
            {kicker && <div className="kicker">{kicker}</div>}
            {title && <h3>{title}</h3>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHead({ kicker, title, children }) {
  return (
    <header className="page-head">
      <div className="kicker">{kicker}</div>
      <h1>{title}</h1>
      {children && <p className="lede">{children}</p>}
    </header>
  )
}
