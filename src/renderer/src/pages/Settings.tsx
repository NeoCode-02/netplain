import { useEffect, useState } from 'react'
import type { DataCap, NetworkUse, Settings as Prefs } from '../../../shared/types'
import { bytes } from '../../../shared/format'
import { useGeo } from '../geo'
import { getLang, LANGS, setLang, useT, type Dict, type Lang } from '../i18n'
import { ErrNote, Icon, Page } from '../ui'
import { showSetup } from './Setup'

/** The monthly data limit: which network, how many GB, and the day the count starts again. */
function CapForm({ t, cap, onSave }: { t: Dict; cap: DataCap | null; onSave(c: DataCap | null): void }) {
  const c = t.cap
  const [networks, setNetworks] = useState<NetworkUse[]>([])
  const [network, setNetwork] = useState(cap?.network ?? '')
  const [gb, setGb] = useState(cap ? String(cap.gb) : '')
  const [day, setDay] = useState(String(cap?.day ?? 1))
  const [saved, setSaved] = useState(false)
  useEffect(() => void window.netplain.networks().then(setNetworks), [])

  const g = Number(gb.replace(',', '.'))
  const d = Number(day)
  const valid = g >= 0.001 && g <= 100_000 && Number.isInteger(d) && d >= 1 && d <= 28
  // A network not used lately is still offered when the limit is set on it.
  const options = network && !networks.some((n) => n.key === network) ? [...networks, { key: network, name: network.slice(network.indexOf(':') + 1), bytes: 0 }] : networks
  const edit = (f: (v: string) => void) => (v: string) => {
    f(v)
    setSaved(false)
  }

  return (
    <section className="section">
      <div className="section-head">
        <h3>{c.title}</h3>
      </div>
      <div className="panel panel-pad stack">
        <p className="small muted">{c.why}</p>
        <div className="cap-form">
          <label>
            {c.network}
            <select className="select sm" value={network} onChange={(e) => edit(setNetwork)(e.target.value)}>
              <option value="">{c.all}</option>
              {options.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.name}
                  {n.bytes ? ` · ${bytes(n.bytes)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.gb}
            <input className="input sm num" inputMode="decimal" value={gb} placeholder="20" onChange={(e) => edit(setGb)(e.target.value)} />
          </label>
          <label>
            {c.day}
            <input className="input sm num" inputMode="numeric" value={day} onChange={(e) => edit(setDay)(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button
            className="btn sm primary"
            disabled={!valid}
            onClick={() => {
              onSave({ network, gb: g, day: d })
              setSaved(true)
            }}
          >
            {c.save}
          </button>
          {cap && (
            <button
              className="btn sm quiet"
              onClick={() => {
                onSave(null)
                setGb('')
                setSaved(false)
              }}
            >
              {c.remove}
            </button>
          )}
          {saved && <span className="small muted">{c.saved}</span>}
        </div>
      </div>
    </section>
  )
}

type Switch = 'capture' | 'uptime' | 'background' | 'autostart' | 'updates'

export default function Settings() {
  const t = useT()
  const s = t.settings
  const geo = useGeo()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [info, setInfo] = useState({ version: '', platform: '' })
  const [err, setErr] = useState<unknown>(null)
  const [reopened, setReopened] = useState(false)

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
    <Page title={s.title}>
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
        {toggle('uptime', s.uptime, s.uptimeWhy)}
      </div>
      <section className="section">
        <div className="section-head">
          <h3>{s.running}</h3>
        </div>
        <div className="panel panel-pad stack">
          {toggle('background', s.background, s.backgroundWhy)}
          {toggle('autostart', info.platform === 'win32' ? s.autostartWin : s.autostart, s.autostartWhy)}
          <ErrNote e={err} />
        </div>
      </section>
      {prefs && <CapForm t={t} cap={prefs.cap} onSave={(cap) => set({ cap })} />}
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
          <ErrNote e={geo.err} />
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h3>{s.about}</h3>
        </div>
        <div className="panel panel-pad stack tight">
          <strong>{s.version(info.version)}</strong>
          {toggle('updates', s.updates)}
          <div className="row">
            <button
              className="btn sm"
              onClick={() => {
                showSetup()
                setReopened(true)
              }}
            >
              {t.setup.reopen}
            </button>
            {reopened && <span className="small muted">{t.setup.reopened}</span>}
          </div>
          <p className="muted">{s.privacy}</p>
        </div>
      </section>
    </Page>
  )
}
