import type { Finding, Security, SecurityTab } from '../../../../shared/types'
import { useAction } from '../../hooks'
import { type Dict } from '../../i18n'
import { ErrNote, Icon, type IconName } from '../../ui'

const MARK: Record<Finding['level'], IconName> = { bad: 'alert', warn: 'alert', info: 'dot', ok: 'shield' }

/** The "was I hacked?" verdict and every finding, each with its fix or the tab that explains it. */
export default function Status({ sec, t, onTab, onChanged }: { sec: Security; t: Dict; onTab(tab: SecurityTab): void; onChanged(): void }) {
  const s = t.security
  const { busy, err, run } = useAction()
  const bad = sec.findings.filter((f) => f.level === 'bad').length
  const warn = sec.findings.filter((f) => f.level === 'warn').length
  const fix = (key: string, what: NonNullable<Finding['fix']>) =>
    run(key, async () => {
      await window.netplain.fixFinding(what)
      // Opening Windows Security changes nothing by itself.
      if (what !== 'openDefender') onChanged()
    })
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
      <ErrNote e={err} />
      <div className="list section">
        {sec.findings.map((f) => {
          const [title, body] = s.findings[f.key] ?? [f.key, () => '']
          const what = f.fix
          const tab = f.tab
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
                {what && (
                  <button className="btn sm" disabled={busy !== null} onClick={() => void fix(f.key, what)}>
                    {busy === f.key && <Icon name="refresh" className="spin" />}
                    {s.fix[what]}
                  </button>
                )}
                {tab && tab !== 'status' && (
                  <button className="btn quiet sm" onClick={() => onTab(tab)}>
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
