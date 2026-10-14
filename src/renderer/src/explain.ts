import type { Adapter, Neighbor, PacketRow } from '../../shared/types'
import type { Dict } from './i18n'
import { addr } from './format'

export type What = keyof Dict['what']

const VIRTUAL: [What, RegExp][] = [
  ['virtualbox', /virtualbox|vboxnet/i],
  ['vmware', /vmware|vmnet/i],
  ['wsl', /\bwsl\b/i],
  ['hyperv', /hyper-v|vethernet/i],
  ['docker', /docker|\bveth|\bbr-/i],
  ['wifiDirect', /wi-fi direct/i],
  ['awdl', /\b(awdl|llw)\d/i],
  ['bridge', /bridge/i]
]
const VPN: [What, RegExp][] = [
  ['openvpn', /tap-windows|openvpn/i],
  ['wireguard', /wireguard|\bwg\d/i],
  ['tailscale', /tailscale/i]
]

/** Which plain-language story fits this adapter. */
export function what(a: Adapter): What {
  const text = `${a.name} ${a.description}`
  const pick = (rules: [What, RegExp][], fallback: What) => rules.find(([, re]) => re.test(text))?.[0] ?? fallback
  if (a.kind === 'virtual') return pick(VIRTUAL, 'virtual')
  if (a.kind === 'vpn') return pick(VPN, 'vpn')
  return a.kind === 'loopback' ? 'other' : a.kind
}

export type Role = keyof Dict['network']['role']
export const role = (a: Adapter, internetId: string | null): Role => (a.id === internetId ? 'internet' : a.up ? 'local' : 'down')

export function quality(signal: number): keyof Dict['network']['quality'] {
  return signal >= 80 ? 'excellent' : signal >= 60 ? 'good' : signal >= 40 ? 'fair' : 'weak'
}

export function addressKind(ip: string): keyof Dict['network']['address'] {
  const [a, b] = ip.split('.').map(Number)
  if (a === 169 && b === 254) return 'apipa'
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'private'
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat'
  return 'public'
}

export function bandKey(band: string): keyof Dict['network']['bandNote'] | null {
  const ghz = parseFloat(band)
  return ghz >= 5.9 ? '6' : ghz >= 4.9 ? '5' : ghz >= 2.3 ? '2.4' : null
}

export function authKey(auth: string): keyof Dict['network']['authNote'] | null {
  if (!auth) return null
  if (/wpa3|sae|owe/i.test(auth)) return 'strong'
  if (/wpa2|wpa\b|rsn|802\.1x|enterprise/i.test(auth)) return 'ok'
  return /wep|open|none/i.test(auth) ? 'weak' : null
}

/** The second hex digit of a locally administered MAC is 2, 6, A or E: randomised for privacy. */
export const randomMac = (mac: string) => /^.[26ae]/i.test(mac)

/** The adapter a neighbour was seen through: its id/name (macOS, Linux) or its local IPv4 (Windows). */
export const adapterOf = (n: Neighbor, adapters: Adapter[]) =>
  adapters.find((a) => a.id === n.via || a.name === n.via || a.ipv4.some((c) => addr(c) === n.via))

/** One-line headline for the network page. */
export function summary(t: Dict, adapters: Adapter[], internetId: string | null): string {
  const a = adapters.find((x) => x.id === internetId)
  if (!a) return t.network.offline
  if (a.kind === 'vpn') return t.network.vpnSummary(a.name)
  if (a.wifi?.ssid) return t.network.wifiSummary(a.wifi.ssid, a.name)
  return t.network.wiredSummary(a.name)
}

const PORTS: Record<string, string> = {
  'tcp:443': 'https',
  'tcp:8443': 'https',
  'udp:443': 'quic',
  'tcp:80': 'http',
  'tcp:8080': 'httpAlt',
  'udp:53': 'dns',
  'tcp:53': 'dns',
  'tcp:853': 'dot',
  'tcp:22': 'ssh',
  'tcp:21': 'ftp',
  'tcp:23': 'telnet',
  'tcp:25': 'mail',
  'tcp:465': 'mail',
  'tcp:587': 'mail',
  'tcp:993': 'mail',
  'tcp:995': 'mail',
  'tcp:143': 'mailPlain',
  'tcp:110': 'mailPlain',
  'tcp:3389': 'rdp',
  'tcp:445': 'smb',
  'tcp:139': 'smb',
  'tcp:135': 'rpc',
  'tcp:5228': 'push',
  'tcp:5223': 'push',
  'tcp:5222': 'chat',
  'udp:3478': 'calls',
  'udp:19302': 'calls',
  'udp:123': 'ntp',
  'udp:5353': 'mdns',
  'udp:1900': 'ssdp',
  'tcp:1433': 'db',
  'tcp:3306': 'db',
  'tcp:5432': 'db',
  'tcp:6379': 'db',
  'tcp:27017': 'db',
  'tcp:7680': 'delivery',
  'tcp:5040': 'cdp',
  'tcp:5357': 'wsd',
  'tcp:3000': 'dev',
  'tcp:5173': 'dev',
  'tcp:8000': 'dev'
}

