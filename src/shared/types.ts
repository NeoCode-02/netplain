export type AdapterKind = 'wifi' | 'ethernet' | 'virtual' | 'vpn' | 'bluetooth' | 'cellular' | 'loopback' | 'other'

export interface Wifi {
  ssid: string
  bssid: string
  /** 0–100, as the OS reports it. */
  signal: number | null
  channel: number | null
  /** "2.4 GHz", "5 GHz", "6 GHz" or ''. */
  band: string
  /** "802.11ax" or ''. */
  radio: string
  /** "WPA2-Personal" or ''. */
  auth: string
  rxMbps: number | null
  txMbps: number | null
}

export interface Adapter {
  id: string
  name: string
  /** Hardware or driver description; '' where the OS has none. */
  description: string
  kind: AdapterKind
  up: boolean
  /** Lowercase, colon separated; '' when the adapter has none. */
  mac: string
  /** Bits per second. */
  speed: number | null
  /** "192.168.0.102/24" */
  ipv4: string[]
  /** "fe80::1/64", without zone id. */
  ipv6: string[]
  gateway: string | null
  dns: string[]
  dhcp: boolean | null
  /** Bytes since the adapter came up; a drop means it was reset. */
  rx: number
  tx: number
  wifi: Wifi | null
}

export interface Snapshot {
  at: number
  adapters: Adapter[]
  /** The adapter the OS uses to reach the internet. */
  defaultId: string | null
}

export interface Neighbor {
  ip: string
  mac: string
  /** Local IPv4 of the adapter that sees it. */
  via: string
  vendor: string | null
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  /** Watch traffic with Wireshark's engine when it is installed. */
  capture: boolean
  /** Which signals raise an alert. */
  alerts: Record<AlertKind, boolean>
  /** IPs and CIDR ranges the user never wants to see, one per line. */
  blocklist: string
  /** Ask GitHub once per start whether a newer version is out. */
  updates: boolean
  /** Closing the window keeps Netplain running in the tray. */
  background: boolean
  /** Start in the tray at login. Read from the system, not from the settings file. */
  autostart: boolean
  /** Check the router, the internet and DNS every 5 s and log connection drops. */
  uptime: boolean
  /** Monthly data limit to warn about, or none. */
  cap: DataCap | null
}

/** A newer Netplain on GitHub. */
export interface Release {
  version: string
  url: string
}

/** One open TCP/UDP socket as the OS lists it. */
export interface Socket {
  proto: 'tcp' | 'udp'
  /** '0.0.0.0' / '::' = every address. */
  localIp: string
  localPort: number
  remoteIp: string | null
  remotePort: number | null
  /** 'listen', 'established', 'time_wait', …; UDP is 'bound' until it has a peer. */
  state: string
  pid: number | null
}

export interface Proc {
  pid: number
  /** Executable name, e.g. "chrome". */
  name: string
  path: string | null
  /** Human name where the OS has one ("Google Chrome"). */
  title: string | null
}

export type Scope = 'internet' | 'local' | 'loopback'

/** A socket with who owns it and where it goes. */
export interface Conn extends Socket {
  app: string
  title: string | null
  path: string | null
  /** Domain name, when this computer looked it up recently. */
  host: string | null
  /** ISO 3166 code. */
  country: string | null
  org: string | null
  scope: Scope
}

export interface Connections {
  at: number
  /** Sockets with a peer. */
  conns: Conn[]
  /** TCP ports waiting for others to connect. */
  listening: Conn[]
}

export interface GeoInfo {
  ready: boolean
  /** When DB-IP built the database (ms). */
  built: number | null
}

/** One captured packet, as tshark dissected it. */
export interface Packet {
  n: number
  /** ms since epoch */
  t: number
  len: number
  src: string
  dst: string
  sport: number | null
  dport: number | null
  transport: 'tcp' | 'udp' | 'other'
  /** Wireshark's protocol column: "TLSv1.3", "DNS", "QUIC"… */
  proto: string
  info: string
  dnsQuery: string | null
  /** Addresses in a DNS answer. */
  dnsAnswers: string[]
  /** Server name from a TLS/QUIC hello. */
  sni: string | null
  /** HTTP Host header. */
  host: string | null
}

/** 'missing' = Wireshark is not installed; 'denied' = the OS refused to capture. */
export type CaptureState = 'missing' | 'off' | 'starting' | 'on' | 'denied' | 'error'

