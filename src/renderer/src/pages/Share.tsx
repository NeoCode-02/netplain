import { useEffect, useState } from 'react'
import type { ShareOptions, ShareProvider, ShareRequest, ShareRequestDetail, ShareState } from '../../../shared/types'
import { countryName } from '../explain'
import { bytes } from '../format'
import { errText, getLang, useT, type Dict } from '../i18n'
import { Icon } from '../ui'

const copy = (text: string) => void navigator.clipboard.writeText(text)

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange(on: boolean): void; disabled?: boolean }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />
}

function Form({ t, state, onStart }: { t: Dict; state: ShareState; onStart(o: ShareOptions): Promise<void> }) {
  const s = t.share
  const [port, setPort] = useState(state.options ? String(state.options.port) : '')
  const [https, setHttps] = useState(state.options?.https ?? false)
  const [password, setPassword] = useState(state.options?.password ?? true)
  const [provider, setProvider] = useState<ShareProvider>(state.options?.provider ?? 'cloudflare')
  const [ports, setPorts] = useState<[number, string][]>([])
  const [busy, setBusy] = useState<'cf' | 'start' | null>(null)
  const [err, setErr] = useState<unknown>(null)

  // Suggestions: programs on this computer waiting for connections.
  useEffect(() => {
    void window.netplain.connections().then((c) => {
      const seen = new Map<number, string>()
      for (const l of c.listening) if (l.proto === 'tcp' && !seen.has(l.localPort)) seen.set(l.localPort, l.title ?? l.app)
      setPorts([...seen].sort((a, b) => a[0] - b[0]))
    })
  }, [])

  const n = Number(port)
  const valid = Number.isInteger(n) && n > 0 && n < 65536
  const needCf = provider === 'cloudflare' && !state.cloudflared
  const act = async (what: 'cf' | 'start', f: () => Promise<void>) => {
    setBusy(what)
    setErr(null)
    try {
      await f()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel panel-pad stack">
      <div className="setting">
        <div>
          <span className="strong">{s.port}</span>
          <p className="small muted">{s.portHint}</p>
        </div>
        <input className="input sm mono share-port" inputMode="numeric" list="share-ports" value={port} aria-label={s.port} placeholder="3000" onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} />
        <datalist id="share-ports">
          {ports.map(([p, app]) => (
            <option key={p} value={p}>
              {app}
            </option>
          ))}
        </datalist>
      </div>
      <div className="setting">
        <span>{s.https}</span>
        <Switch on={https} label={s.https} onChange={setHttps} />
      </div>
      <div className="setting">
        <div>
          <span className="strong">{s.password}</span>
          <p className="small muted">{s.passwordWhy}</p>
        </div>
        <Switch on={password} label={s.password} onChange={setPassword} />
      </div>
      <div className="setting">
        <div>
          <span className="strong">{s.provider}</span>
          <p className="small muted">{provider === 'cloudflare' ? s.cloudflareWhy : s.sshWhy}</p>
        </div>
        <div className="seg" role="group" aria-label={s.provider}>
          {(['cloudflare', 'ssh'] as const).map((p) => (
            <button key={p} className={provider === p ? 'on' : ''} aria-pressed={provider === p} onClick={() => setProvider(p)}>
              {s[p]}
            </button>
          ))}
        </div>
      </div>
      {provider === 'cloudflare' && (
        <div className="setting">
          <p className="small muted">{state.cloudflared ? s.foundCf(state.cloudflared) : s.needCf}</p>
          {needCf && (
            <button className="btn sm" disabled={busy !== null} onClick={() => void act('cf', () => window.netplain.installCloudflared())}>
              <Icon name={busy === 'cf' ? 'refresh' : 'down'} className={busy === 'cf' ? 'spin' : undefined} />
              {busy === 'cf' ? s.gettingCf : s.getCf}
            </button>
          )}
        </div>
      )}
      <div className="row share-go">
        <p className="small muted">{s.warn}</p>
        <button className="btn primary" disabled={!valid || needCf || busy !== null} onClick={() => void act('start', () => onStart({ port: n, https, password, provider }))}>
          <Icon name={busy === 'start' ? 'refresh' : 'share'} className={busy === 'start' ? 'spin' : undefined} />
          {s.start}
        </button>
      </div>
      {(err !== null || state.error) && <p className="note danger">{errText(t, err ?? state.error)}</p>}
    </div>
  )
}

