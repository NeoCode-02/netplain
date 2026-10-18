import { useEffect, useState } from 'react'
import type { AlertKind, BlocklistInfo, Settings } from '../../../shared/types'
import { errText, getLang, useT } from '../i18n'
import { alertText, setAlerts, useLive } from '../live'
import { Empty, Icon, Page, type IconName } from '../ui'

const ICON: Record<AlertKind, IconName> = { newApp: 'globe', exposed: 'link', plain: 'alert', blocklist: 'shield', outage: 'pulse', monitorDown: 'pulse', monitorUp: 'pulse', certExpiry: 'shield', dataCap: 'chart' }
const KINDS = Object.keys(ICON) as AlertKind[]

export default function Alerts() {
  const t = useT()
  const a = t.alerts
  const lang = getLang()
  const { alerts } = useLive()
  const [prefs, setPrefs] = useState<Settings | null>(null)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)
  const [info, setInfo] = useState<BlocklistInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    void window.netplain.getSettings().then((s) => {
      setPrefs(s)
      setDraft(s.blocklist)
    })
    void window.netplain.blocklistInfo().then(setInfo)
  }, [])

  const save = async (next: Settings) => {
    setPrefs(next)
    await window.netplain.saveSettings(next)
    setInfo(await window.netplain.blocklistInfo())
  }
  const firehol = async (remove: boolean) => {
    setBusy(true)
    setErr(null)
    try {
      setInfo(remove ? await window.netplain.removeFirehol() : await window.netplain.updateFirehol())
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const when = (ms: number) => new Date(ms).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <Page
      title={a.title}
      note={a.lead}
      actions={
        alerts.length > 0 && (
          <>
            <button
              className="btn sm"
              onClick={async () => {
                await window.netplain.markAlertsRead()
                setAlerts(alerts.map((x) => ({ ...x, read: true })))
              }}
            >
              {a.markRead}
            </button>
            <button
              className="btn quiet sm"
              onClick={async () => {
                await window.netplain.clearAlerts()
                setAlerts([])
              }}
            >
              {a.clear}
            </button>
          </>
        )
      }
    >

      {alerts.length === 0 ? (
        <Empty icon="shield" title={a.none} />
      ) : (
        <div className="list">
          {alerts.map((x) => {
            const [title, body] = alertText(x)
            return (
              <div className={`list-row alert-row ${x.read ? '' : 'unread'}`} key={x.id}>
                <span className={`ad-icon alert-${x.kind}`}>
                  <Icon name={ICON[x.kind]} size={17} />
                </span>
                <div className="app-main">
                  <div className="alert-title">{title}</div>
                  <p className="small muted">{body}</p>
                </div>
                <span className="small faint num">{when(x.at)}</span>
              </div>
            )
          })}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h3>{a.rules}</h3>
        </div>
        <div className="panel panel-pad stack">
          {KINDS.map((k) => (
            <div className="setting" key={k}>
              <div>
                <div className="alert-title">{a.kinds[k][0]}</div>
                <p className="small muted">{a.kinds[k][1]}</p>
              </div>
              <button
                className={`switch ${prefs?.alerts[k] ? 'on' : ''}`}
                role="switch"
                aria-checked={!!prefs?.alerts[k]}
                aria-label={a.kinds[k][0]}
                disabled={!prefs}
                onClick={() => prefs && void save({ ...prefs, alerts: { ...prefs.alerts, [k]: !prefs.alerts[k] } })}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h3>{a.blocklist}</h3>
            <p>{a.blocklistWhy}</p>
          </div>
        </div>
        <div className="panel panel-pad stack">
          <textarea className="textarea mono" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={a.blocklist} placeholder="203.0.113.0/24" />
          <div className="row">
            <span className="small muted spacer">{info && a.own(info.own)}</span>
            <button
              className="btn sm"
              disabled={!prefs || draft === prefs.blocklist}
              onClick={async () => {
                await save({ ...prefs!, blocklist: draft })
                setSaved(true)
                setTimeout(() => setSaved(false), 2000)
              }}
            >
              {saved ? a.saved : a.save}
            </button>
          </div>
          <div className="setting">
            <div>
              <div className="alert-title">{a.firehol}</div>
              <p className="small muted">{a.fireholWhy}</p>
              <p className="small">{info?.firehol != null && info.fireholAt ? a.fireholOn(info.firehol, when(info.fireholAt)) : a.fireholOff}</p>
            </div>
            <div className="row">
              {info?.firehol != null && (
                <button className="btn quiet sm" onClick={() => void firehol(true)} disabled={busy}>
                  {a.remove}
                </button>
              )}
              <button className="btn sm" onClick={() => void firehol(false)} disabled={busy}>
                <Icon name={info?.firehol != null ? 'refresh' : 'down'} className={busy ? 'spin' : undefined} />
                {info?.firehol != null ? a.update : a.download}
              </button>
            </div>
          </div>
          {err !== null && <p className="note danger">{errText(t, err)}</p>}
        </div>
      </section>
    </Page>
  )
}
