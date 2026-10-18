import type { SiteReport } from '../../../../shared/types'
import { useT } from '../../i18n'
import { Fact, Icon } from '../../ui'
import { Ask, ErrNote, useRun } from './kit'

const DAY = 86_400_000

/** A website as a browser reaches it: redirects, certificate, security headers. */
export default function Web() {
  const t = useT()
  const k = t.tools.web
  const q = useRun<SiteReport>()
  const r = q.res
  const cert = r?.tls?.chain[0]
  const left = cert ? Math.floor((Date.parse(cert.validTo) - Date.parse(new Date().toISOString().slice(0, 10))) / DAY) : null
  const good = r ? r.headers.filter((h) => h.value).length : 0
  const names = cert ? (cert.names.length > 6 ? `${cert.names.slice(0, 6).join(', ')} ${k.more(cert.names.length - 6)}` : cert.names.join(', ')) : ''

  return (
    <>
      <section className="panel panel-pad tool">
        <h3>{k.title}</h3>
        <p className="small muted">{k.lead}</p>
        <Ask placeholder={k.placeholder} label={k.run} busy={q.busy} onRun={(v) => void q.run(() => window.netplain.inspectSite(v))} />
        <ErrNote t={t} e={q.err} />
      </section>

      {r && (
        <section className="section">
          <div className="section-head">
            <h3 className="mono ellipsis">{r.url}</h3>
            <span className={`tag ${r.status < 400 ? 'ok' : 'warn'}`}>HTTP {r.status}</span>
          </div>
          <ul className="verdicts">
            {r.tls && (
              <li className={r.tls.authorized ? 'ok' : 'bad'}>
                <Icon name={r.tls.authorized ? 'check' : 'alert'} />
                {r.tls.authorized ? k.trusted : (k.tlsErrors[r.tls.error ?? ''] ?? k.untrusted(r.tls.error ?? ''))}
              </li>
            )}
            {!r.tls && (
              <li className="bad">
                <Icon name="alert" />
                {k.plain}
              </li>
            )}
            {r.upgrade !== null && (
              <li className={r.upgrade ? 'ok' : 'bad'}>
                <Icon name={r.upgrade ? 'check' : 'alert'} />
                {r.upgrade ? k.upgrades : k.noUpgrade}
              </li>
            )}
            <li className={good >= 4 ? 'ok' : 'bad'}>
              <Icon name={good >= 4 ? 'check' : 'alert'} />
              {k.headerScore(good, r.headers.length)}
            </li>
          </ul>

          {r.hops.length > 1 && (
            <>
              <h3 className="section sub-head">{k.redirects}</h3>
              <ol className="hops">
                {r.hops.map((h, i) => (
                  <li key={i} className="hop-url">
                    <span className="hop-n num">{h.status}</span>
                    <span className="mono ellipsis">{h.url}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {r.tls && cert && (
            <>
              <h3 className="section sub-head">{k.certificate}</h3>
              <dl className="facts panel panel-pad">
                <Fact label={k.names} value={names || cert.subject} mono />
                <Fact label={k.issuer} value={cert.issuer} />
                <Fact label={k.validTo} value={cert.validTo} note={left === null ? undefined : left < 0 ? k.expired : k.left(left)} />
                <Fact label={k.protocol} value={[r.tls.protocol, r.tls.cipher].filter(Boolean).join(' · ')} note={r.tls.protocol === 'TLSv1' || r.tls.protocol === 'TLSv1.1' ? k.oldTls : undefined} mono />
                <Fact label={k.chain} value={r.tls.chain.map((c) => c.subject).join(' → ')} />
              </dl>
            </>
          )}

          <h3 className="section sub-head">{k.headers}</h3>
          <div className="list">
            {r.headers.map((h) => (
              <div className="list-row" key={h.key}>
                <div className="app-main">
                  <div className="alert-title">{k.header[h.key][0]}</div>
                  <p className="small muted">{k.header[h.key][1]}</p>
                  {h.value && <p className="small mono faint ellipsis">{h.value}</p>}
                </div>
                <span className={`tag ${h.value ? 'ok' : ''}`}>{h.value ? k.present : k.missing}</span>
              </div>
            ))}
          </div>
          {r.server && <p className="small faint foot-note">{k.server(r.server)}</p>}
        </section>
      )}
    </>
  )
}