/** Well-known service on a port, as a key of the `services` dictionary. */
export const service = (proto: string, port: number | null) => (port === null ? null : (PORTS[`${proto}:${port}`] ?? null))

/** Services that send their content as readable text. */
export const PLAIN = new Set(['http', 'httpAlt', 'dns', 'ftp', 'telnet', 'mailPlain'])

/** "Google LLC" → "Google", "\"Uzbektelekom\" Joint Stock Company" → "Uzbektelekom". */
export function company(org: string): string {
  return (
    org
      .replace(/["“”]/g, '')
      .replace(/[,\s]+(inc\.?|llc|ltd\.?|limited|co\.,?\s?ltd\.?|corporation|corp\.?|gmbh|s\.a\.|b\.v\.|plc|pbc|jsc|joint stock company|ag|oy|ab)$/i, '')
      .trim() || org
  )
}

/** Country name in the reader's language; the ISO code where the runtime has no name. */
export function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** "A, B and C" in the reader's language. */
export function listJoin(items: string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, { type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

/** One sentence about what a packet does, from what tshark and the flow table know. */
export function describePacket(p: PacketRow, t: Dict): string {
  const s = t.packets.say
  const where = p.peer ?? (p.dir === 'in' ? p.src : p.dst)
  if (p.dnsQuery) return p.dnsAnswers.length ? s.dnsAnswer(p.dnsQuery, p.dnsAnswers[0]) : s.dnsQuery(p.dnsQuery)
  if (p.sni && /hello/i.test(p.info)) return s.hello(p.sni)
  if (/^HTTP/.test(p.proto)) return s.http(p.info)
  if (p.proto === 'ARP') return s.arp(p.info)
  if (/^(MDNS|SSDP|LLMNR|NBNS|BROWSER|WSD|DHCP|IGMP)/i.test(p.proto)) return s.nearby
  if (/^ICMP/.test(p.proto)) return s.ping(p.info)
  if (p.transport === 'tcp' && /\[SYN\]/.test(p.info)) return s.open(where)
  if (p.transport === 'tcp' && /\[(FIN|RST)/.test(p.info)) return s.close
  if (/^(TLS|SSL|QUIC)/.test(p.proto) || p.sport === 443 || p.dport === 443) return p.dir === 'in' ? s.encryptedIn(where) : s.encryptedOut(where)
  return p.info
}

const LAYERS: [string, RegExp][] = [
  ['nearby', /^(Multicast Domain Name System|Simple Service Discovery|Link-local Multicast Name Resolution|NetBIOS)/],
  ['frame', /^Frame \d/],
  ['eth', /^Ethernet/],
  ['ip', /^Internet Protocol Version/],
  ['tcp', /^Transmission Control Protocol/],
  ['udp', /^User Datagram Protocol/],
  ['tls', /^(Transport Layer Security|TLS)/],
  ['quic', /^QUIC/],
  ['dns', /^Domain Name System/],
  ['http', /^Hypertext Transfer Protocol/],
  ['arp', /^Address Resolution Protocol/],
  ['icmp', /^Internet Control Message Protocol/]
]

/** Plain-language note for a top-level line of Wireshark's details, if we have one. */
export const layerKey = (text: string) => LAYERS.find(([, re]) => re.test(text))?.[0] ?? null

/** Quick filters that need no Wireshark syntax. */
export const PRESETS = {
  all: () => true,
  sites: (p: PacketRow) => !!(p.sni || p.host),
  dns: (p: PacketRow) => !!p.dnsQuery,
  plain: (p: PacketRow) => [service(p.transport, p.dport), service(p.transport, p.sport)].some((s) => s !== null && PLAIN.has(s)),
  local: (p: PacketRow) => p.dir === null || /^(ARP|MDNS|SSDP|LLMNR|NBNS|BROWSER|WSD|DHCP|IGMP)/i.test(p.proto)
}

/** "Trojan:Win32/SuspExec.SE" → its category, platform and family, as Microsoft names threats. */
export function threatParts(name: string): { category: string; platform: string; family: string } | null {
  const m = /^([A-Za-z]+):([A-Za-z0-9]+)\/([^.!]+)/.exec(name)
  return m ? { category: m[1], platform: m[2], family: m[3] } : null
}

/** Caught by behaviour (what it did) rather than by a known file. */
export const behavioural = (name: string) => /Behavior:|Susp|!ml|!MTB/i.test(name)
