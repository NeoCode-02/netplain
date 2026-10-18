import { useEffect, useState } from 'react'
import type { Blocked as Rule } from '../../../../shared/types'
import { useAction } from '../../hooks'
import { type Dict } from '../../i18n'
import { AppIcon, Empty, ErrNote, Icon } from '../../ui'

const file = (p: string) => p.split('\\').pop() ?? p

/** Netplain's own Windows Firewall rules, each with a way back. */
export default function Blocked({ t }: { t: Dict }) {
  const b = t.security.blocked
  const [list, setList] = useState<Rule[] | null>(null)
  const { busy, err, run } = useAction()
  useEffect(() => void run('load', () => window.netplain.blocked()).then((l) => l && setList(l)), [run])
  const unblock = (name: string) => void run(name, () => window.netplain.unblock(name)).then((l) => l && setList(l))

  return (
    <>
      <p className="small muted section-lead">{b.lead}</p>
      <ErrNote e={err} />
      {list?.length === 0 && <Empty icon="shield" title={b.empty} body={b.emptyBody} />}
      {!!list?.length && (
        <div className="list">
          {list.map((x) => (
            <div className="list-row" key={x.name}>
              {x.program ? (
                <AppIcon path={x.program} />
              ) : (
                <span className="app-icon">
                  <Icon name="globe" size={16} />
                </span>
              )}
              <div className="app-main">
                <div className="alert-title ellipsis">{x.program ? file(x.program) : x.ip}</div>
                <p className="small muted ellipsis">{x.program ? `${b.program} · ${x.program}` : b.ip}</p>
              </div>
              <button className="btn sm" disabled={busy !== null} onClick={() => unblock(x.name)}>
                {busy === x.name && <Icon name="refresh" className="spin" />}
                {b.unblock}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
