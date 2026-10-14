import type {
  Alert,
  BlocklistInfo,
  Connections,
  DiagnoseStep,
  Finding,
  GeoInfo,
  Hop,
  LookupResult,
  Neighbor,
  PacketBatch,
  PacketDetail,
  PingResult,
  PortState,
  PublicIp,
  Release,
  ScanKind,
  ScanState,
  Security,
  Settings,
  ShareOptions,
  ShareRequest,
  ShareRequestDetail,
  ShareState,
  Snapshot,
  Traffic,
  Usage,
  UsageRange
} from './types'

/** Main → renderer pushes. */
export const CHANNELS = { snapshot: 'np:snapshot', problem: 'np:problem', traffic: 'np:traffic', alert: 'np:alert', share: 'np:share' } as const

/**
 * Everything the UI can ask the main process for. Each method is one IPC handler of the same name
 * (src/main/index.ts). Errors are thrown as `E_CODE` (translated in the renderer's i18n).
 */
export interface Api {
  appInfo(): { version: string; platform: string }
  /** A newer release on GitHub (asked once per run); null when up to date, offline or turned off. */
  update(): Promise<Release | null>
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
  /** Captured packets after frame `after` of capture session `session` (pass 0, 0 at first). */
  packets(session: number, after: number): PacketBatch
  /** Wireshark's full breakdown of one packet. Throws E_NO_CAPTURE. */
  packetDetail(n: number): Promise<PacketDetail>
  /** Frames matching a Wireshark display filter. Throws E_FILTER|message / E_NO_CAPTURE. */
  packetFilter(expr: string): Promise<number[]>
  /** Asks where to save the capture so far (.pcapng); false when cancelled. */
  savePackets(): Promise<boolean>
  /** Opens the capture so far in Wireshark. */
  openInWireshark(): void
  /** Data used per hour (today) or per day (last 7 / 30 days). */
  usage(range: UsageRange): Usage
  alerts(): Alert[]
  markAlertsRead(): void
  clearAlerts(): void
  blocklistInfo(): BlocklistInfo
  /** Downloads FireHOL level 1 from GitHub. Throws E_BLOCKLIST_DOWNLOAD. */
  updateFirehol(): Promise<BlocklistInfo>
  removeFirehol(): BlocklistInfo
  /** ICMP echo, 4 probes. */
  ping(host: string): Promise<PingResult>
  /** Route to a host, up to 15 hops, with each hop's company and country. */
  trace(host: string): Promise<Hop[]>
  /** Name → addresses, or IP → names. Throws E_NOT_FOUND. */
  lookup(name: string): Promise<LookupResult>
  checkPort(host: string, port: number): Promise<PortState>
  /** Asks api.ipify.org for the address the internet sees. Throws E_PUBLIC_IP. */
  publicIp(): Promise<PublicIp>
  /** Checks adapter → address → router → DNS → internet. */
  diagnose(): Promise<DiagnoseStep[]>
  /** The following ask for admin rights through the OS prompt when needed; throw E_CANCELLED / E_ADMIN. */
  flushDns(): Promise<void>
  renewIp(adapterId: string): Promise<void>
  restartAdapter(adapterId: string): Promise<void>
  /** Windows security picture (cached a minute unless `fresh`). Throws E_UNSUPPORTED elsewhere. */
  security(fresh?: boolean): Promise<Security>
  /** Runs the fix a finding offers (firewall on asks for admin rights). */
  fixFinding(fix: NonNullable<Finding['fix']>): Promise<void>
  scanState(): ScanState
  /** Starts a Defender scan in the background; `admin` runs it through UAC. */
  startScan(kind: ScanKind, admin: boolean): void
  updateDefinitions(): Promise<void>
  /** Has Defender clean every active threat (UAC). */
  removeThreats(): Promise<void>
  /** Turns a startup entry on or off (Task Manager's reversible switch; UAC for machine-wide entries). */
  setStartup(id: string, on: boolean): Promise<void>
  /** Starts/stops a service or sets how it starts (UAC). */
  setService(name: string, action: 'start' | 'stop' | 'auto' | 'manual' | 'disabled'): Promise<void>
  /** Turns an account off/on or takes its admin rights (UAC). Throws E_SELF / E_LAST_ADMIN to prevent a lock-out. */
  setUser(name: string, action: 'disable' | 'enable' | 'unadmin'): Promise<void>
  /** The shared local site, if any (changes are also pushed on the share channel). */
  shareState(): Promise<ShareState>
  /** Gives localhost:port a public https:// link. Throws E_NO_CLOUDFLARED; tunnel failures arrive in the state. */
  shareStart(o: ShareOptions): Promise<void>
  shareStop(): void
  /** Visitors' requests after request `after` (pass 0 at first). */
  shareRequests(after: number): ShareRequest[]
  shareRequest(id: number): ShareRequestDetail | null
  /** Sends a logged request to the local site again. */
  shareReplay(id: number): Promise<void>
  /** Downloads Cloudflare's tunnel program (~55 MB from GitHub). Throws E_CLOUDFLARED_DOWNLOAD / E_CLOUDFLARED_SIGNATURE. */
  installCloudflared(): Promise<void>
}
