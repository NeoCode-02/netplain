import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { GO } from '../live'
import Diagnose from './tools/Diagnose'
import Dns from './tools/Dns'
import Scan from './tools/Scan'
import Speed from './tools/Speed'
import Subnet from './tools/Subnet'
import Web from './tools/Web'
import Whois from './tools/Whois'
import Wifi from './tools/Wifi'

const TABS = ['diagnose', 'speed', 'wifi', 'scan', 'dns', 'whois', 'web', 'subnet'] as const
export type ToolTab = (typeof TABS)[number]

let pending: { tab: ToolTab; value: string } | null = null
/** Opens a tool from another page, already filled in (a device's address, a connection's IP). */
export function openTool(tab: ToolTab, value: string) {
  pending = { tab, value }
  window.dispatchEvent(new CustomEvent(GO, { detail: 'tools' }))
}

export default function Tools() {
  const t = useT()
  const k = t.tools
  const [start] = useState(() => pending)
  useEffect(() => void (pending = null), [])
  const [tab, setTab] = useState<ToolTab>(start?.tab ?? 'diagnose')
  const initial = start?.tab === tab ? start.value : undefined

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <h2>{k.title}</h2>
          <p>{k.lead}</p>
        </div>
      </header>
      <div className="seg section-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
            {k.tabs[x]}
          </button>
        ))}
      </div>
      {tab === 'diagnose' && <Diagnose />}
      {tab === 'speed' && <Speed />}
      {tab === 'wifi' && <Wifi />}
      {tab === 'scan' && <Scan initial={initial} />}
      {tab === 'dns' && <Dns />}
      {tab === 'whois' && <Whois initial={initial} />}
      {tab === 'web' && <Web />}
      {tab === 'subnet' && <Subnet />}
    </div>
  )
}
