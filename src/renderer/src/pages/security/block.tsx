import { systemFile } from '../../../../shared/paths'
import type { Dict } from '../../i18n'
import { TwoStep } from '../../ui'

const WINDOWS = /Windows/.test(navigator.userAgent)
/** The system's own programs are neither blocked nor stopped (the main process refuses them too). */
export const ours = (path: string | null): path is string => !!path && !systemFile(path)
/** Firewall blocks are Windows only for now. */
export const blockable = (path: string | null): path is string => WINDOWS && ours(path)

/** "Cut off from the internet" for a program file (Windows Firewall, outbound). */
export const BlockApp = ({ t, path }: { t: Dict; path: string }) => (
  <div className="row conn-actions">
    <TwoStep label={t.connections.blockApp} title={t.connections.blockAppNote} sure={t.connections.sure} done={t.connections.done} run={() => window.netplain.block({ program: path })} />
  </div>
)
