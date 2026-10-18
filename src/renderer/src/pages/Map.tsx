import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { Connections, Hop } from '../../../shared/types'
import { bytes } from '../../../shared/format'
import { countryName } from '../explain'
import { useGeo } from '../geo'
import { useRun } from '../hooks'
import { getLang, useT, type Dict } from '../i18n'
import { useLive } from '../live'
import { byCountry, routeOf, type CountryFlow, type Spot } from '../mapdata'
import { ErrNote, Icon, Page } from '../ui'
import world from '../world.json'

/** A point on the map: x, y in the viewBox. */
type Pt = number[]
const COUNTRIES: Record<string, { d: string; at: Pt }> = world.countries
/** Arcs drawn; the list below has every country. */
const ARCS = 30

/** This computer's country (by its public address), asked once per run. */
let home: Promise<string | null> | null = null
const homeCountry = () =>
  (home ??= window.netplain.publicIp().then(
    (p) => p.country,
    () => ((home = null), null)
  ))

/** A curve from a to b bent to one side, so the two directions between the same places both show. */
function arc(a: Pt, b: Pt, side: 1 | -1) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const c = [(a[0] + b[0]) / 2 - dy * 0.18 * side, (a[1] + b[1]) / 2 + dx * 0.18 * side]
  return `M${a[0]},${a[1]}Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0]},${b[1]}`
}

/** What each direction of a flow measures: bytes while the traffic watch runs, else who started the connections. */
const sides = (f: CountryFlow, counted: boolean) => (counted ? { down: f.rx ?? 0, up: f.tx ?? 0 } : { down: f.inbound, up: f.conns - f.inbound })

function Amounts({ f, t, counted }: { f: CountryFlow; t: Dict; counted: boolean }) {
  const m = t.map
  const s = sides(f, counted)
  return (
    <>
      <span className="num small">
        <i className="key down" /> {counted ? bytes(s.down) : s.down}
      </span>
      <span className="num small">
        <i className="key up" /> {counted ? bytes(s.up) : s.up}
      </span>
      <span className="small faint">{m.conns(f.conns)}</span>
    </>
  )
}

