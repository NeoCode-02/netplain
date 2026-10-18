import type { Exposure as Data } from '../../../shared/types'
import { RISKY, service, where } from '../explain'
import { getLang, type Dict } from '../i18n'
import { ErrNote, Fact, Icon } from '../ui'
import { useRun } from '../hooks'

const SHOW_VULNS = 12
const nvd = (cve: string) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`

/** The network as strangers on the internet see it: Shodan's record of the public address, and UPnP openings. */
/** `q` lives in the page, so the report can include the last check. */
export default function Exposure({ t, q }: { t: Dict; q: ReturnType<typeof useRun<Data>> }) {
  const x = t.security.exposure
  const e = q.res
  const nat = e && x.nat[e.nat]
  const db = e?.db

  return (
    <>
      <section className="panel panel-pad tool">
        <p className="small muted">{x.lead}</p>
        <div className="row tool-form">
          <button className="btn sm primary" disabled={q.busy} onClick={() => void q.run(() => window.netplain.exposure())}>
            {q.busy && <Icon name="refresh" className="spin" />}
            {x.run}
          </button>
        </div>
        <ErrNote e={q.err} />
      </section>

      {e && (
        <>
          <section className="section">
            <dl className="facts panel panel-pad">
              <Fact label={x.address} value={e.ip} note={where(e, getLang()) || undefined} mono />
              {nat && <Fact label="NAT" value={nat[0]} note={nat[1]} />}
            </dl>
          </section>

          <section className="section">
            <div className="section-head">
              <h3>{x.shodan}</h3>
            </div>
            {!db?.ports.length ? (
              <p className="note">{x.shodanNone}</p>
            ) : (
              <div className="list">
                {db.ports.map((p) => {
                  const key = service('tcp', p)
                  const [name, what] = key ? t.services[key] : [t.tools.scan.unknown, '']
                  return (
                    <div className="list-row" key={p}>
                      <span className="mono scan-port">{p}</span>
                      <div className="app-main">
                        <div className="alert-title">{name}</div>
                        {what && <p className="small muted">{what}</p>}
                      </div>
                      {key && RISKY.has(key) && (
                        <span className="tag warn" title={t.tools.scan.riskyNote}>
                          {t.tools.scan.risky}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {!!db?.vulns.length && (
              <p className="note warn">
                {x.vulns(db.vulns.length)}{' '}
                {db.vulns.slice(0, SHOW_VULNS).map((v, i) => (
                  <span key={v}>
                    {i > 0 && ', '}
                    <a className="mono" href={nvd(v)} onClick={(ev) => (ev.preventDefault(), window.netplain.openUrl(nvd(v)))}>
                      {v}
                    </a>
                  </span>
                ))}
                {db.vulns.length > SHOW_VULNS && ` ${x.more(db.vulns.length - SHOW_VULNS)}`}
              </p>
            )}
            {!!db?.tags.length && (
              <div className="row">
                {db.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {!!db?.ports.length && <p className="small faint foot-note">{x.shodanNote}</p>}
          </section>

          <section className="section">
            <div className="section-head">
              <h3>{x.router}</h3>
              {e.upnp?.router && <span className="small faint">{e.upnp.router}</span>}
            </div>
            {!e.upnp ? (
              <p className="note">{x.upnpOff}</p>
            ) : (
              <>
                {e.upnp.maps.length === 0 ? (
                  <p className="note">{x.upnpNone}</p>
                ) : (
                  <div className="list">
                    {e.upnp.maps.map((m) => (
                      <div className="list-row" key={`${m.protocol}${m.external}`}>
                        <span className="mono scan-port">{m.external}</span>
                        <div className="app-main">
                          <div className="alert-title">{m.description || `${m.protocol} ${m.external}`}</div>
                          <p className="small muted mono">
                            {m.protocol} → {m.client}:{m.internal}
                          </p>
                        </div>
                        {!m.enabled && <span className="tag">{x.off}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <p className="note warn">{x.upnpWhy}</p>
              </>
            )}
          </section>
        </>
      )}
    </>
  )
}
