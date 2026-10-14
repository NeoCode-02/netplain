import { useCallback, useEffect, useState } from 'react'
import type { Finding, ScanKind, ScanState, Security as Data, SecurityTab } from '../../../shared/types'
import { behavioural, threatParts } from '../explain'
import { errText, getLang, useT, type Dict } from '../i18n'
import { Empty, Icon, type IconName } from '../ui'

const WINDOWS = /Windows/.test(navigator.userAgent)
const MARK: Record<Finding['level'], IconName> = { bad: 'alert', warn: 'alert', info: 'dot', ok: 'shield' }
/** Tabs that exist so far; the rest arrive with their own commits. */
const TABS: SecurityTab[] = ['status', 'antivirus']

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

const NEVER = 100_000
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

function Antivirus({ sec, t, onChanged }: { sec: Data; t: Dict; onChanged(): void }) {
  const a = t.security.av
  const lang = getLang()
  const d = sec.defender
  const [scan, setScan] = useState<ScanState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)

  // While a scan runs, its state is asked for every two seconds.
  useEffect(() => {
    let stop = false
    const poll = async () => {
      const s = await window.netplain.scanState()
      if (stop) return
      setScan(s)
      setNow(Date.now())
      if (s.running) setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      stop = true
    }
  }, [busy])

  const run = async (key: string, f: () => Promise<void>, done?: string) => {
    setBusy(key)
    setErr(null)
    setNote(null)
    try {
      await f()
      if (done) setNote(done)
      onChanged()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }
  const start = (kind: ScanKind, admin = false) => run(`scan-${kind}`, async () => window.netplain.startScan(kind, admin))
  const last = scan?.last
  const result = last && (last.code === 0 ? a.results.ok : last.code === 2 ? a.results.found : last.code === -1 ? a.results.cancelled : a.results.failed(last.code))
  const age = (n: number | undefined) => (n === undefined || n >= NEVER ? a.never : a.ago(n))
  const active = sec.threats.filter((x) => x.active)

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span>{a.realtime}</span>
          <strong className={d?.rt ? 'good' : 'bad'}>{d?.rt ? a.on : a.off}</strong>
        </div>
        <div className="kpi">
          <span>{a.definitions}</span>
          <strong>{age(d?.sigAge)}</strong>
        </div>
        <div className="kpi">
          <span>{a.quick}</span>
          <strong>{age(d?.quickAge)}</strong>
        </div>
        <div className="kpi">
          <span>{a.full}</span>
          <strong>{age(d?.fullAge)}</strong>
        </div>
      </div>

      <section className="panel panel-pad stack">
        <div className="scan-row">
          <div>
            <div className="alert-title">{a.quickScan}</div>
            <p className="small muted">{a.quickWhat}</p>
          </div>
          <button className="btn primary sm" disabled={!!scan?.running || busy !== null} onClick={() => void start('quick')}>
            {a.quickScan}
          </button>
        </div>
        <div className="scan-row">
          <div>
            <div className="alert-title">{a.fullScan}</div>
            <p className="small muted">{a.fullWhat}</p>
          </div>
          <button className="btn sm" disabled={!!scan?.running || busy !== null} onClick={() => void start('full')}>
            {a.fullScan}
          </button>
        </div>
        {scan?.running && (
          <p className="note row">
            <Icon name="refresh" className="spin" />
            {a.scanning(scan.running === 'quick' ? a.quickScan : a.fullScan, clock(now - (scan.started ?? now)))}
          </p>
        )}
        {!scan?.running && result && (
          <div className={`note ${last!.code === 2 ? 'danger' : ''} row`}>
            <span className="spacer">{result}</span>
            {last!.code !== 0 && last!.code !== 2 && last!.code !== -1 && (
              <button className="btn sm" onClick={() => void start(last!.kind, true)}>
                {a.asAdmin}
              </button>
            )}
          </div>
        )}
        <div className="row">
          <button className="btn sm" disabled={busy !== null} onClick={() => void run('update', () => window.netplain.updateDefinitions(), a.updated)}>
            {busy === 'update' && <Icon name="refresh" className="spin" />}
            {a.update}
          </button>
          <button className="btn quiet sm" onClick={() => void window.netplain.fixFinding('openDefender')}>
            {a.openWs}
          </button>
        </div>
        {note && <p className="small muted">{note}</p>}
        {err !== null && <p className="note danger">{errText(t, err)}</p>}
      </section>

      <section className="section">
        <div className="section-head">
          <h3>{a.history}</h3>
          {active.length > 0 && (
            <button className="btn sm danger" disabled={busy !== null} onClick={() => void run('remove', () => window.netplain.removeThreats())}>
              {a.removeAll}
            </button>
          )}
        </div>
        {sec.threats.length === 0 ? (
          <p className="list-empty">{a.noThreats}</p>
        ) : (
          <div className="list">
            {sec.threats.map((x) => {
              const parts = threatParts(x.name)
              const status = x.status === null ? null : (a.status[x.status] ?? (x.status >= 100 ? a.statusFailed : null))
              return (
                <div className="list-row finding" key={x.id}>
                  <span className={`ad-icon level-${x.active ? 'bad' : 'warn'}`}>
                    <Icon name="alert" size={16} />
                  </span>
                  <div className="app-main">
                    <div className="alert-title">{x.name}</div>
                    <p className="small muted">
                      {[parts && a.categories[parts.category], behavioural(x.name) && a.behaviour].filter(Boolean).join(' ')}
                    </p>
                    {x.resources[0] && <p className="mono small faint threat-res">{x.resources[0].replace(/^\w+:_/, '').slice(0, 220)}</p>}
                  </div>
                  <div className="threat-meta small">
                    <span className={`tag ${x.active ? 'danger' : ''}`}>{x.active ? a.active : (status ?? '—')}</span>
                    <span className="faint">{a.severity[x.severity] ?? ''}</span>
                    {x.at && <span className="faint">{new Date(x.at).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
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
      {sec && tab === 'antivirus' && <Antivirus sec={sec} t={t} onChanged={() => load(true)} />}
    </div>
  )
}
