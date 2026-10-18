import { useState } from 'react'
import type { Adapter } from '../../../shared/types'
import { addressKind, authKey, bandKey, quality, role, what } from '../explain'
import { addr, bits } from '../../../shared/format'
import { useT } from '../i18n'
import { useLive, type Point } from '../live'
import RateChart from '../RateChart'
import { Fact, Icon, KIND_ICON, Page } from '../ui'
import { internetOf } from '../../../shared/model'

function Facts({ a }: { a: Adapter }) {
  const t = useT()
  const n = t.network
  const ip = a.ipv4[0]
  return (
    <dl className="facts">
      <Fact label={n.ip} value={a.ipv4.join(', ') || n.none} note={ip ? n.address[addressKind(addr(ip))] : undefined} mono />
      {a.gateway && <Fact label={n.gateway} value={a.gateway} note={n.gatewayNote} mono />}
      {a.dns.length > 0 && <Fact label={n.dns} value={a.dns.join(', ')} note={n.dnsNote} mono />}
      {a.mac && <Fact label={n.mac} value={a.mac} note={n.macNote} mono />}
      {a.dhcp !== null && <Fact label={n.assigned} value={a.dhcp ? n.dhcp : n.manual} />}
      {/* A Wi-Fi card already shows its link rate. */}
      {a.speed && !a.wifi && <Fact label={n.linkSpeed} value={bits(a.speed)} />}
      {a.ipv6.length > 0 && <Fact label={n.ipv6} value={a.ipv6.join(', ')} mono />}
    </dl>
  )
}

function WifiCard({ a }: { a: Adapter }) {
  const n = useT().network
  const w = a.wifi!
  const band = bandKey(w.band)
  const auth = authKey(w.auth)
  return (
    <div className="wifi">
      <div className="wifi-head">
        <span className="faint small">{n.ssid}</span>
        <strong>{w.ssid || n.ssidHidden}</strong>
      </div>
      {w.signal !== null && (
        <div className="signal">
          <div className="row">
            <span className="small muted">{n.signal}</span>
            <span className="spacer" />
            <span className="small">
              <strong>{n.quality[quality(w.signal)]}</strong> · {w.signal}%
            </span>
          </div>
          <div className={`meter q-${quality(w.signal)}`} role="meter" aria-valuenow={w.signal} aria-valuemin={0} aria-valuemax={100} aria-label={n.signal}>
            <span style={{ width: `${w.signal}%` }} />
          </div>
        </div>
      )}
      <dl className="facts">
        {w.band && <Fact label={n.band} value={w.band} note={band ? n.bandNote[band] : undefined} />}
        {w.channel !== null && <Fact label={n.channel} value={String(w.channel)} />}
        {w.radio && <Fact label={n.standard} value={w.radio} />}
        {w.auth && <Fact label={n.security} value={w.auth} note={auth ? n.authNote[auth] : undefined} />}
        {w.rxMbps !== null && <Fact label={n.rate} value={bits(w.rxMbps * 1e6)} />}
      </dl>
    </div>
  )
}

function Head({ a, internetId }: { a: Adapter; internetId: string | null }) {
  const t = useT()
  const r = role(a, internetId)
  return (
    <div className="ad-head">
      <span className={`ad-icon ${r}`}>
        <Icon name={KIND_ICON[a.kind]} size={18} />
      </span>
      <div className="ad-title">
        <div className="row">
          <h3 className="ellipsis">{a.name}</h3>
          <span className="tag">{t.kind[a.kind]}</span>
          <span className={`tag ${r === 'internet' ? 'ok' : ''}`}>{t.network.role[r]}</span>
        </div>
        {a.description && a.description !== a.name && <div className="faint small ellipsis">{a.description}</div>}
      </div>
    </div>
  )
}

function InternetCard({ a, points }: { a: Adapter; points: Point[] }) {
  const t = useT()
  return (
    <section className="panel panel-pad internet">
      <Head a={a} internetId={a.id} />
      <p className="muted what">{t.what[what(a)]}</p>
      <div className="internet-grid">
        {a.wifi && <WifiCard a={a} />}
        <RateChart points={points} />
      </div>
      <Facts a={a} />
    </section>
  )
}

function AdapterRow({ a, points, internetId }: { a: Adapter; points: Point[]; internetId: string | null }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const last = points.at(-1)
  const r = role(a, internetId)
  return (
    <div className={`ad-row ${open ? 'open' : ''}`}>
      <button className="ad-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Head a={a} internetId={internetId} />
        <span className="spacer" />
        {a.ipv4[0] && <span className="mono faint">{addr(a.ipv4[0])}</span>}
        {last && (last.down > 0 || last.up > 0) && (
          <span className="ad-rate small num">
            ↓ {bits(last.down)} · ↑ {bits(last.up)}
          </span>
        )}
        <Icon name="chevron" className="chev" />
      </button>
      {open && (
        <div className="ad-body">
          <p className="muted">{t.what[what(a)]}</p>
          <p className="small faint">{r === 'down' ? t.network.down : r === 'local' && !a.gateway ? t.network.localOnly : ''}</p>
          {a.wifi && <WifiCard a={a} />}
          <Facts a={a} />
          {a.up && <RateChart points={points} />}
        </div>
      )}
    </div>
  )
}

export default function Network() {
  const t = useT()
  const { snap, hist } = useLive()
  if (!snap) return <Page title={t.network.title} note={t.network.loading} />
  const internet = internetOf(snap)
  const rest = snap.adapters.filter((a) => a !== internet)
  const on = rest.filter((a) => a.up)
  const off = rest.filter((a) => !a.up)
  const row = (a: Adapter) => <AdapterRow key={a.id} a={a} points={hist.get(a.id) ?? []} internetId={snap.defaultId} />
  return (
    <Page title={t.network.title}>
      {internet && <InternetCard a={internet} points={hist.get(internet.id) ?? []} />}
      {on.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>{t.network.others}</h3>
          </div>
          <div className="list">{on.map(row)}</div>
        </section>
      )}
      {off.length > 0 && (
        <details className="more section">
          <summary>
            <Icon name="chevron" size={14} />
            {t.network.inactive(off.length)}
          </summary>
          <div className="list">{off.map(row)}</div>
        </details>
      )}
    </Page>
  )
}
