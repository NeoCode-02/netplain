import { useEffect, useState } from 'react'
import type { LocalSite, ShareProvider, ShareRequest, ShareRequestDetail, ShareState } from '../../../shared/types'
import { countryName } from '../explain'
import { bytes } from '../format'
import { useAction } from '../hooks'
import { getLang, useT, type Dict } from '../i18n'
import { ErrNote, Icon, Page } from '../ui'

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange(on: boolean): void; disabled?: boolean }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />
}

/** Copy buttons say "Copied" for a moment. */
function useCopied() {
  const [what, setWhat] = useState<string | null>(null)
  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setWhat(key)
    setTimeout(() => setWhat((w) => (w === key ? null : w)), 1500)
  }
  return [what, copy] as const
}

function Form({ t, state }: { t: Dict; state: ShareState }) {
  const s = t.share
  const [sites, setSites] = useState<LocalSite[] | null>(null)
  const [pick, setPick] = useState<number | null>(state.options?.port ?? null)
  const [other, setOther] = useState('')
  const [https, setHttps] = useState(state.options?.https ?? false)
  const [password, setPassword] = useState(state.options?.password ?? true)
  const [provider, setProvider] = useState<ShareProvider>(state.options?.provider ?? 'cloudflare')
  const { busy, err, run } = useAction()

  // Sites come and go as they are started and stopped; the first of the user's own is picked.
  useEffect(() => {
    const load = () =>
      window.netplain.localSites().then(
        (list) => {
          setSites(list)
          setPick((p) => p ?? list.find((x) => x.dev)?.port ?? null)
        },
        () => setSites([])
      )
    void load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [])

  const mine = sites?.filter((x) => x.dev) ?? []
  const others = sites?.filter((x) => !x.dev) ?? []
  const card = (x: LocalSite) => {
    const on = !other && pick === x.port
    return (
      <button
        key={x.port}
        role="radio"
        aria-checked={on}
        className={`site-card ${on ? 'on' : ''}`}
        onClick={() => {
          setPick(x.port)
          setOther('')
        }}
      >
        <strong className="ellipsis">{x.title ?? x.app}</strong>
        <span className="mono small muted ellipsis">
          {x.https ? 'https' : 'http'}://localhost:{x.port}
        </span>
        <span className="small faint ellipsis">{x.app}</span>
      </button>
    )
  }
  const typed = Number(other)
  const port = other ? (Number.isInteger(typed) && typed > 0 && typed < 65536 ? typed : null) : pick
  const site = other ? undefined : sites?.find((x) => x.port === port)
  const start = async () => {
    if (port === null) return
    // Cloudflare's connector is fetched on the first share, not as a separate step.
    if (provider === 'cloudflare' && !state.cloudflared && !(await run(s.gettingCf, () => window.netplain.installCloudflared().then(() => true)))) return
    await run(s.starting, () => window.netplain.shareStart({ port, https: site ? site.https : https, password, provider }))
  }

  return (
    <>
      <ol className="share-steps">
        {s.steps.map((step, i) => (
          <li key={step}>
            <span className="step-n">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <section className="panel panel-pad stack section">
        <h3>{s.found}</h3>
        {sites === null ? (
          <p className="muted">{s.searching}</p>
        ) : mine.length === 0 ? (
          <div className="share-none">
            <strong>{s.noneFound}</strong>
            <p className="small muted">{s.noneHow}</p>
          </div>
        ) : (
          <div className="site-list" role="radiogroup" aria-label={s.found}>
            {mine.map(card)}
          </div>
        )}
        {others.length > 0 && (
          <details className="share-others">
            <summary className="small muted">{s.others(others.length)}</summary>
            <div className="site-list" role="radiogroup" aria-label={s.others(others.length)}>
              {others.map(card)}
            </div>
          </details>
        )}
        <div className="setting">
          <div>
            <span className="strong">{s.port}</span>
            <p className="small muted">{s.portHint}</p>
          </div>
          <input className="input sm mono share-port" inputMode="numeric" value={other} aria-label={s.port} placeholder="3000" onChange={(e) => setOther(e.target.value.replace(/\D/g, '').slice(0, 5))} />
        </div>
      </section>
      <details className="panel panel-pad share-more section">
        <summary>{s.options}</summary>
        <div className="stack">
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
          <div className="setting">
            <span>{s.https}</span>
            <Switch on={https} label={s.https} onChange={setHttps} />
          </div>
        </div>
      </details>
      <div className="row share-go section">
        <p className="small muted">{s.warn}</p>
        <button className="btn primary" disabled={port === null || busy !== null} onClick={() => void start()}>
          <Icon name={busy ? 'refresh' : 'share'} className={busy ? 'spin' : undefined} />
          {busy ?? (port === null ? s.start : s.shareSite(site?.title ?? `localhost:${port}`))}
        </button>
      </div>
      <ErrNote e={err ?? state.error} />
    </>
  )
}

function Live({ t, state }: { t: Dict; state: ShareState }) {
  const s = t.share
  const [copied, copy] = useCopied()
  const url = state.url
  const login = state.login
  return (
    <div className="panel panel-pad stack">
      {url ? (
        <>
          <strong>{s.online}</strong>
          <a className="mono share-url" href={url} onClick={(e) => (e.preventDefault(), window.netplain.openUrl(url))}>
            {url}
          </a>
          {login && (
            <div className="row share-login">
              <span className="tag mono">
                {s.user}: {login.user}
              </span>
              <span className="tag mono">
                {s.pass}: {login.password}
              </span>
            </div>
          )}
          <p className="small muted">{login ? s.sendBoth : s.sendLink}</p>
          <div className="row share-actions">
            <button className="btn sm primary" onClick={() => copy('all', login ? `${url}\n${s.user}: ${login.user}\n${s.pass}: ${login.password}` : url)}>
              <Icon name="copy" />
              {copied === 'all' ? s.copied : login ? s.copyAll : s.copy}
            </button>
            {login && (
              <button className="btn sm" onClick={() => copy('url', url)}>
                <Icon name="copy" />
                {copied === 'url' ? s.copied : s.copy}
              </button>
            )}
            <button className="btn sm" onClick={() => window.netplain.openUrl(url)}>
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
      <div className="row share-go">
        <p className="small muted">
          {state.options && s.live(state.options.port)} {s.warn}
        </p>
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
    <Page title={t.share.title} note={t.share.lead}>
      {state && (state.status === 'off' ? <Form t={t} state={state} /> : <Live t={t} state={state} />)}
      {(state?.status !== 'off' || list.length > 0) && <Requests t={t} list={list} />}
    </Page>
  )
}
