import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Conn, Connections as Data } from '../../../shared/types'
import { addressKind, company, countryName, listJoin, service } from '../explain'
import { useGeo } from '../geo'
import { getLang, useT, type Dict } from '../i18n'
import { AppIcon, ErrNote, Icon, Page } from '../ui'
import { openTool } from './Tools'
import { BlockApp, blockable, ours, TwoStep } from './TwoStep'

type Filter = 'internet' | 'local' | 'all'

const WINDOWS = /Windows/.test(navigator.userAgent)

/** Grouping key: the same in every language. */
const label = (c: Conn) => c.title ?? c.app
const shown = (c: Conn, t: Dict) => c.title ?? t.procs[c.app] ?? c.app
const where = (c: Conn, lang: string) => [c.org && company(c.org), c.country && countryName(c.country, lang)].filter(Boolean).join(' · ')

function Service({ t, c, port }: { t: Dict; c: Conn; port: number | null }) {
  const key = service(c.proto, port)
  const s = key ? t.services[key] : null
  return s ? (
    <span title={s[1]}>
      {s[0]} <small className="faint">· {s[1]}</small>
    </span>
  ) : t.procs[c.app] ? (
    <span className="faint">{t.connections.windowsOwn}</span>
  ) : (
    <span className="faint">
      {c.proto.toUpperCase()} {port}
    </span>
  )
}

interface Group {
  key: string
  title: string
  app: string
  path: string | null
  conns: Conn[]
}

/** Several sockets to the same place in the same state read as one row with a count. */
function rows(conns: Conn[]): [Conn, number][] {
  const out = new Map<string, [Conn, number]>()
  for (const c of conns) {
    const key = `${c.remoteIp}|${c.remotePort}|${c.proto}|${c.state}`
    const r = out.get(key)
    if (r) r[1]++
    else out.set(key, [c, 1])
  }
  return [...out.values()]
}

