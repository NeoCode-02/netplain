import { useEffect, useState, type FormEvent } from 'react'
import type { MonitorKind, MonitorState } from '../../../shared/types'
import { errText, getLang, useT, type Dict } from '../i18n'
import { Icon } from '../ui'

const KINDS: MonitorKind[] = ['http', 'tcp', 'ping']

function Row({ t, x, now, onChange }: { t: Dict; x: MonitorState; now: number; onChange(list: MonitorState[]): void }) {
  const m = t.monitors
  const [busy, setBusy] = useState(false)
  const clock = (v: number) => new Date(v).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })
  const ok = x.history.filter((h) => h.ms !== null).length
  const details =
    x.up === true
      ? [x.since && m.upFor(t.uptime.span(now - x.since)), x.ms !== null && t.uptime.ms(x.ms), x.history.length > 1 && m.day(((ok / x.history.length) * 100).toFixed(1).replace(/\.0$/, '')), x.certDays !== null && m.cert(x.certDays)]
      : x.up === false
        ? [x.since && m.downSince(clock(x.since)), x.error && m.why(x.error)]
        : []
  const act = async (f: () => Promise<MonitorState[]> | MonitorState[]) => {
    setBusy(true)
    try {
      onChange(await f())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="list-row monitor-row">
      <span className={`mon-dot ${x.up === null ? '' : x.up ? 'ok' : 'bad'}`} aria-hidden />
      <div className="app-main">
        <div className="row">
          <span className="mono strong ellipsis">{x.target}</span>
          <span className="tag">{m.kinds[x.kind]}</span>
        </div>
        <p className="small muted">{details.filter(Boolean).join(' · ') || m.pending}</p>
      </div>
      <span className={`tag ${x.up === null ? '' : x.up ? 'ok' : 'danger'}`}>{x.up === null ? m.pending : x.up ? m.up : m.down}</span>
      <button className="btn sm quiet icon" title={m.check} aria-label={m.check} disabled={busy} onClick={() => void act(() => window.netplain.checkMonitor(x.id))}>
        <Icon name="refresh" className={busy ? 'spin' : undefined} />
      </button>
      <button className="btn sm quiet icon" title={m.remove} aria-label={m.remove} disabled={busy} onClick={() => void act(() => window.netplain.removeMonitor(x.id))}>
        <Icon name="close" />
      </button>
    </div>
  )
}

/** The user's sites and servers, with a form to add one. */
export default function Monitors() {
  const t = useT()
  const m = t.monitors
  const [state, setState] = useState<{ list: MonitorState[]; now: number } | null>(null)
  const [kind, setKind] = useState<MonitorKind>('http')
  const [target, setTarget] = useState('')
  const [every, setEvery] = useState<60 | 300>(300)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const show = (list: MonitorState[]) => setState({ list, now: Date.now() })

  useEffect(() => {
    const load = () => window.netplain.monitors().then((list) => setState({ list, now: Date.now() }), () => {})
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      show(await window.netplain.addMonitor(kind, target, every))
      setTarget('')
    } catch (x) {
      setErr(x)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section">
      <div className="section-head">
        <h3>{m.title}</h3>
      </div>
      <p className="section-lead small muted">{m.lead}</p>
      <form className="panel panel-pad row monitor-form" onSubmit={(e) => void add(e)}>
        <select className="select sm" value={kind} aria-label={m.kinds[kind]} onChange={(e) => setKind(e.target.value as MonitorKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {m.kinds[k]}
            </option>
          ))}
        </select>
        <input className="input sm mono" value={target} placeholder={m.placeholder[kind]} aria-label={m.target} onChange={(e) => setTarget(e.target.value)} />
        <select className="select sm" value={every} aria-label={m.every[every]} onChange={(e) => setEvery(Number(e.target.value) as 60 | 300)}>
          {([60, 300] as const).map((s) => (
            <option key={s} value={s}>
              {m.every[s]}
            </option>
          ))}
        </select>
        <button className="btn sm primary" type="submit" disabled={busy || !target.trim()}>
          {busy && <Icon name="refresh" className="spin" />}
          {m.add}
        </button>
      </form>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      {state &&
        (state.list.length === 0 ? (
          <p className="muted list-empty">{m.none}</p>
        ) : (
          <div className="list monitor-list">
            {state.list.map((x) => (
              <Row key={x.id} t={t} x={x} now={state.now} onChange={show} />
            ))}
          </div>
        ))}
    </section>
  )
}