export interface Place {
  /** Domain when known, else the IP. */
  name: string
  ip: string
  rx: number
  tx: number
  org: string | null
  country: string | null
}

export interface AppTraffic {
  key: string
  app: string
  title: string | null
  path: string | null
  rx: number
  tx: number
  /** Bits per second over the last refresh. */
  rxRate: number
  txRate: number
  places: Place[]
}

export interface Traffic {
  state: CaptureState
  /** Adapter being watched. */
  adapterId: string | null
  since: number | null
  apps: AppTraffic[]
  rx: number
  tx: number
}

/** A packet with what Netplain knows about it. */
export interface PacketRow extends Packet {
  /** Seen from this computer; null for traffic between other devices (broadcasts). */
  dir: 'in' | 'out' | null
  /** Program that owns the flow, when known. */
  app: string | null
  /** Domain of the other end, when known. */
  peer: string | null
}

/** Packets after a given frame; `session` changes whenever a new capture file starts (numbers restart). */
export interface PacketBatch {
  session: number
  rows: PacketRow[]
}

/** One line of Wireshark's packet details and the lines under it. */
export interface DetailNode {
  text: string
  children: DetailNode[]
}

export interface PacketDetail {
  tree: DetailNode[]
  /** Hex and ASCII dump of the bytes. */
  hex: string
}

export type UsageRange = 'day' | 'week' | 'month'

export interface UsagePoint {
  /** Start of the hour (day range) or day (week/month), ms. */
  at: number
  rx: number
  tx: number
}

export interface UsageRow {
  key: string
  name: string
  path: string | null
  rx: number
  tx: number
}

export interface Usage {
  range: UsageRange
  /** Internet adapters only (Wi-Fi, Ethernet, mobile), so local virtual traffic is not counted. */
  points: UsagePoint[]
  apps: UsageRow[]
  adapters: UsageRow[]
  rx: number
  tx: number
}

export type AlertKind = 'newApp' | 'exposed' | 'plain' | 'blocklist' | 'outage' | 'monitorDown' | 'monitorUp' | 'certExpiry' | 'dataCap'

/** A network as History counts it: "wifi:<name>" for Wi-Fi, "<kind>:<adapter>" otherwise. */
export interface NetworkUse {
  key: string
  name: string
  bytes: number
}

/** A monthly allowance, e.g. for mobile internet or a phone's hotspot. */
export interface DataCap {
  /** A NetworkUse key, or '' for all networks together. */
  network: string
  /** Decimal gigabytes, as providers count them. */
  gb: number
  /** Day of the month the count starts again (1–28). */
  day: number
}

export interface CapState {
  network: string
  /** The network's name, null for all networks. */
  name: string | null
  used: number
  limit: number
  /** This period: from the reset day to the next one. */
  start: number
  end: number
}

/** A site or server the user wants watched: a web address, "host:port", or a host to ping. */
export type MonitorKind = 'http' | 'tcp' | 'ping'

export interface Monitor {
  id: string
  kind: MonitorKind
  target: string
  /** Seconds between checks. */
  every: 60 | 300
}

export interface MonitorState extends Monitor {
  /** null before the first check. */
  up: boolean | null
  ms: number | null
  /** HTTP status of the last answer. */
  status: number | null
  /** Why the last check failed: an E_ code or a TLS / network error code. */
  error: string | null
  /** Days until the https certificate expires. */
  certDays: number | null
  /** When the current up/down state began. */
  since: number | null
  checked: number | null
  /** The last 24 hours of checks (ms, or null when it failed). */
  history: { at: number; ms: number | null }[]
}

/** Where a drop in the connection came from, nearest to this computer first. */
export type OutageCause = 'adapter' | 'router' | 'provider' | 'dns'

export interface Outage {
  id: string
  start: number
  /** null while it lasts. */
  end: number | null
  cause: OutageCause
  /** The network it happened on: Wi-Fi name or adapter name. */
  network: string | null
}

/** One minute of connection checks. */
export interface QualityPoint {
  /** Start of the minute. */
  at: number
  /** Average time to reach the internet / the router, ms; null when none answered. */
  internet: number | null
  router: number | null
  /** Share of internet checks that failed, 0–1. */
  loss: number
}

export interface Uptime {
  /** Checking is switched on in Settings. */
  on: boolean
  /** The latest check (one every 5 s); router null = no answer, routerKnown false = it never answers checks. */
  now: { at: number; internet: number | null; router: number | null; routerKnown: boolean; dns: boolean | null } | null
  /** The last 24 hours. */
  points: QualityPoint[]
  /** Newest first. */
  outages: Outage[]
}

