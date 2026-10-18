import { useEffect } from 'react'
import type { Whois as Data } from '../../../../shared/types'
import { company, countryName } from '../../explain'
import { getLang, useT } from '../../i18n'
import { Fact } from '../../ui'
import { Ask, ErrNote, useRun } from './kit'

const DAY = 86_400_000

/** whois, from the registry itself (RDAP), with the parts people ask about. */
export default function Whois({ initial }: { initial?: string }) {
  const t = useT()
  const k = t.tools.whois
  const lang = getLang()
  const q = useRun<Data>()
  const { run } = q
  // Opened for an address (a connection's IP): answer right away.
  useEffect(() => {
    if (initial) void run(() => window.netplain.whois(initial))
  }, [initial, run])
  const w = q.res
  // Days left, rounded down; whole dates make it exact.
  const left = w?.expires ? Math.floor((Date.parse(w.expires) - Date.parse(new Date().toISOString().slice(0, 10))) / DAY) : null

  return (
    <>
      <section className="panel panel-pad tool">
        <h3>{k.title}</h3>
        <p className="small muted">{k.lead}</p>
        <Ask key={initial} initial={initial} placeholder={k.placeholder} label={k.run} busy={q.busy} onRun={(v) => void q.run(() => window.netplain.whois(v))} />
        <ErrNote t={t} e={q.err} />
      </section>

      {w && (
        <section className="section">
          <div className="section-head">
            <h3 className="mono">{w.name}</h3>
            <span className="tag">{k.kinds[w.kind]}</span>
          </div>
          <dl className="facts panel panel-pad">
            <Fact label={w.kind === 'ip' ? k.network : k.holder} value={w.holder ? company(w.holder) : w.kind === 'domain' ? k.hidden : '—'} note={w.about ?? undefined} />
            {w.registrar && <Fact label={k.registrar} value={w.registrar} note={k.registrarNote} />}
            {w.range && <Fact label={k.range} value={w.range} mono />}
            {w.country && <Fact label={k.country} value={countryName(w.country, lang)} />}
            {w.created && <Fact label={k.created} value={w.created} />}
            {w.expires && <Fact label={k.expires} value={w.expires} note={left === null ? undefined : left < 0 ? k.expired : k.left(left)} />}
            {w.updated && <Fact label={k.updated} value={w.updated} />}
            {w.abuse && <Fact label={k.abuse} value={w.abuse} note={k.abuseNote} mono />}
            {w.nameservers.length > 0 && <Fact label={k.nameservers} value={w.nameservers.join(', ')} mono />}
            {w.status.length > 0 && <Fact label={k.status} value={w.status.join(', ')} note={w.status.some((s) => s.includes('transfer prohibited')) ? k.locked : undefined} />}
          </dl>
          <p className="small faint foot-note">{k.source}</p>
        </section>
      )}
    </>
  )
}