function AppGroup({ g, t, lang }: { g: Group; t: Dict; lang: string }) {
  const [open, setOpen] = useState(false)
  const orgs = [...new Set(g.conns.flatMap((c) => (c.org ? [company(c.org)] : [])))].slice(0, 3)
  return (
    <div className={`ad-row ${open ? 'open' : ''}`}>
      <button className="ad-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <AppIcon path={g.path} />
        <div className="ad-title">
          <h3 className="ellipsis">{g.title}</h3>
          <div className="faint small ellipsis">
            {g.title !== g.app ? `${g.app} · ` : ''}
            {t.connections.count(g.conns.length)}
          </div>
        </div>
        <span className="spacer" />
        <span className="row orgs">
          {orgs.map((o) => (
            <span key={o} className="tag">
              {o}
            </span>
          ))}
        </span>
        <Icon name="chevron" className="chev" />
      </button>
      {open && blockable(g.path) && <BlockApp t={t} path={g.path} />}
      {open && (
        <table className="table conn-table">
          <thead>
            <tr>
              <th>{t.connections.address}</th>
              <th>{t.connections.company}</th>
              <th>{t.connections.service}</th>
              <th>{t.connections.state}</th>
              {WINDOWS && <th aria-label={t.connections.blockIp} />}
            </tr>
          </thead>
          <tbody>
            {rows(g.conns).map(([c, n], i) => (
              <tr key={i}>
                <td>
                  {c.host && <div className="ellipsis">{c.host}</div>}
                  <div className={`mono ${c.host ? 'faint' : ''}`}>
                    {c.remoteIp && addressKind(c.remoteIp) === 'public' ? (
                      <button className="ip-link" title={t.tools.whois.open} onClick={() => openTool('whois', c.remoteIp!)}>
                        {c.remoteIp}
                      </button>
                    ) : (
                      c.remoteIp
                    )}
                    {n > 1 && <span className="times">×{n}</span>}
                  </div>
                </td>
                <td className="ellipsis">{where(c, lang) || <span className="faint">—</span>}</td>
                <td className="ellipsis">
                  <Service t={t} c={c} port={c.remotePort} />
                </td>
                <td>{t.connections.states[c.state] ?? c.state}</td>
                {WINDOWS && (
                  <td className="conn-block">{c.remoteIp && addressKind(c.remoteIp) === 'public' && <TwoStep t={t} label={t.connections.blockIp} title={t.connections.blockIpNote} sure={t.connections.sure} done={t.connections.done} run={() => window.netplain.block({ ip: c.remoteIp! })} />}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Connections() {
  const t = useT()
  const c = t.connections
  const lang = getLang()
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [filter, setFilter] = useState<Filter>('internet')
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    window.netplain.connections().then((d) => {
      setData(d)
      setErr(null)
    }, setErr)
  }, [])
  const geo = useGeo(load)

  useEffect(() => {
    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [load])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, Group>()
    for (const x of data?.conns ?? []) {
      if (filter === 'internet' && x.scope !== 'internet') continue
      if (filter === 'local' && x.scope === 'internet') continue
      if (q && ![x.app, x.title, t.procs[x.app], x.host, x.remoteIp, x.org, x.country && countryName(x.country, lang)].some((v) => v?.toLowerCase().includes(q))) continue
      const key = label(x)
      const g = out.get(key) ?? { key, title: shown(x, t), app: x.app, path: x.path, conns: [] }
      g.path ??= x.path
      g.conns.push(x)
      out.set(key, g)
    }
    return [...out.values()].sort((a, b) => b.conns.length - a.conns.length || a.title.localeCompare(b.title))
  }, [data, filter, query, lang, t])

  const internet = (data?.conns ?? []).filter((x) => x.scope === 'internet')
  const apps = new Set(internet.map(label)).size
  const places = new Set(internet.map((x) => x.remoteIp)).size
  const byOrg = new Map<string, number>()
  for (const x of internet) if (x.org) byOrg.set(company(x.org), (byOrg.get(company(x.org)) ?? 0) + 1)
  const top = [...byOrg].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([o]) => o)

  // A program listening on both IPv4 and IPv6 is one open port.
  const ports = new Map<string, Conn>()
  for (const x of data?.listening ?? []) ports.set(`${x.localPort}|${x.pid}|${x.scope}`, x)
  // The search box also finds a port by number or by the program holding it ("who has 3000?").
  const q = query.trim().toLowerCase()
  const sorted = [...ports.values()].filter((x) => !q || String(x.localPort).startsWith(q) || shown(x, t).toLowerCase().includes(q)).sort((a, b) => a.localPort - b.localPort)
  const exposed = sorted.filter((x) => x.scope !== 'loopback')
  const inside = sorted.filter((x) => x.scope === 'loopback')
  const port = (x: Conn) => (
    <div className="list-row port-row" key={`${x.localPort}:${x.pid}:${x.scope}`}>
      <span className="mono port">{x.localPort}</span>
      <AppIcon path={x.path} />
      <div className="dev-main">
        <div className="ellipsis">{shown(x, t)}</div>
        <div className="small faint ellipsis">
          <Service t={t} c={x} port={x.localPort} />
        </div>
      </div>
      <span className={`tag ${x.scope === 'loopback' ? '' : 'warn'}`} title={x.scope === 'loopback' ? undefined : c.exposedNote}>
        {x.scope === 'loopback' ? c.localOnly : c.exposed}
      </span>
      {x.pid !== null && ours(x.path) && <TwoStep t={t} label={c.stop} title={c.stopNote} sure={c.stopSure} done={c.stopped} run={() => window.netplain.stopProcess(x.pid!)} />}
    </div>
  )

  return (
    <Page title={c.title} note={!data ? c.loading : apps ? `${c.summary(apps, places)}${top.length ? ` ${c.mostly(listJoin(top, lang))}` : ''}` : c.none}>

      {geo.info && !geo.info.ready && (
        <div className="note row geo-banner">
          <Icon name="globe" />
          <span className="spacer">{c.geoBanner}</span>
          <button className="btn sm primary" onClick={geo.update} disabled={geo.busy}>
            <Icon name="down" className={geo.busy ? 'spin' : undefined} />
            {geo.busy ? t.settings.geoBusy : t.settings.geoDownload}
          </button>
        </div>
      )}
      <ErrNote e={geo.err} />
      <ErrNote e={err} />

      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input className="input" type="search" placeholder={c.search} aria-label={c.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="seg" role="group">
          {(['internet', 'local', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {c.scope[f]}
            </button>
          ))}
        </div>
      </div>

      {data && (groups.length ? <div className="list">{groups.map((g) => <AppGroup key={g.key} g={g} t={t} lang={lang} />)}</div> : <p className="list-empty">{query ? c.nothing : c.none}</p>)}

      <section className="section">
        <div className="section-head">
          <div>
            <h3>{c.listening}</h3>
            <p>{c.listeningLead}</p>
          </div>
        </div>
        {data && data.listening.length === 0 && <p className="list-empty">{c.noListening}</p>}
        {exposed.length > 0 && <div className="list">{exposed.map(port)}</div>}
        {inside.length > 0 && (
          <details className="more section">
            <summary>
              <Icon name="chevron" size={14} />
              {c.localOnly} ({inside.length})
            </summary>
            <div className="list">{inside.map(port)}</div>
          </details>
        )}
      </section>

      <p className="small faint foot-note">
        {/Windows/.test(navigator.userAgent) ? c.limits : `${c.limitsUnix} ${c.limits}`}
        {geo.info?.ready && (
          <>
            {' '}
            <a href="https://db-ip.com" target="_blank" rel="noreferrer">
              {t.settings.geoCredit}
            </a>
          </>
        )}
      </p>
    </Page>
  )
}
