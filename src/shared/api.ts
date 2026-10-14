import type { Connections, GeoInfo, Neighbor, Settings, Snapshot, Traffic } from './types'

/** Main → renderer pushes. */
export const CHANNELS = { snapshot: 'np:snapshot', problem: 'np:problem', traffic: 'np:traffic' } as const

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
  /** Open sockets with their app, DNS name and location. */
  connections(): Promise<Connections>
  /** A running program's icon as a data URL; only paths of processes seen by `connections`. */
  appIcon(path: string): Promise<string | null>
  geoInfo(): GeoInfo
  /** Downloads DB-IP Lite (~9 MB from db-ip.com) into the app's data folder. Throws E_GEO_DOWNLOAD. */
  geoUpdate(): Promise<GeoInfo>
  /** Per-app traffic since the capture started (also pushed every second). */
  traffic(): Traffic | null
  /** Looks for Wireshark again and restarts the capture (after installing it or fixing permissions). */
  retryCapture(): void
  /** Linux: asks for the admin password to let this user capture. Throws E_ALLOW_CAPTURE / E_UNSUPPORTED. */
  allowCapture(): Promise<void>
}