export default function WorldMap() {
  const t = useT()
  const m = t.map
  const lang = getLang()
  const { traffic } = useLive()
  const [conns, setConns] = useState<Connections | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [tip, setTip] = useState<{ iso: string; x: number; y: number } | null>(null)
  const [target, setTarget] = useState<Spot | null>(null)
  const route = useRun<Hop[]>()

  const load = useCallback(() => void window.netplain.connections().then(setConns, () => {}), [])
  const geo = useGeo(load)
  useEffect(() => {
    load()
    void homeCountry().then(setMe)
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [load])

  const counted = traffic?.state === 'on'
  const flows = useMemo(() => byCountry(conns, traffic), [conns, traffic])
  const shown = flows.filter((f) => COUNTRIES[f.country]).slice(0, ARCS)
  const max = Math.max(1, ...shown.flatMap((f) => Object.values(sides(f, counted))))
  const width = (v: number) => (v > 0 ? 2 + 4 * Math.sqrt(v / max) : 0)
  const at = (iso: string | null) => (iso ? COUNTRIES[iso]?.at : undefined)
  const origin = at(me)
  const busy = new Set(flows.map((f) => f.country))
  const name = (iso: string) => countryName(iso, lang)
  const picked = flows.find((f) => f.country === sel) ?? null

  // The route: home, then each country the routers sit in, then the destination's country.
  const stops = routeOf(route.res ?? []).filter((s, i) => !(i === 0 && s.country === me))
  const stopAt = stops.map((s) => at(s.country)).filter((p): p is Pt => !!p)
  const path = [origin, ...stopAt, route.res && stops.at(-1)?.country !== sel ? at(sel) : undefined].filter((p): p is Pt => !!p)

  const hover = (iso: string) => (e: MouseEvent) => {
    const box = (e.currentTarget as Element).closest('.map-box')!.getBoundingClientRect()
    setTip({ iso, x: e.clientX - box.left, y: e.clientY - box.top })
  }
  const pick = (iso: string) => {
    setSel(iso)
    setTarget(null)
  }
  const tipFlow = tip && flows.find((f) => f.country === tip.iso)

  return (
    <Page title={m.title} note={m.lead}>
      {geo.info && !geo.info.ready && (
        <div className="note row geo-banner">
          <Icon name="globe" />
          <span className="spacer">{t.connections.geoBanner}</span>
          <button className="btn sm primary" onClick={geo.update} disabled={geo.busy}>
            <Icon name="down" className={geo.busy ? 'spin' : undefined} />
            {geo.busy ? t.settings.geoBusy : t.settings.geoDownload}
          </button>
        </div>
      )}
      <ErrNote e={geo.err} />

      <section className="panel map-panel">
        <div className="row map-legend small">
          <span className="row">
            <i className="key down" /> {counted ? m.received : m.theyStarted}
          </span>
          <span className="row">
            <i className="key up" /> {counted ? m.sent : m.youStarted}
          </span>
          <span className="spacer" />
          {geo.info?.ready && <span className="faint">{me ? m.from(name(me)) : m.noHome}</span>}
        </div>
        <div className="map-box" onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${world.w} ${world.h}`} className="world" role="img" aria-label={m.title}>
            {Object.entries(COUNTRIES).map(([iso, c]) =>
              c.d ? (
                <path key={iso} d={c.d} className={`land ${busy.has(iso) ? 'busy' : ''} ${iso === sel ? 'on' : ''}`} onMouseMove={busy.has(iso) ? hover(iso) : undefined} onClick={busy.has(iso) ? () => pick(iso) : undefined} />
              ) : null
            )}
            {origin &&
              shown.map((f) => {
                const to = at(f.country)!
                const s = sides(f, counted)
                return (
                  <g key={f.country} className="flow">
                    {s.down > 0 && <path d={arc(origin, to, -1)} className="arc down" strokeWidth={width(s.down)} />}
                    {s.up > 0 && <path d={arc(origin, to, 1)} className="arc up" strokeWidth={width(s.up)} />}
                  </g>
                )
              })}
            {shown.map((f) => {
              const [x, y] = at(f.country)!
              return (
                <g key={f.country} className={`place ${f.country === sel ? 'on' : ''}`} onMouseMove={hover(f.country)} onClick={() => pick(f.country)}>
                  <circle cx={x} cy={y} r={10} className="hit" />
                  <circle cx={x} cy={y} r={4} />
                </g>
              )
            })}
            {path.length > 1 && <path d={`M${path.map((p) => p.join(',')).join('L')}`} className="route" />}
            {stopAt.map(([x, y], i) => (
              <g key={i} className="stop">
                <circle cx={x} cy={y} r={8} />
                <text x={x} y={y + 3}>
                  {i + 1}
                </text>
              </g>
            ))}
            {origin && (
              <g className="home">
                <circle cx={origin[0]} cy={origin[1]} r={6} />
                <text x={origin[0]} y={origin[1] - 10}>
                  {m.you}
                </text>
              </g>
            )}
          </svg>
          {tip && (
            <div className="map-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
              <strong>{name(tip.iso)}</strong>
              {tipFlow && (
                <>
                  <div className="row">
                    <Amounts f={tipFlow} t={t} counted={counted} />
                  </div>
                  <div className="small faint ellipsis">{[...new Set(tipFlow.spots.map((s) => s.app))].slice(0, 3).join(', ')}</div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="overview-grid section">
        <section>
          <div className="section-head">
            <h3>{m.countries}</h3>
          </div>
          {flows.length === 0 ? (
            <p className="note">{!conns ? t.connections.loading : geo.info?.ready ? m.empty : m.needGeo}</p>
          ) : (
            <div className="list">
              {flows.map((f) => (
                <button key={f.country} className={`list-row mini map-row ${f.country === sel ? 'on' : ''}`} onClick={() => pick(f.country)}>
                  <span className="ellipsis spacer">{name(f.country)}</span>
                  <Amounts f={f} t={t} counted={counted} />
                </button>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="section-head">
            <h3>{picked ? name(picked.country) : m.addresses}</h3>
          </div>
          {!picked ? (
            <p className="note">{m.pick}</p>
          ) : (
            <div className="list">
              {picked.spots.map((s) => (
                <div className="list-row mini" key={s.ip}>
                  <div className="app-main">
                    <div className="ellipsis">{s.name}</div>
                    <div className="small faint ellipsis">{[s.app, s.org].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button
                    className="btn sm quiet"
                    disabled={route.busy}
                    onClick={() => {
                      setTarget(s)
                      void route.run(() => window.netplain.trace(s.ip))
                    }}
                  >
                    {route.busy && target?.ip === s.ip && <Icon name="refresh" className="spin" />}
                    {m.route}
                  </button>
                </div>
              ))}
            </div>
          )}
          {target && (
            <div className="section">
              <h3 className="map-route-title">{route.busy ? m.tracing(target.name) : m.routeTo(target.name)}</h3>
              <ErrNote e={route.err} />
              {route.res && (
                <ol className="map-stops">
                  {stops.map((s) => (
                    <li key={s.hops[0].n}>
                      <strong>{name(s.country)}</strong>
                      {s.hops.map((h) => (
                        <div className="small faint" key={h.n}>
                          <span className="mono">{h.ip}</span>
                          {[h.org, h.ms !== null && `${h.ms} ms`].filter(Boolean).map((x) => ` · ${x}`)}
                        </div>
                      ))}
                    </li>
                  ))}
                </ol>
              )}
              {route.res && <p className="small faint foot-note">{m.routeNote}</p>}
            </div>
          )}
        </section>
      </div>
    </Page>
  )
}
