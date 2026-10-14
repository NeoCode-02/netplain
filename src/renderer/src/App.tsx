import { useState } from 'react'
import { errText, useT } from './i18n'
import { useLive } from './live'
import Devices from './pages/Devices'
import Network from './pages/Network'
import Settings from './pages/Settings'
import { Icon, Mark, type IconName } from './ui'

type Page = 'network' | 'devices' | 'settings'
const NAV: [Page, IconName][] = [
  ['network', 'globe'],
  ['devices', 'devices']
]

export default function App() {
  const t = useT()
  const { problem } = useLive()
  const [page, setPage] = useState<Page>('network')

  const item = (p: Page, icon: IconName) => (
    <button key={p} className={`rail-item ${page === p ? 'on' : ''}`} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>
      <Icon name={icon} />
      <span className="label">{t.nav[p]}</span>
    </button>
  )

  return (
    <div className="app">
      <nav className="rail" aria-label="Netplain">
        <div className="brand drag">
          <Mark />
          Netplain
        </div>
        <div className="rail-list">{NAV.map(([p, icon]) => item(p, icon))}</div>
        <div className="rail-foot">{item('settings', 'sliders')}</div>
      </nav>
      <main className="main">
        <div className="titlebar drag" />
        {problem && (
          <div className="banner" role="status">
            <Icon name="alert" />
            {errText(t, problem)}
          </div>
        )}
        <div className="content">
          {page === 'network' && <Network />}
          {page === 'devices' && <Devices />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}
