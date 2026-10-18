import type { PcapReport } from '../../../shared/types'
import { bytes } from '../format'
import { getLang, type Dict } from '../i18n'
import { Fact } from '../ui'
import { where } from '../explain'

/** A capture file in brief: what to worry about first, then what was in it. */
export default function PcapView({ r, t }: { r: PcapReport; t: Dict }) {
  const f = t.packets.file
  const lang = getLang()
  const when = (ms: number) => new Date(ms).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'medium' })

  return (
    <>
      <dl className="facts panel panel-pad">
        <Fact label={f.packets} value={r.packets.toLocaleString(lang)} />
        <Fact label={f.size} value={bytes(r.bytes)} />
        {r.start !== null && r.end !== null && <Fact label={f.span} value={when(r.start)} note={r.end > r.start ? `– ${when(r.end)}` : undefined} />}
      </dl>

      <div className="section pcap-findings">
        {!r.credentials.length && !r.scans.length && <p className="note">{f.clean}</p>}
        {r.credentials.length > 0 && (
          <div className="note danger">
            <p>{f.creds(r.credentials.length)}</p>
            <ul>
              {r.credentials.map((c) => (
                <li key={c.n}>{f.cred(c.protocol, c.user, c.n)}</li>
              ))}
            </ul>
            <p>{f.credsWhy}</p>
          </div>
        )}
        {r.scans.length > 0 && (
          <div className="note warn">
            <p>{f.scans}</p>
            <ul>
              {r.scans.map((s) => (
                <li key={`${s.src}>${s.dst}`}>{f.scan(s.src, s.dst, s.ports)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="overview-grid section">
        <section>
          <div className="section-head">
            <h3>{f.protocols}</h3>
          </div>
          <div className="list">
            {r.protocols.map((p) => (
              <div className="list-row mini" key={p.name}>
                <span className="ellipsis spacer">{p.name}</span>
                <span className="num small muted">{f.count(p.packets)}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="section-head">
            <h3>{f.talkers}</h3>
          </div>
          <div className="list">
            {r.talkers.map((x) => (
              <div className="list-row mini" key={x.ip}>
                <div className="app-main">
                  <div className="mono ellipsis">{x.ip}</div>
                  {where(x, lang) && <div className="small faint ellipsis">{where(x, lang)}</div>}
                </div>
                <span className="num small muted">{bytes(x.bytes)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {r.names.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>{f.names}</h3>
          </div>
          <div className="pcap-names">
            {r.names.map((n) => (
              <span className="tag mono" key={n.name} title={f.count(n.count)}>
                {n.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
