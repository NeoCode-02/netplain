import { useCallback, useEffect, useState } from 'react'
import type { Finding, Security as Data, SecurityTab } from '../../../shared/types'
import { errText, getLang, useT, type Dict } from '../i18n'
import { Empty, Icon, type IconName } from '../ui'

const WINDOWS = /Windows/.test(navigator.userAgent)
const MARK: Record<Finding['level'], IconName> = { bad: 'alert', warn: 'alert', info: 'dot', ok: 'shield' }
/** Tabs that exist so far; the rest arrive with their own commits. */
const TABS: SecurityTab[] = ['status']

function Status({ sec, t, onTab, onFixed }: { sec: Data; t: Dict; onTab(tab: SecurityTab): void; onFixed(): void }) {
  const s = t.security
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const bad = sec.findings.filter((f) => f.level === 'bad').length
  const warn = sec.findings.filter((f) => f.level === 'warn').length
  const fix = async (f: Finding) => {
    setBusy(f.key)
    setErr(null)
    try {
      await window.netplain.fixFinding(f.fix!)
      if (f.fix !== 'openDefender') onFixed()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <section className={`panel panel-pad verdict ${bad ? 'bad' : warn ? 'warn' : 'ok'}`}>
        <span className="verdict-mark">
          <Icon name={bad || warn ? 'alert' : 'shield'} size={22} />
        </span>
        <div>
          <h3>{bad ? s.verdictBad(bad) : warn ? s.verdictWarn(warn) : s.verdictOk}</h3>
          <p className="small muted">{s.honest}</p>
        </div>
      </section>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      <div className="list section">
        {sec.findings.map((f) => {
          const [title, body] = s.findings[f.key] ?? [f.key, () => '']
          return (
            <div className={`list-row finding ${f.level}`} key={f.key}>
              <span className={`ad-icon level-${f.level}`}>
                <Icon name={MARK[f.level]} size={16} />
              </span>
              <div className="app-main">
                <div className="alert-title">{title}</div>
                <p className="small muted">{body(f.params)}</p>
              </div>
              <div className="row finding-actions">
                {f.fix && (
                  <button className="btn sm" disabled={busy !== null} onClick={() => void fix(f)}>
                    {busy === f.key && <Icon name="refresh" className="spin" />}
                    {s.fix[f.fix]}
                  </button>
                )}
                {f.tab && TABS.includes(f.tab) && f.tab !== 'status' && (
                  <button className="btn quiet sm" onClick={() => onTab(f.tab!)}>
                    {s.open}
                    <Icon name="chevron" size={14} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function Security() {
  const t = useT()
  const s = t.security
  const [tab, setTab] = useState<SecurityTab>('status')
  const [sec, setSec] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  const load = useCallback((fresh: boolean) => {
    setBusy(true)
    setErr(null)
    window.netplain
      .security(fresh)
      .then(setSec, setErr)
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => {
    if (WINDOWS) window.netplain.security(false).then(setSec, setErr)
  }, [])

  if (!WINDOWS)
    return (
      <div className="page wide">
        <Empty icon="shield" title={s.title} body={s.windowsOnly} />
      </div>
    )

  return (
    <div className="page wide">
      <header className="page-head">
        <div>
          <h2>{s.title}</h2>
          <p>{s.lead}</p>
        </div>
        <div className="row">
          {sec && <span className="small faint">{s.checkedAt(new Date(sec.at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }))}</span>}
          <button className="btn sm" onClick={() => load(true)} disabled={busy || !sec}>
            <Icon name="refresh" className={busy ? 'spin' : undefined} />
            {s.recheck}
          </button>
        </div>
      </header>
      {TABS.length > 1 && (
        <div className="seg section-tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
              {s.tabs[x]}
            </button>
          ))}
        </div>
      )}
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      {!sec && err === null && <p className="muted">{s.reading}</p>}
      {sec && tab === 'status' && <Status sec={sec} t={t} onTab={setTab} onFixed={() => load(true)} />}
    </div>
  )
}
