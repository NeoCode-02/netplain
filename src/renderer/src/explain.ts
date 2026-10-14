import type { Adapter, Neighbor } from '../../shared/types'
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
