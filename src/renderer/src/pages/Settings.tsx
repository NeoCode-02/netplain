import { useEffect, useState } from 'react'
import type { Settings as Prefs } from '../../../shared/types'
import { useGeo } from '../geo'
import { errText, getLang, LANGS, setLang, useT, type Lang } from '../i18n'
import { Icon } from '../ui'

export default function Settings() {
  const t = useT()
  const s = t.settings
  const geo = useGeo()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.netplain.getSettings().then(setPrefs)
    void window.netplain.appInfo().then((i) => setVersion(i.version))
  }, [])

  const theme = (th: Prefs['theme']) => {
    const next = { ...prefs!, theme: th }
    setPrefs(next)
    void window.netplain.saveSettings(next)
  }
  const capture = (on: boolean) => {
    const next = { ...prefs!, capture: on }
    setPrefs(next)
    void window.netplain.saveSettings(next)
  }

  return (
    <div className="page">
      <header className="page-head">
        <h2>{s.title}</h2>
      </header>
      <div className="panel panel-pad stack">
        <div className="setting">
          <span>{s.theme}</span>
          <div className="seg" role="group" aria-label={s.theme}>
            {(['system', 'light', 'dark'] as const).map((th) => (
              <button key={th} className={prefs?.theme === th ? 'on' : ''} aria-pressed={prefs?.theme === th} onClick={() => theme(th)} disabled={!prefs}>
                {s.themes[th]}
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <span>{s.language}</span>
          <div className="seg" role="group" aria-label={s.language}>
            {(Object.keys(LANGS) as Lang[]).map((l) => (
              <button key={l} className={getLang() === l ? 'on' : ''} aria-pressed={getLang() === l} onClick={() => setLang(l)}>
                {LANGS[l].lang}
              </button>
            ))}
          </div>
        </div>
        <div className="stack tight">
          <div className="setting">
            <span>{s.capture}</span>
            <button
              className={`switch ${prefs?.capture ? 'on' : ''}`}
              role="switch"
              aria-checked={!!prefs?.capture}
              aria-label={s.capture}
              disabled={!prefs}
              onClick={() => capture(!prefs?.capture)}
            />
          </div>
          <p className="small muted">{s.captureWhy}</p>
        </div>
      </div>
      <section className="section">
        <div className="section-head">
          <h3>{s.geo}</h3>
        </div>
        <div className="panel panel-pad stack tight">
          <div className="setting">
            <span>{geo.info?.ready && geo.info.built ? s.geoReady(new Date(geo.info.built).toLocaleDateString(getLang(), { day: 'numeric', month: 'long', year: 'numeric' })) : s.geoMissing}</span>
            <button className="btn sm" onClick={geo.update} disabled={!geo.info || geo.busy}>
              <Icon name={geo.info?.ready ? 'refresh' : 'down'} className={geo.busy ? 'spin' : undefined} />
              {geo.busy ? s.geoBusy : geo.info?.ready ? s.geoUpdate : s.geoDownload}
            </button>
          </div>
          <p className="small muted">{s.geoWhy}</p>
          {geo.err !== null && <p className="note danger">{errText(t, geo.err)}</p>}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h3>{s.about}</h3>
        </div>
        <div className="panel panel-pad stack tight">
          <strong>{s.version(version)}</strong>
          <p className="muted">{s.privacy}</p>
        </div>
      </section>
    </div>
  )
}
