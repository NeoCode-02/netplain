import { useEffect, useState } from 'react'
import type { Settings as Prefs } from '../../../shared/types'
import { getLang, LANGS, setLang, useT, type Lang } from '../i18n'

export default function Settings() {
  const t = useT()
  const s = t.settings
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
      </div>
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
