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