export interface Alert {
  id: string
  at: number
  kind: AlertKind
  /** Program it is about. */
  app: string
  /** Host, IP or port, depending on the kind. */
  detail: string
  read: boolean
}

export interface BlocklistInfo {
  /** Ranges typed by the user. */
  own: number
  /** Ranges from FireHOL level 1, or null when not downloaded. */
  firehol: number | null
  fireholAt: number | null
}

export interface PingResult {
  host: string
  ip: string | null
  /** Round-trip times in ms; null for a lost probe. */
  times: (number | null)[]
}

export interface Hop {
  n: number
  ip: string | null
  /** Best of the probe times, ms. */
  ms: number | null
  org: string | null
  country: string | null
}

export interface LookupResult {
  name: string
  addresses: { ip: string; org: string | null; country: string | null }[]
  /** Names found for an IP (reverse lookup). */
  names: string[]
  ms: number
}

export type PortState = 'open' | 'closed' | 'filtered'

export type RecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA' | 'CAA' | 'SRV'

/** One DNS server's answer, timed. */
export interface DnsAnswer {
  /** "system" for this computer's own DNS server, else the public service's name. */
  server: string
  ip: string | null
  ms: number
  records: string[]
  /** none: the name exists without such records; nxdomain: no such name. */
  error: 'none' | 'nxdomain' | 'timeout' | 'fail' | null
}

/** What a domain's SPF and DMARC records say about mail sent in its name. */
export interface MailPolicy {
  spf: 'strict' | 'soft' | 'open' | 'missing'
  dmarc: 'reject' | 'quarantine' | 'none' | 'missing'
  spfRecord: string | null
  dmarcRecord: string | null
}

export interface DnsReport {
  name: string
  type: RecordType | 'PTR'
  answers: DnsAnswer[]
  /** For MX and TXT questions. */
  mail: MailPolicy | null
}

/** Registration data of a domain or an IP block (RDAP). Dates are YYYY-MM-DD. */
export interface Whois {
  kind: 'ip' | 'domain'
  name: string
  /** Null when there is none or the registry hides it for privacy. */
  holder: string | null
  /** The network's own description (IP blocks). */
  about: string | null
  registrar: string | null
  country: string | null
  range: string | null
  created: string | null
  updated: string | null
  expires: string | null
  abuse: string | null
  status: string[]
  nameservers: string[]
}

export type SpeedPhase = 'latency' | 'down' | 'up'

/** One speed test; rates in Mbit/s, times in ms. Filled in phase by phase. */
export interface SpeedResult {
  at: number
  down: number | null
  up: number | null
  /** Latency with nothing else going on. */
  idle: number | null
  jitter: number | null
  /** Latency while downloading / uploading at full speed (bufferbloat). */
  loadedDown: number | null
  loadedUp: number | null
  /** Cloudflare's site that answered (airport code, e.g. "FRA"). */
  server: string | null
  /** Data the test moved. */
  bytes: number
}

export type SecHeader ='hsts' | 'csp' | 'frames' | 'nosniff' | 'referrer' | 'permissions'

/** One certificate of a chain; dates are YYYY-MM-DD. */
export interface CertInfo {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  /** Names it is valid for (SAN). */
  names: string[]
}

export interface TlsInfo {
  protocol: string | null
  cipher: string | null
  /** The chain is trusted and matches the name. */
  authorized: boolean
  /** Why not (Node's code, e.g. CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID). */
  error: string | null
  chain: CertInfo[]
}

/** A website checked the way a browser reaches it: redirects, security headers, TLS. */
export interface SiteReport {
  url: string
  hops: { url: string; status: number }[]
  status: number
  server: string | null
  headers: { key: SecHeader; value: string | null }[]
  tls: TlsInfo | null
  /** Typed without https: whether plain http moved to https (null when it started on https). */
  upgrade: boolean | null
}

/** An open port found by the scanner, with what the service said about itself. */
export interface ScanHit {
  port: number
  banner: string | null
}

export interface PublicIp {
  ip: string
  org: string | null
  country: string | null
}

export type StepState = 'ok' | 'fail' | 'skip'

/** "Why is there no internet?": one link of the chain from this computer to the internet. */
export interface DiagnoseStep {
  key: 'adapter' | 'address' | 'router' | 'dns' | 'internet'
  state: StepState
  detail: string
}

