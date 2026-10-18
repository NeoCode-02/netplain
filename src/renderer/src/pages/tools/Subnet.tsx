import { useState } from 'react'
import { addressKind } from '../../explain'
import { getLang, useT } from '../../i18n'
import { useLive } from '../../live'
import { contains, subnet } from '../../subnet'
import { Fact } from '../../ui'
import { internetOf } from '../../../../shared/model'

/** Subnet calculator, answered as you type; starts with this computer's own network. */
export default function Subnet() {
  const t = useT()
  const k = t.tools.subnet
  const { snap } = useLive()
  const mine = internetOf(snap)?.ipv4[0] ?? ''
  const [typed, setTyped] = useState<string | null>(null)
  const [probe, setProbe] = useState('')
  const value = typed ?? mine
  const s = subnet(value)
  const inside = s && probe.trim() ? contains(s, probe) : null

  return (
    <section className="panel panel-pad tool">
      <p className="small muted">{k.lead}</p>
      <div className="row tool-form">
        <input className="input sm mono" value={value} placeholder="192.168.1.10/24" aria-label={k.lead} onChange={(e) => setTyped(e.target.value)} />
      </div>
      {value.trim() && !s && <p className="note">{k.invalid}</p>}
      {s && (
        <>
          <dl className="facts">
            <Fact label={k.network} value={`${s.network}/${s.prefix}`} note={s.v === 4 ? t.network.address[addressKind(s.network)] : undefined} mono />
            <Fact label={k.range} value={s.first === s.last ? s.first : `${s.first} – ${s.last}`} mono />
            <Fact label={s.v === 4 ? k.hosts : k.addresses} value={s.hosts.toLocaleString(getLang())} />
            {s.broadcast && <Fact label={k.broadcast} value={s.broadcast} note={k.broadcastNote} mono />}
            {s.mask && <Fact label={k.mask} value={s.mask} mono />}
            {s.wildcard && <Fact label={k.wildcard} value={s.wildcard} note={k.wildcardNote} mono />}
          </dl>
          <div className="row tool-form">
            <input className="input sm mono" value={probe} placeholder={k.probe} aria-label={k.probe} onChange={(e) => setProbe(e.target.value)} />
            {probe.trim() && <span className={`tag ${inside ? 'ok' : ''}`}>{inside === null ? k.notIp : inside ? k.inside : k.outside}</span>}
          </div>
        </>
      )}
    </section>
  )
}
