import { useState } from 'react'
import type { DnsAnswer, DnsReport, RecordType } from '../../../../shared/types'
import { useT } from '../../i18n'
import { ErrNote, Fact } from '../../ui'
import { Ask } from './kit'
import { useRun } from '../../hooks'

const TYPES: RecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV']
const same = (a: DnsAnswer, b: DnsAnswer) => a.records.join('\n') === b.records.join('\n')

/** dig, with every answer compared across four servers and mail records explained. */
export default function Dns() {
  const t = useT()
  const k = t.tools.dns
  const [type, setType] = useState<RecordType>('A')
  const q = useRun<DnsReport>()
  const r = q.res
  const main = r && (r.answers.find((a) => a.records.length) ?? r.answers[0])
  const differs = !!r && r.answers.some((a) => a.records.length && main && !same(a, main))

  return (
    <>
      <section className="panel panel-pad tool">
        <p className="small muted">{k.lead}</p>
        <Ask placeholder={k.placeholder} label={k.run} busy={q.busy} onRun={(name) => void q.run(() => window.netplain.dnsQuery(name, type))} />
        <div className="row tool-form">
          <div className="seg" role="group" aria-label={k.type}>
            {TYPES.map((x) => (
              <button key={x} type="button" className={type === x ? 'on' : ''} aria-pressed={type === x} title={k.types[x]} onClick={() => setType(x)}>
                {x}
              </button>
            ))}
          </div>
        </div>
        <p className="small faint tool-out">{k.types[type]}</p>
        <ErrNote e={q.err} />
      </section>

      {r && main && (
        <section className="section">
          <div className="section-head">
            <h3>{k.answer(r.type, r.name)}</h3>
          </div>
          {main.records.length ? (
            <div className="panel panel-pad dns-records">
              {main.records.map((x) => (
                <p key={x} className="mono">
                  {x}
                </p>
              ))}
            </div>
          ) : (
            <p className="note">{k.errors[main.error ?? 'none']}</p>
          )}

          <div className="section-head section">
            <div>
              <h3>{k.servers}</h3>
              {differs && <p>{k.differs}</p>}
            </div>
          </div>
          <div className="list">
            {r.answers.map((a) => (
              <div className="list-row" key={a.server}>
                <div className="app-main">
                  <div className="alert-title">{a.server === 'system' ? k.system : a.server}</div>
                  <p className="small mono faint">{a.ip}</p>
                </div>
                <span className="num small muted">{a.error === 'timeout' ? '' : `${a.ms} ms`}</span>
                <span className={`tag ${a.error && a.error !== 'none' && a.error !== 'nxdomain' ? 'warn' : same(a, main) ? 'ok' : ''}`}>
                  {a.records.length ? (same(a, main) ? k.same : k.different) : k.short[a.error ?? 'none']}
                </span>
              </div>
            ))}
          </div>

          {r.mail && (
            <>
              <div className="section-head section">
                <div>
                  <h3>{k.mail}</h3>
                  <p>{k.mailLead}</p>
                </div>
              </div>
              <dl className="facts panel panel-pad">
                <Fact label="SPF" value={k.spf[r.mail.spf]} note={r.mail.spfRecord ?? undefined} />
                <Fact label="DMARC" value={k.dmarc[r.mail.dmarc]} note={r.mail.dmarcRecord ?? undefined} />
              </dl>
            </>
          )}
        </section>
      )}
    </>
  )
}
