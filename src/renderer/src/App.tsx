import { useEffect, useState } from 'react'
import type { Release } from '../../shared/types'
import { errText, getLang, useT } from './i18n'
import { GO, useLive } from './live'
import Alerts from './pages/Alerts'
import Apps from './pages/Apps'
import Connections from './pages/Connections'
import Devices from './pages/Devices'
import History from './pages/History'
import Network from './pages/Network'
import Overview from './pages/Overview'
import Packets from './pages/Packets'
import Security from './pages/Security'
import Settings from './pages/Settings'
import Share from './pages/Share'
import Tools from './pages/Tools'
import Uptime from './pages/Uptime'
import { Icon, Mark, type IconName } from './ui'

export type Page = 'overview' | 'network' | 'apps' | 'connections' | 'packets' | 'devices' | 'history' | 'uptime' | 'alerts' | 'security' | 'tools' | 'share' | 'settings'
const NAV: [Page, IconName][] = [
  ['overview', 'chart'],
  ['network', 'globe'],
  ['apps', 'grid'],
  ['connections', 'link'],
  ['packets', 'list'],
  ['devices', 'devices'],
  ['history', 'clock'],
  ['uptime', 'pulse'],
  ['alerts', 'bell'],
  ['security', 'shield'],
  ['tools', 'wrench'],
  ['share', 'share']
]

export default function App() {
  const t = useT()
  const { problem, alerts } = useLive()
  const unread = alerts.filter((a) => !a.read).length
  const [page, setPage] = useState<Page>('overview')
  const [release, setRelease] = useState<Release | null>(null)
  useEffect(() => void window.netplain.update().then(setRelease), [])
  const lang = getLang()
  useEffect(() => void window.netplain.uiLang(lang), [lang])
  useEffect(() => {
    const go = (e: Event) => setPage((e as CustomEvent<Page>).detail)
    window.addEventListener(GO, go)
    return () => window.removeEventListener(GO, go)
  }, [])

  const item = (p: Page, icon: IconName) => (
    <button key={p} className={`rail-item ${page === p ? 'on' : ''}`} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>
      <Icon name={icon} />
      <span className="label">{t.nav[p]}</span>
      {p === 'alerts' && unread > 0 && <span className="badge">{unread}</span>}
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
        {release && (
          <div className="banner info" role="status">
            <Icon name="down" />
            <span className="grow">{t.update.text(release.version)}</span>
            <button className="btn sm" onClick={() => window.netplain.openUrl(release.url)}>
              {t.update.get}
            </button>
            <button className="btn sm quiet" onClick={() => setRelease(null)}>
              {t.update.later}
            </button>
          </div>
        )}
        <div className={`content ${page === 'packets' ? 'fixed' : ''}`}>
          {page === 'overview' && <Overview go={setPage} />}
          {page === 'network' && <Network />}
          {page === 'apps' && <Apps />}
          {page === 'connections' && <Connections />}
          {page === 'packets' && <Packets />}
          {page === 'devices' && <Devices />}
          {page === 'history' && <History />}
          {page === 'uptime' && <Uptime />}
          {page === 'alerts' && <Alerts />}
          {page === 'security' && <Security />}
          {page === 'tools' && <Tools />}
          {page === 'share' && <Share />}
          {page === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}
