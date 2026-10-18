import type { Security, UserAction } from '../../../../shared/types'
import { useAction } from '../../hooks'
import { getLang, type Dict } from '../../i18n'
import { ErrNote, Icon } from '../../ui'

/** Accounts on this computer: who can sign in and who is an administrator. */
export default function Users({ sec, t, onChanged }: { sec: Security; t: Dict; onChanged(): void }) {
  const u = t.security.users
  const lang = getLang()
  const { busy, err, run } = useAction()
  const act = (name: string, action: UserAction) =>
    run(`${name}|${action}`, async () => {
      await window.netplain.setUser(name, action)
      onChanged()
    })
  // You first, then people who can sign in, then the rest.
  const users = [...sec.users].sort((a, b) => Number(b.me) - Number(a.me) || Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  return (
    <>
      <p className="muted section-lead">{u.lead}</p>
      <ErrNote e={err} />
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
