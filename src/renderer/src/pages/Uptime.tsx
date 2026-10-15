import { useEffect, useState } from 'react'
import type { Outage, Uptime as Data } from '../../../shared/types'
import { daySummary } from '../explain'
import { getLang, useT, type Dict } from '../i18n'
import QualityChart from '../QualityChart'
import { Empty, Icon } from '../ui'

/** The connection checks, refreshed every 5 s while shown, with the time they were read. */
export function useUptime() {
  const [state, setState] = useState<{ data: Data; now: number } | null>(null)
  useEffect(() => {
    const load = () => window.netplain.uptime().then((data) => setState({ data, now: Date.now() }), () => {})
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])
  return state
}

const pct = (v: number) => (v * 100).toFixed(v >= 0.99 ? 2 : 1).replace(/\.?0+$/, '')

/** "The internet works" / "No internet since 14:32" (null before the first check), and the 24-hour line. */
export function uptimeStory(t: Dict, d: Data, now: number): { status: string | null; day: string | null; down: boolean } {
  const u = t.uptime
  const open = d.outages.find((o) => o.end === null)
  const day = daySummary(d.points, d.outages, now)
  const clock = (v: number) => new Date(v).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })
  return {
    status: open ? u.downNow(clock(open.start), u.causes[open.cause][0]) : d.now ? u.ok : null,
    day: day && u.day(pct(day.online), day.drops, day.drops ? u.span(day.longest) : null),
    down: !!open
  }
}

/** Router, internet and name lookups as of the latest check. */
export function NowTiles({ t, now }: { t: Dict; now: Data['now'] }) {
  const u = t.uptime
  const tiles: [string, string, boolean | null][] = [
    [u.router, now?.router != null ? u.ms(now.router) : now?.routerKnown ? u.noAnswer : now ? u.ignores : '—', now?.router != null ? true : now?.routerKnown ? false : null],
    [u.internet, now?.internet != null ? u.ms(now.internet) : now ? u.noAnswer : '—', now ? now.internet != null : null],
    [u.dns, now?.dns == null ? '—' : now.dns ? u.works : u.fails, now?.dns ?? null]
  ]
  return (
    <div className="uptime-now">
      {tiles.map(([label, value, good]) => (
        <div key={label} className="uptime-tile">
          <span className="small muted">{label}</span>
          <strong className={good === false ? 'bad' : undefined}>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function Row({ t, o }: { t: Dict; o: Outage }) {
  const u = t.uptime
  const lang = getLang()
  const day = new Date(o.start).toLocaleDateString(lang, { day: 'numeric', month: 'short' })
  const clock = (v: number) => new Date(v).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
  const [what, why] = u.causes[o.cause]
  return (
    <div className="list-row alert-row">
      <span className="ad-icon alert-outage">
        <Icon name="pulse" size={17} />
      </span>
      <div className="app-main">
        <div className="alert-title">{what}</div>
        <p className="small muted">{why}</p>
      </div>
      <div className="uptime-when small num">
        <span>
          {day} · {clock(o.start)}–{o.end ? clock(o.end) : '…'}
        </span>
        <span className={o.end ? 'faint' : 'tag warn'}>{o.end ? u.span(o.end - o.start) : u.going}</span>
        {o.network && <span className="faint ellipsis">{o.network}</span>}
      </div>
    </div>
  )
}

export default function Uptime() {
  const t = useT()
  const u = t.uptime
  const state = useUptime()
  if (!state) return null
  const { data, now } = state

  const turnOn = async () => {
    const s = await window.netplain.getSettings()
    await window.netplain.saveSettings({ ...s, uptime: true })
  }
  const { status, day, down } = uptimeStory(t, data, now)

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <h2>{u.title}</h2>
          <p>{u.lead}</p>
        </div>
      </header>
      {!data.on ? (
        <Empty icon="pulse" title={u.offTitle} body={u.offBody}>
          <button className="btn primary" onClick={() => void turnOn()}>
            {u.turnOn}
          </button>
        </Empty>
      ) : (
        <>
          <section className="panel panel-pad stack">
            <p className={down ? 'note danger' : 'strong'}>{status ?? u.waiting}</p>
            <NowTiles t={t} now={data.now} />
            {day && <p className="small muted">{day}</p>}
          </section>
          <section className="panel panel-pad section">
            <div className="section-head">
              <h3>{u.chart}</h3>
            </div>
            {data.points.length > 1 ? <QualityChart points={data.points} outages={data.outages} now={now} /> : <p className="list-empty">{u.waiting}</p>}
          </section>
        </>
      )}
      <section className="section">
        <div className="section-head">
          <h3>{u.outages}</h3>
        </div>
        {data.outages.length === 0 ? (
          <p className="muted list-empty">{u.none}</p>
        ) : (
          <div className="list">
            {data.outages.slice(0, 100).map((o) => (
              <Row key={o.id} t={t} o={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