/** Authenticode signature of a program file. */
export interface Signer {
  status: 'valid' | 'unsigned' | 'invalid'
  publisher: string | null
}

export interface SecUser {
  name: string
  enabled: boolean
  /** ISO time of the last sign-in, if Windows recorded one. */
  last: string | null
  sid: string
  admin: boolean
  /** The account running Netplain. */
  me: boolean
}

export interface SecService {
  name: string
  display: string
  desc: string
  state: string
  start: string
  account: string
  path: string
  exe: string | null
  signer: Signer | null
}

export interface SecStartup {
  /** Stable id for actions: kind|hive|key|name (or the task path). */
  id: string
  kind: 'run' | 'folder' | 'task'
  hive: string
  /** StartupApproved key holding the on/off switch; '' for RunOnce and tasks. */
  approved: string
  name: string
  command: string
  enabled: boolean
  exe: string | null
  signer: Signer | null
}

export interface SecThreat {
  id: string
  name: string
  severity: number
  active: boolean
  resources: string[]
  /** Latest detection of this threat. */
  at: string | null
  status: number | null
}

export type FindingLevel = 'ok' | 'info' | 'warn' | 'bad'
export type SecurityTab = 'status' | 'antivirus' | 'users' | 'services' | 'startup'

/** One check of the "was I hacked?" list; its text lives in the renderer's dictionary under `key`. */
export interface Finding {
  key: string
  level: FindingLevel
  params: Record<string, string | number>
  /** Action the app can take for it. */
  fix?: 'firewallOn' | 'openDefender'
  /** Tab that shows the details. */
  tab?: SecurityTab
}

export interface Security {
  at: number
  defender: { av: boolean; rt: boolean; sigAge: number; quickAge: number; fullAge: number; tamper: boolean } | null
  threats: SecThreat[]
  users: SecUser[]
  services: SecService[]
  startup: SecStartup[]
  firewall: { name: string; on: boolean }[]
  uac: { lua: number; consent: number }
  rdpDenied: number
  sac: number | null
  proxy: { on: number; server: string; pac: string }
  hosts: string[]
  /** Date of the newest installed Windows update (yyyy-mm-dd). */
  updated: string | null
  findings: Finding[]
}

export type ScanKind = 'quick' | 'full'

export interface ScanState {
  running: ScanKind | null
  started: number | null
  /** The last finished scan: MpCmdRun's exit code (0 = nothing found, 2 = threats found). */
  last: { kind: ScanKind; at: number; code: number } | null
}

/** A web site running on this computer, found by asking its listening ports. */
export interface LocalSite {
  port: number
  https: boolean
  /** Its page title, when the front page is HTML. */
  title: string | null
  /** The program serving it. */
  app: string
  /** Served by a development tool (node, python, docker…), so most likely the user's own site. */
  dev: boolean
}

/** Who carries a shared local site to the internet: Cloudflare Quick Tunnel or localhost.run over ssh. */
export type ShareProvider = 'cloudflare' | 'ssh'

export interface ShareOptions {
  port: number
  /** The local site itself speaks https (self-signed certificates are accepted on this computer). */
  https: boolean
  provider: ShareProvider
  /** Ask visitors for a password (HTTP Basic). */
  password: boolean
}

export interface ShareState {
  status: 'off' | 'starting' | 'on' | 'reconnecting'
  options: ShareOptions | null
  /** The public https:// link. */
  url: string | null
  /** Login visitors need when `options.password` is on. */
  login: { user: string; password: string } | null
  /** Why the last start or connection failed: an E_ code. */
  error: string | null
  /** cloudflared: where it was found, or null when it has to be downloaded. */
  cloudflared: 'system' | 'app' | null
}

/** One request a visitor made through the shared link. */
export interface ShareRequest {
  id: number
  at: number
  method: string
  path: string
  /** null while the answer is still coming, or when the local site did not answer. */
  status: number | null
  ms: number | null
  /** Bytes sent back to the visitor. */
  bytes: number
  /** The visitor's address as the tunnel reports it; 'replay' for a request sent again from Netplain. */
  ip: string | null
  country: string | null
  error: string | null
}

export interface ShareRequestDetail extends ShareRequest {
  reqHeaders: [string, string][]
  /** Up to 64 KB of each body, as text. */
  reqBody: string
  resHeaders: [string, string][]
  resBody: string
}
