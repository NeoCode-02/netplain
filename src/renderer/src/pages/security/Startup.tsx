import type { Security, SecurityTab } from '../../../../shared/types'
import { useAction } from '../../hooks'
import { type Dict } from '../../i18n'
import { ErrNote, Icon } from '../../ui'

/** What starts with Windows, with Task Manager’s own reversible switch. */
export default function Startup({ sec, t, onChanged, onTab }: { sec: Security; t: Dict; onChanged(): void; onTab(tab: SecurityTab): void }) {
  const v = t.security.startup
  const sv = t.security.services
  const { busy, err, run } = useAction()
  const toggle = (id: string, on: boolean) =>
    run(id, async () => {
      await window.netplain.setStartup(id, on)
      onChanged()
    })
  const autoServices = sec.services.filter((s) => s.start === 'Auto' && !s.microsoft).length
  const entries = [...sec.startup].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return (
    <>
      <p className="muted section-lead">{v.lead}</p>
      <ErrNote e={err} />
      {entries.length === 0 ? (
        <p className="list-empty">{v.empty}</p>
      ) : (
        <div className="list">
          {entries.map((x) => {
            const switchable = x.kind === 'task' || !!x.approved
            return (
              <div className={`list-row finding ${x.enabled ? '' : 'muted-row'}`} key={x.id}>
                <span className={`ad-icon ${x.suspicious ? 'level-warn' : ''}`}>
                  <Icon name={x.kind === 'task' ? 'clock' : 'box'} size={16} />
                </span>
                <div className="app-main">
                  <div className="row">
                    <span className="alert-title ellipsis">{x.kind === 'task' ? x.name.split('\\').pop() : x.name}</span>
                    <span className="tag">{v.kinds[x.kind]}</span>
                    {v.scope[x.hive] && <span className="tag">{v.scope[x.hive]}</span>}
                    {x.suspicious && <span className="tag warn">{v.suspicious}</span>}
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
