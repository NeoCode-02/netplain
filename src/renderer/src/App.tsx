import { useState } from 'react'
import { errText, useT } from './i18n'
import { useLive } from './live'
import Apps from './pages/Apps'
import Connections from './pages/Connections'
import Devices from './pages/Devices'
import Network from './pages/Network'
import Overview from './pages/Overview'
import Packets from './pages/Packets'
import Settings from './pages/Settings'
import { Icon, Mark, type IconName } from './ui'

export type Page = 'overview' | 'network' | 'apps' | 'connections' | 'packets' | 'devices' | 'settings'
const NAV: [Page, IconName][] = [
  ['overview', 'chart'],
  ['network', 'globe'],
  ['apps', 'grid'],
  ['connections', 'link'],
  ['packets', 'list'],
  ['devices', 'devices']
]

export default function App() {
  const t = useT()
  const { problem } = useLive()
  const [page, setPage] = useState<Page>('overview')

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
        <div className={`content ${page === 'packets' ? 'fixed' : ''}`}>
          {page === 'overview' && <Overview go={setPage} />}
          {page === 'network' && <Network />}
          {page === 'apps' && <Apps />}
          {page === 'connections' && <Connections />}
          {page === 'packets' && <Packets />}
          {page === 'devices' && <Devices />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}
