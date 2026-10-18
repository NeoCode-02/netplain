import { useCallback, useEffect, useState } from 'react'
import type { Finding, ScanKind, ScanState, SecService, Security as Data, SecurityTab } from '../../../shared/types'
import { behavioural, threatParts } from '../explain'
import { errText, getLang, useT, type Dict } from '../i18n'
import { Empty, Icon, Page, Tabs, type IconName } from '../ui'

const WINDOWS = /Windows/.test(navigator.userAgent)
const MARK: Record<Finding['level'], IconName> = { bad: 'alert', warn: 'alert', info: 'dot', ok: 'shield' }
const TABS: SecurityTab[] = ['status', 'antivirus', 'users', 'services', 'startup']

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

function Startup({ sec, t, onChanged, onTab }: { sec: Data; t: Dict; onChanged(): void; onTab(tab: SecurityTab): void }) {
  const v = t.security.startup
  const sv = t.security.services
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const toggle = async (id: string, on: boolean) => {
    setBusy(id)
    setErr(null)
    try {
      await window.netplain.setStartup(id, on)
      onChanged()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }
  const autoServices = sec.services.filter((s) => s.start === 'Auto' && !microsoft(s)).length
  const entries = [...sec.startup].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return (
    <>
      <p className="muted section-lead">{v.lead}</p>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      {entries.length === 0 ? (
        <p className="list-empty">{v.empty}</p>
      ) : (
        <div className="list">
          {entries.map((x) => {
            const odd = !!x.exe && x.signer?.status !== undefined && x.signer.status !== 'valid' && /\\(AppData|Temp|Downloads|Users\\Public)\\/i.test(x.exe)
            const switchable = x.kind === 'task' || !!x.approved
            return (
              <div className={`list-row finding ${x.enabled ? '' : 'muted-row'}`} key={x.id}>
                <span className={`ad-icon ${odd ? 'level-warn' : ''}`}>
                  <Icon name={x.kind === 'task' ? 'clock' : 'box'} size={16} />
                </span>
                <div className="app-main">
                  <div className="row">
                    <span className="alert-title ellipsis">{x.kind === 'task' ? x.name.split('\\').pop() : x.name}</span>
                    <span className="tag">{v.kinds[x.kind]}</span>
                    {v.scope[x.hive] && <span className="tag">{v.scope[x.hive]}</span>}
                    {odd && <span className="tag warn">{v.suspicious}</span>}
                  </div>
                  <p className="mono small faint ellipsis" title={x.command}>
                    {x.command}
                  </p>
                  <p className="small faint">
                    {[x.signer ? (x.signer.status === 'valid' ? sv.signed(x.signer.publisher ?? '?') : sv.unsigned) : null, !switchable ? v.once : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {switchable && (
                  <div className="row finding-actions">
                    <span className="small faint">{x.enabled ? v.on : v.off}</span>
                    <button
                      className={`switch ${x.enabled ? 'on' : ''}`}
                      role="switch"
                      aria-checked={x.enabled}
                      aria-label={x.name}
                      disabled={busy !== null}
                      onClick={() => void toggle(x.id, !x.enabled)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {autoServices > 0 && (
        <div className="note row section">
          <span className="spacer">{v.services(autoServices)}</span>
          <button className="btn sm" onClick={() => onTab('services')}>
            {v.servicesGo}
          </button>
        </div>
      )}
    </>
  )
}

type SvcAction = 'start' | 'stop' | 'auto' | 'manual' | 'disabled'
const MODE: Record<string, SvcAction> = { Auto: 'auto', Manual: 'manual', Disabled: 'disabled' }
const microsoft = (s: SecService) => s.signer?.status === 'valid' && /microsoft/i.test(s.signer.publisher ?? '')

function Services({ sec, t, onChanged }: { sec: Data; t: Dict; onChanged(): void }) {
  const v = t.security.services
  const [filter, setFilter] = useState<'third' | 'running' | 'all'>('third')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const act = async (name: string, action: SvcAction) => {
    setBusy(name)
    setErr(null)
    setConfirm(null)
    try {
      await window.netplain.setService(name, action)
      onChanged()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }
  const q = query.trim().toLowerCase()
  const list = sec.services
    .filter((s) => (filter === 'third' ? !microsoft(s) : filter === 'running' ? s.state === 'Running' : true))
    .filter((s) => !q || [s.name, s.display, s.desc, s.signer?.publisher].some((x) => x?.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.state === 'Running') - Number(a.state === 'Running') || a.display.localeCompare(b.display))
  return (
    <>
      <p className="muted section-lead">{v.lead}</p>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input className="input" type="search" placeholder={v.search} aria-label={v.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="seg" role="group">
          {(['third', 'running', 'all'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {v.filters[f]}
            </button>
          ))}
        </div>
        <span className="small faint">{v.count(list.length)}</span>
      </div>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      <div className="list">
        {list.map((s) => (
          <div className="list-row finding svc-row" key={s.name}>
            <span className={`ad-icon ${s.state === 'Running' ? 'internet' : ''}`}>
              <Icon name="box" size={16} />
            </span>
            <div className="app-main">
              <div className="row">
                <span className="alert-title ellipsis">{s.display || s.name}</span>
                <span className={`tag ${s.state === 'Running' ? 'ok' : ''}`}>{s.state === 'Running' ? v.running : s.state === 'Stopped' ? v.stopped : v.changing}</span>
              </div>
              {s.desc && <p className="small muted clamp">{s.desc}</p>}
              <p className="small faint">
                {[v.modes[s.start] ?? s.start, s.signer ? (s.signer.status === 'valid' ? v.signed(s.signer.publisher ?? '?') : v.unsigned) : null, s.name].filter(Boolean).join(' · ')}
              </p>
              {confirm === s.name && (
                <div className="note warn row">
                  <span className="spacer">{v.confirm}</span>
                  <button className="btn sm danger" onClick={() => void act(s.name, 'disabled')}>
                    {v.confirmDo}
                  </button>
                </div>
              )}
            </div>
            <div className="row finding-actions">
              <select
                className="select sm"
                aria-label={v.mode}
                value={MODE[s.start] ?? ''}
                disabled={busy !== null || !MODE[s.start]}
                onChange={(e) => {
                  const next = e.target.value as SvcAction
                  if (next === 'disabled' && microsoft(s)) setConfirm(s.name)
                  else void act(s.name, next)
                }}
              >
                {!MODE[s.start] && <option value="">{v.modes[s.start] ?? s.start}</option>}
                {(['auto', 'manual', 'disabled'] as const).map((m) => (
                  <option key={m} value={m}>
                    {v.options[m]}
                  </option>
                ))}
              </select>
              <button className="btn sm" disabled={busy !== null || s.start === 'Disabled'} onClick={() => void act(s.name, s.state === 'Running' ? 'stop' : 'start')}>
                {busy === s.name && <Icon name="refresh" className="spin" />}
                {s.state === 'Running' ? v.stop : v.start}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Users({ sec, t, onChanged }: { sec: Data; t: Dict; onChanged(): void }) {
  const u = t.security.users
  const lang = getLang()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const act = async (name: string, action: 'disable' | 'enable' | 'unadmin') => {
    setBusy(`${name}|${action}`)
    setErr(null)
    try {
      await window.netplain.setUser(name, action)
      onChanged()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }
  // You first, then people who can sign in, then the rest.
  const users = [...sec.users].sort((a, b) => Number(b.me) - Number(a.me) || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return (
    <>
      <p className="muted section-lead">{u.lead}</p>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      <div className="list">
        {users.map((x) => {
          const builtin = u.builtin[x.sid.split('-').at(-1) ?? '']
          // Accounts that services sign in as: turning them off stops those services.
          const runs = sec.services.filter((s) => s.account.toLowerCase().endsWith(`\\${x.name.toLowerCase()}`)).map((s) => s.display || s.name)
          const note = runs.length ? u.service(runs.slice(0, 3).join(', ')) : (builtin ?? (!x.me && x.enabled ? u.unknown : ''))
          return (
            <div className={`list-row finding ${x.enabled ? '' : 'muted-row'}`} key={x.sid}>
              <span className={`ad-icon ${x.admin && x.enabled ? 'level-warn' : ''}`}>
                <Icon name="user" size={16} />
              </span>
              <div className="app-main">
                <div className="row">
                  <span className="alert-title">{x.name}</span>
                  {x.me && <span className="tag accent">{u.me}</span>}
                  {x.admin && <span className="tag">{u.admin}</span>}
                  {!x.enabled && <span className="tag">{u.off}</span>}
                </div>
                <p className="small muted">
                  {[x.last ? u.last(new Date(x.last).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })) : u.never, note].filter(Boolean).join(' · ')}
                </p>
              </div>
              {!x.me && (
                <div className="row finding-actions">
                  {x.admin && x.enabled && (
                    <button className="btn quiet sm" disabled={busy !== null} onClick={() => void act(x.name, 'unadmin')}>
                      {u.unadmin}
                    </button>
                  )}
                  <button className="btn sm" disabled={busy !== null} onClick={() => void act(x.name, x.enabled ? 'disable' : 'enable')}>
                    {busy?.startsWith(`${x.name}|`) && <Icon name="refresh" className="spin" />}
                    {x.enabled ? u.disable : u.enable}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="small faint foot-note">{u.note}</p>
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
      <Page title={s.title}>
        <Empty icon="shield" title={s.title} body={s.windowsOnly} />
      </Page>
    )

  return (
    <Page
      title={s.title}
      note={s.lead}
      actions={
        <>
          {sec && <span className="small faint">{s.checkedAt(new Date(sec.at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }))}</span>}
          <button className="btn sm" onClick={() => load(true)} disabled={busy || !sec}>
            <Icon name="refresh" className={busy ? 'spin' : undefined} />
            {s.recheck}
          </button>
        </>
      }
      tabs={TABS.length > 1 && <Tabs value={tab} options={TABS} text={(x) => s.tabs[x]} onChange={setTab} />}
    >
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      {!sec && err === null && <p className="muted">{s.reading}</p>}
      {sec && tab === 'status' && <Status sec={sec} t={t} onTab={setTab} onFixed={() => load(true)} />}
      {sec && tab === 'antivirus' && <Antivirus sec={sec} t={t} onChanged={() => load(true)} />}
      {sec && tab === 'users' && <Users sec={sec} t={t} onChanged={() => load(true)} />}
      {sec && tab === 'services' && <Services sec={sec} t={t} onChanged={() => load(true)} />}
      {sec && tab === 'startup' && <Startup sec={sec} t={t} onChanged={() => load(true)} onTab={setTab} />}
    </Page>
  )
}
