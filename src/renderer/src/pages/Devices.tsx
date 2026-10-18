import { useEffect, useState } from 'react'
import type { Adapter, Neighbor } from '../../../shared/types'
import { adapterOf, randomMac } from '../explain'
import { useAction } from '../hooks'
import { useT } from '../i18n'
import { useLive } from '../live'
import { Empty, ErrNote, Icon, Page } from '../ui'
import { openTool } from './Tools'

const ipNum = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0)

function DeviceRow({ n, adapter, onWake }: { n: Neighbor; adapter?: Adapter; onWake(mac: string): void }) {
  const d = useT().devices
  const router = adapter?.gateway === n.ip
  const random = !n.vendor && randomMac(n.mac)
  const title = router ? d.router : (n.vendor ?? (random ? d.randomMac : d.unknown))
  const note = router ? [n.vendor, d.routerNote].filter(Boolean).join(' · ') : random ? d.randomNote : adapter?.kind === 'virtual' ? d.vmNote : ''
  return (
    <div className="list-row dev-row">
      <span className={`ad-icon ${router ? 'internet' : ''}`}>
        <Icon name={router ? 'router' : random ? 'phone' : adapter?.kind === 'virtual' ? 'box' : 'monitor'} size={17} />
      </span>
      <div className="dev-main">
        <div className="dev-title ellipsis">{title}</div>
        {note && <div className="small faint">{note}</div>}
      </div>
      <span className="mono">{n.ip}</span>
      <span className="mono faint dev-mac">{n.mac}</span>
      <div className="row-actions">
        <button className="btn sm quiet" title={d.portsNote} onClick={() => openTool('scan', n.ip)}>
          {d.ports}
        </button>
        {/* Phones (private MACs), routers and virtual machines do not wake this way. */}
        {!router && !random && adapter?.kind !== 'virtual' && (
          <button className="btn sm quiet" title={d.wakeNote} onClick={() => onWake(n.mac)}>
            {d.wake}
          </button>
        )}
      </div>
    </div>
  )
}

export default function Devices() {
  const t = useT()
  const d = t.devices
  const { snap } = useLive()
  const [list, setList] = useState<Neighbor[] | null>(null)
  const [scanned, setScanned] = useState(false)
  const [woke, setWoke] = useState<string | null>(null)
  const { busy: running, err, run } = useAction()
  const busy = running === 'scan'

  useEffect(() => void run('load', () => window.netplain.neighbors()).then((l) => l && setList(l)), [run])

  const scan = () =>
    run('scan', async () => {
      setList(await window.netplain.scan())
      setScanned(true)
    })

  const wake = (mac: string) => {
    setWoke(null)
    void run('wake', async () => {
      await window.netplain.wake(mac)
      setWoke(mac)
    })
  }

  const adapters = snap?.adapters ?? []
  const groups = new Map<string, { adapter?: Adapter; items: Neighbor[] }>()
  for (const n of list ?? []) {
    const adapter = adapterOf(n, adapters)
    const key = adapter?.id ?? n.via
    const g = groups.get(key) ?? { adapter, items: [] }
    g.items.push(n)
    groups.set(key, g)
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.adapter?.id === snap?.defaultId) - Number(a.adapter?.id === snap?.defaultId))
  const noVendors = !!list?.length && list.every((n) => !n.vendor)
  // Before a scan only the devices this computer talked to show up — usually just the router.
  const few = !!list && list.length > 0 && list.length <= 2 && !busy

  return (
    <Page
      title={d.title}
      note={d.lead}
      actions={
        !(few && !scanned) && (
          <button className="btn primary" onClick={scan} disabled={busy}>
            <Icon name="refresh" className={busy ? 'spin' : undefined} />
            {busy ? d.scanning : d.scan}
          </button>
        )
      }
    >
      <ErrNote e={err} />
      {woke && <p className="note">{d.woke(woke)}</p>}
      {noVendors && <p className="note">{d.noVendors}</p>}
      {list && list.length === 0 && <Empty icon="devices" title={d.empty} body={d.emptyBody} />}
      {few && (
        <div className="note row devices-hint">
          <span className="spacer">{scanned ? d.scanNone : d.fewHint}</span>
          {!scanned && (
            <button className="btn sm primary" onClick={scan}>
              <Icon name="refresh" />
              {d.scan}
            </button>
          )}
        </div>
      )}
      {sorted.map((g) => (
        <section className="section" key={g.adapter?.id ?? g.items[0].via}>
          <div className="section-head">
            <h3>{g.adapter?.name ?? g.items[0].via}</h3>
            <span className="small faint">{d.count(g.items.length)}</span>
          </div>
          <div className="list">
            {g.items
              .sort((a, b) => Number(b.ip === g.adapter?.gateway) - Number(a.ip === g.adapter?.gateway) || ipNum(a.ip) - ipNum(b.ip))
              .map((n) => (
                <DeviceRow key={n.ip + n.mac} n={n} adapter={g.adapter} onWake={wake} />
              ))}
          </div>
        </section>
      ))}
      <p className="small faint foot-note">{d.scanNote}</p>
    </Page>
  )
}
