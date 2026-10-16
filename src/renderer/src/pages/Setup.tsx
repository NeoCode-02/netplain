import { useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '../../../shared/types'
import type { Page } from '../App'
import { useGeo } from '../geo'
import { getLang, LANGS, setLang, useT, type Lang } from '../i18n'
import { useLive } from '../live'
import { Icon } from '../ui'

const KEY = 'netplain.setupHidden'
const wasHidden = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
/** Shows the list again (from Settings). */
export function showSetup() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: it was never hidden either
  }
}

function Row({ n, done, title, why, children }: { n: number; done: boolean; title: string; why?: string; children?: ReactNode }) {
  return (
    <div className={`setup-row ${done ? 'done' : ''}`}>
      <span className="setup-mark" aria-hidden>
        {done ? <Icon name="check" size={14} /> : n}
      </span>
      <div className="app-main">
        <strong>{title}</strong>
        {why && <p className="small muted">{why}</p>}
      </div>
      {children}
    </div>
  )
}

/** One-time steps that unlock the most useful parts, on the Overview until done or hidden. */
export default function Setup({ go }: { go: (p: Page) => void }) {
  const t = useT()
  const s = t.setup
  const geo = useGeo()
  const { traffic } = useLive()
  const [prefs, setPrefs] = useState<Settings | null>(null)
  const [platform, setPlatform] = useState('')
  const [hidden, setHidden] = useState(wasHidden)

  useEffect(() => {
    void window.netplain.getSettings().then(setPrefs)
    void window.netplain.appInfo().then((i) => setPlatform(i.platform))
  }, [])

  const geoDone = !!geo.info?.ready
  const wireshark = !!traffic && traffic.state !== 'missing'
  const autostart = !!prefs?.autostart
  if (hidden || !prefs || !geo.info || !traffic || (geoDone && wireshark && autostart)) return null

  const hide = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // not remembered; hidden for now
    }
    setHidden(true)
  }
  const done = <span className="tag ok">{s.done}</span>

  return (
    <section className="panel panel-pad section setup">
      <div className="setting">
        <div>
          <h3>{s.title}</h3>
          <p className="small muted">{s.lead}</p>
        </div>
        <button className="btn sm quiet" onClick={hide}>
          {s.hide}
        </button>
      </div>
      <div className="setup-list">
        <Row n={1} done title={s.lang}>
          <div className="seg" role="group" aria-label={s.lang}>
            {(Object.keys(LANGS) as Lang[]).map((l) => (
              <button key={l} className={getLang() === l ? 'on' : ''} aria-pressed={getLang() === l} onClick={() => setLang(l)}>
                {LANGS[l].lang}
              </button>
            ))}
          </div>
        </Row>
        <Row n={2} done={geoDone} title={s.geo[0]} why={s.geo[1]}>
          {geoDone ? (
            done
          ) : (
            <button className="btn sm primary" onClick={geo.update} disabled={geo.busy}>
              <Icon name={geo.busy ? 'refresh' : 'down'} className={geo.busy ? 'spin' : undefined} />
              {s.geoGet}
            </button>
          )}
        </Row>
        <Row n={3} done={wireshark} title={s.wireshark[0]} why={s.wireshark[1]}>
          {wireshark ? (
            done
          ) : (
            <button className="btn sm" onClick={() => go('apps')}>
              {s.wiresharkGet}
            </button>
          )}
        </Row>
        <Row n={4} done={autostart} title={platform === 'win32' ? s.autostartWin : s.autostart} why={s.autostartWhy}>
          {autostart ? (
            done
          ) : (
            <button
              className="btn sm"
              onClick={() =>
                void window.netplain
                  .saveSettings({ ...prefs, autostart: true })
                  .then(() => window.netplain.getSettings())
                  .then(setPrefs)
              }
            >
              {s.turnOn}
            </button>
          )}
        </Row>
      </div>
    </section>
  )
}
