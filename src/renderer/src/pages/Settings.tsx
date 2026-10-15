import { useEffect, useState } from 'react'
import type { Settings as Prefs } from '../../../shared/types'
import { useGeo } from '../geo'
import { errText, getLang, LANGS, setLang, useT, type Lang } from '../i18n'
import { Icon } from '../ui'

type Switch = 'capture' | 'background' | 'autostart' | 'updates'

export default function Settings() {
  const t = useT()
  const s = t.settings
  const geo = useGeo()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [info, setInfo] = useState({ version: '', platform: '' })
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    void window.netplain.getSettings().then(setPrefs)
    void window.netplain.appInfo().then(setInfo)
  }, [])

  // Saved at once; read back, because "start at login" is whatever the system ends up with.
  const set = (patch: Partial<Prefs>) => {
    const next = { ...prefs!, ...patch }
    setPrefs(next)
    setErr(null)
    void window.netplain
      .saveSettings(next)
      .catch(setErr)
      .then(() => window.netplain.getSettings().then(setPrefs))
  }

  const toggle = (key: Switch, label: string, why?: string) => (
    <div className="stack tight">
      <div className="setting">
        <span>{label}</span>
        <button className={`switch ${prefs?.[key] ? 'on' : ''}`} role="switch" aria-checked={!!prefs?.[key]} aria-label={label} disabled={!prefs} onClick={() => set({ [key]: !prefs?.[key] })} />
      </div>
      {why && <p className="small muted">{why}</p>}
    </div>
  )

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
              <button key={th} className={prefs?.theme === th ? 'on' : ''} aria-pressed={prefs?.theme === th} onClick={() => set({ theme: th })} disabled={!prefs}>
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
        {toggle('capture', s.capture, s.captureWhy)}
      </div>
      <section className="section">
        <div className="section-head">
          <h3>{s.running}</h3>
        </div>
        <div className="panel panel-pad stack">
          {toggle('background', s.background, s.backgroundWhy)}
          {toggle('autostart', info.platform === 'win32' ? s.autostartWin : s.autostart, s.autostartWhy)}
          {err !== null && <p className="note danger">{errText(t, err)}</p>}
        </div>
      </section>
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
          <strong>{s.version(info.version)}</strong>
          {toggle('updates', s.updates)}
          <p className="muted">{s.privacy}</p>
        </div>
      </section>
    </div>
  )
}
