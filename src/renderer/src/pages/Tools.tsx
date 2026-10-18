import { useState } from 'react'
import { useT } from '../i18n'
import Diagnose from './tools/Diagnose'
import Subnet from './tools/Subnet'

const TABS = ['diagnose', 'subnet'] as const
type Tab = (typeof TABS)[number]

export default function Tools() {
  const t = useT()
  const k = t.tools
  const [tab, setTab] = useState<Tab>('diagnose')

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
      {tab === 'subnet' && <Subnet />}
    </div>
  )
}
