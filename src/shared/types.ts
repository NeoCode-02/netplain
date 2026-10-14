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

export type AlertKind = 'newApp' | 'exposed' | 'plain' | 'blocklist'

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
