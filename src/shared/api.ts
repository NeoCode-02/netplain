import type { Neighbor, Settings, Snapshot } from './types'

/** Main → renderer pushes. */
export const CHANNELS = { snapshot: 'np:snapshot', problem: 'np:problem' } as const

/**
 * Everything the UI can ask the main process for. Each method is one IPC handler of the same name
 * (src/main/index.ts). Errors are thrown as `E_CODE` (translated in the renderer's i18n).
 */
export interface Api {
  appInfo(): { version: string; platform: string }
  getSettings(): Settings
  saveSettings(s: Settings): void
  /** The latest adapter snapshot, or null before the first one arrives. */
  snapshot(): Snapshot | null
  /** Devices on the local networks, with their maker when Wireshark is installed. */
  neighbors(): Promise<Neighbor[]>
  /** Wakes the hosts around the internet adapter's address, then lists devices. Throws E_OFFLINE / E_NOT_PRIVATE. */
  scan(): Promise<Neighbor[]>
  /** Opens an https link in the default browser. */
  openUrl(url: string): void
}
