import { useState, type ReactNode } from 'react'
import { Icon } from '../../ui'

export function Tool({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <section className="panel panel-pad tool">
      <h3>{title}</h3>
      <p className="small muted">{lead}</p>
      {children}
    </section>
  )
}

/** Text input + button; Enter submits. */
export function Ask({ label, busy, onRun, placeholder, initial = '', extra }: { label: string; busy: boolean; onRun(value: string): void; placeholder: string; initial?: string; extra?: ReactNode }) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="row tool-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onRun(value.trim())
      }}
    >
      <input className="input sm mono" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setValue(e.target.value)} />
      {extra}
      <button className="btn sm" type="submit" disabled={busy || !value.trim()}>
        {busy && <Icon name="refresh" className="spin" />}
        {label}
      </button>
    </form>
  )
}
