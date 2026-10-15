import { useEffect, useState } from 'react'
import type { Connections, Neighbor } from '../../../shared/types'
import type { Page } from '../App'
import { company, listJoin, quality, summary } from '../explain'
import { bits, bytes } from '../format'
import { getLang, useT } from '../i18n'
import { useLive } from '../live'
import RateChart from '../RateChart'
import { AppIcon, Icon } from '../ui'
import { NowTiles, uptimeStory, useUptime } from './Uptime'

export default function Overview({ go }: { go: (p: Page) => void }) {
  const t = useT()
  const o = t.overview
  const lang = getLang()
  const { snap, hist, traffic } = useLive()
  const [conns, setConns] = useState<Connections | null>(null)
  const [devices, setDevices] = useState<Neighbor[] | null>(null)
  const up = useUptime()
  const steady = up?.data.on ? uptimeStory(t, up.data, up.now) : null

  useEffect(() => {
    const load = () => window.netplain.connections().then(setConns, () => {})
    load()
    window.netplain.neighbors().then(setDevices, () => {})
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  const internet = snap?.adapters.find((a) => a.id === snap.defaultId)
  const points = internet ? (hist.get(internet.id) ?? []) : []
  const now = points.at(-1)
  const watching = traffic?.state === 'on'
  const apps = (traffic?.apps ?? []).filter((a) => a.key !== '?')
  const top = apps[0]

  // Companies by bytes when traffic is watched, else by number of connections.
  const byOrg = new Map<string, number>()
  if (watching) for (const a of apps) for (const p of a.places) if (p.org) byOrg.set(company(p.org), (byOrg.get(company(p.org)) ?? 0) + p.rx + p.tx)
  else for (const c of conns?.conns ?? []) if (c.org) byOrg.set(company(c.org), (byOrg.get(company(c.org)) ?? 0) + 1)
  const orgs = [...byOrg].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const online = (conns?.conns ?? []).filter((c) => c.scope === 'internet')
  const talking = new Set(online.map((c) => c.title ?? c.app)).size
  const exposed = new Set((conns?.listening ?? []).filter((c) => c.scope !== 'loopback').map((c) => `${c.localPort}|${c.pid}`)).size

  const story = [
    steady?.down && steady.status,
    snap && summary(t, snap.adapters, snap.defaultId),
    internet?.wifi?.signal != null && o.signal(t.network.quality[quality(internet.wifi.signal)], internet.wifi.signal),
    now && o.speed(bits(now.down), bits(now.up)),
    top ? o.topApp(top.title ?? t.procs[top.app] ?? top.app, bytes(top.rx + top.tx), top.places[0]?.name ?? null) : traffic?.state === 'missing' ? o.noCapture : null,
    talking > 0 && o.talking(talking, listJoin(orgs.slice(0, 3).map(([n]) => n), lang)),
    devices && devices.length > 0 && o.devices(devices.length),
    exposed > 0 && o.exposed(exposed),
    !steady?.down && steady?.day
  ].filter((s): s is string => !!s)

  const more = (p: Page) => (
    <button className="btn quiet sm" onClick={() => go(p)}>
      {o.more}
      <Icon name="chevron" size={14} />
    </button>
  )

  return (
    <div className="page wide">
      <header className="page-head">
        <h2>{o.title}</h2>
      </header>
      <ul className="story">
        {story.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <section className="panel panel-pad section">
        <div className="section-head">
          <h3>{o.traffic}</h3>
          {more('network')}
        </div>
        <RateChart points={points} />
      </section>

      {up?.data.on && (
        <section className="panel panel-pad section">
          <div className="section-head">
            <h3>{t.uptime.title}</h3>
            {more('uptime')}
          </div>
          <NowTiles t={t} now={up.data.now} />
        </section>
      )}

      <div className="overview-grid section">
        <section className="panel">
          <div className="section-head card-pad">
            <h3>{o.topApps}</h3>
            {more('apps')}
          </div>
          {apps.length === 0 && <p className="list-empty">{traffic?.state === 'missing' ? o.noCapture : o.nothing}</p>}
          {apps.slice(0, 5).map((a) => (
            <div className="list-row mini" key={a.key}>
              <AppIcon path={a.path} />
              <span className="ellipsis spacer">{a.title ?? t.procs[a.app] ?? a.app}</span>
              <span className="num small muted">{bytes(a.rx + a.tx)}</span>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="section-head card-pad">
            <h3>{o.topPlaces}</h3>
            {more('connections')}
          </div>
          {orgs.length === 0 && <p className="list-empty">{o.nothing}</p>}
          {orgs.map(([name, n]) => (
            <div className="list-row mini" key={name}>
              <span className="app-icon">
                <Icon name="globe" size={16} />
              </span>
              <span className="ellipsis spacer">{name}</span>
              <span className="num small muted">{watching ? bytes(n) : t.connections.count(n)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