function Live({ t, state }: { t: Dict; state: ShareState }) {
  const s = t.share
  const o = state.options!
  return (
    <div className="panel panel-pad stack">
      {state.url ? (
        <>
          <p className="muted">{s.live(o.port)}</p>
          <div className="row share-link">
            <a className="mono" href={state.url} onClick={(e) => (e.preventDefault(), window.netplain.openUrl(state.url!))}>
              {state.url}
            </a>
            <button className="btn sm" onClick={() => copy(state.url!)}>
              <Icon name="copy" />
              {s.copy}
            </button>
            <button className="btn sm" onClick={() => window.netplain.openUrl(state.url!)}>
              <Icon name="external" />
              {s.open}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          <Icon name="refresh" className="spin" /> {state.status === 'reconnecting' ? s.reconnecting : s.starting}
        </p>
      )}
      {state.login && (
        <div className="row share-login">
          <span className="small muted">{s.login}</span>
          <span className="tag mono">
            {s.user}: {state.login.user}
          </span>
          <span className="tag mono">
            {s.pass}: {state.login.password}
          </span>
          <button className="btn sm quiet" onClick={() => copy(`${state.login!.user}:${state.login!.password}`)}>
            <Icon name="copy" />
            {s.copy}
          </button>
        </div>
      )}
      <div className="row share-go">
        <p className="small muted">{s.warn}</p>
        <button className="btn danger" onClick={() => void window.netplain.shareStop()}>
          {s.stop}
        </button>
      </div>
    </div>
  )
}

const statusTag = (t: Dict, r: ShareRequest) =>
  r.error ? (
    <span className="tag danger">{t.share.noAnswer}</span>
  ) : r.status === null ? (
    <span className="tag">…</span>
  ) : (
    <span className={`tag ${r.status >= 500 ? 'danger' : r.status >= 400 ? 'warn' : 'ok'}`}>{r.status}</span>
  )

function Detail({ t, id }: { t: Dict; id: number }) {
  const s = t.share
  const [d, setD] = useState<ShareRequestDetail | null>(null)
  useEffect(() => void window.netplain.shareRequest(id).then(setD), [id])
  if (!d) return null
  const part = (title: string, headers: [string, string][], body: string) => (
    <div className="share-part">
      <h4>{title}</h4>
      <pre className="share-pre">{headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
      <pre className="share-pre">{body || s.empty}</pre>
    </div>
  )
  return (
    <div className="share-detail">
      {part(s.request, d.reqHeaders, d.reqBody)}
      {part(s.response, d.resHeaders, d.resBody)}
      <button className="btn sm" onClick={() => void window.netplain.shareReplay(id)}>
        <Icon name="refresh" />
        {s.replay}
      </button>
    </div>
  )
}

function Requests({ t, list }: { t: Dict; list: ShareRequest[] }) {
  const s = t.share
  const [open, setOpen] = useState<number | null>(null)
  const lang = getLang()
  return (
    <section className="section">
      <div className="section-head">
        <h3>{s.requests}</h3>
      </div>
      {list.length === 0 ? (
        <p className="muted list-empty">{s.none}</p>
      ) : (
        <div className="list">
          {[...list].reverse().map((r) => (
            <div key={r.id}>
              <button className={`share-row ${open === r.id ? 'on' : ''}`} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="faint mono">{new Date(r.at).toLocaleTimeString(lang)}</span>
                <span className="mono strong">{r.method}</span>
                <span className="mono share-path">{r.path}</span>
                {statusTag(t, r)}
                <span className="faint num">{r.ms !== null ? `${r.ms} ms` : ''}</span>
                <span className="faint num">{bytes(r.bytes)}</span>
                <span className="muted share-who">{r.ip === 'replay' ? s.replayed : [r.ip, r.country && countryName(r.country, lang)].filter(Boolean).join(' · ')}</span>
              </button>
              {open === r.id && <Detail t={t} id={r.id} />}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function Share() {
  const t = useT()
  const [state, setState] = useState<ShareState | null>(null)
  const [list, setList] = useState<ShareRequest[]>([])

  useEffect(() => {
    void window.netplain.shareState().then(setState)
    return window.netplain.onShare(setState)
  }, [])
  // The whole log (at most 500) once a second: pending requests change, not only new ones arrive.
  useEffect(() => {
    const load = () => void window.netplain.shareRequests(0).then(setList)
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h2>{t.share.title}</h2>
          <p>{t.share.lead}</p>
        </div>
      </header>
      {state && (state.status === 'off' ? <Form t={t} state={state} onStart={(o) => window.netplain.shareStart(o)} /> : <Live t={t} state={state} />)}
      <Requests t={t} list={list} />
    </div>
  )
}
