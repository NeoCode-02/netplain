import type { Adapter, Snapshot } from './types'

/** The adapter the internet goes through, when there is one. */
export const internetOf = (snap: Snapshot | null | undefined): Adapter | undefined => snap?.adapters.find((a) => a.id === snap.defaultId)

/** Files of the operating system itself: stopping or cutting them off can take the computer down. */
export const systemFile = (path: string) => /^([a-z]:\\windows\\|\/(System|usr\/libexec|usr\/lib|usr\/sbin|sbin|lib)\/)/i.test(path)
