import { useCallback, useState, type ReactNode } from 'react'
import { company, countryName } from '../../explain'
import { errText, type Dict } from '../../i18n'
import { Icon } from '../../ui'

/** One button's request: busy while it runs, then a result or an error. */
export function useRun<T>() {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<T | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const run = useCallback(async (f: () => Promise<T>) => {
    setBusy(true)
    setErr(null)
    setRes(null)
    try {
      setRes(await f())
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, res, err, run }
}

export const where = (x: { org: string | null; country: string | null }, lang: string) => [x.org && company(x.org), x.country && countryName(x.country, lang)].filter(Boolean).join(' · ')

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

export const ErrNote = ({ t, e }: { t: Dict; e: unknown }) => (e === null ? null : <p className="note danger">{errText(t, e)}</p>)
