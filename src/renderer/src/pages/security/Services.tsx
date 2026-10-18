import { useState } from 'react'
import type { Security, ServiceAction } from '../../../../shared/types'
import { useAction } from '../../hooks'
import { type Dict } from '../../i18n'
import { ErrNote, Icon } from '../../ui'

const MODE: Record<string, ServiceAction> = { Auto: 'auto', Manual: 'manual', Disabled: 'disabled' }

/** Background programs: start, stop and how each starts. */
export default function Services({ sec, t, onChanged }: { sec: Security; t: Dict; onChanged(): void }) {
  const v = t.security.services
  const [filter, setFilter] = useState<'third' | 'running' | 'all'>('third')
  const [query, setQuery] = useState('')
  const { busy, err, run } = useAction()
  const [confirm, setConfirm] = useState<string | null>(null)
  const act = (name: string, action: ServiceAction) => {
    setConfirm(null)
    return run(name, async () => {
      await window.netplain.setService(name, action)
      onChanged()
    })
  }
  const q = query.trim().toLowerCase()
  const list = sec.services
    .filter((s) => (filter === 'third' ? !s.microsoft : filter === 'running' ? s.state === 'Running' : true))
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
      <ErrNote e={err} />
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
                  const next = e.target.value as ServiceAction
                  if (next === 'disabled' && s.microsoft) setConfirm(s.name)
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
