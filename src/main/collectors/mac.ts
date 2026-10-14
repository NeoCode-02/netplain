import type { Adapter, AdapterKind, Neighbor, Wifi } from '../../shared/types'
import { noZone, run, tryRun } from '../exec'
import { adapterKind, normMac } from './kind'
import { poll, type Collector } from './common'

interface Iface {
  name: string
  up: boolean
  mac: string
  ipv4: string[]
  ipv6: string[]
  speed: number | null
}

const prefix4 = (mask: string) => (mask.startsWith('0x') ? (parseInt(mask, 16) >>> 0).toString(2).replace(/0/g, '').length : 0)

/** `ifconfig`: one block per interface, details indented with a tab. */
export function parseIfconfig(text: string): Iface[] {
  const out: Iface[] = []
  for (const block of text.split(/\n(?=\S)/)) {
    const head = /^(\S+?):\s+flags=\w+<([^>]*)>/.exec(block)
    if (!head) continue
    const status = /\n\s+status:\s+(\w+)/.exec(block)?.[1]
    const media = /\n\s+media:.*\((\d+)base/.exec(block)?.[1]
    out.push({
      name: head[1],
      up: head[2].split(',').includes('UP') && status !== 'inactive',
      mac: normMac(/\n\s+ether\s+(\S+)/.exec(block)?.[1] ?? ''),
      ipv4: [...block.matchAll(/\n\s+inet\s+(\S+)\s+netmask\s+(\S+)/g)].map((m) => `${m[1]}/${prefix4(m[2])}`),
      ipv6: [...block.matchAll(/\n\s+inet6\s+(\S+)\s+prefixlen\s+(\d+)/g)].map((m) => `${noZone(m[1])}/${m[2]}`),
      speed: media ? Number(media) * 1e6 : null
    })
  }
  return out
}

/** `netstat -ibn`: byte counters from each interface's <Link#n> row (the Address column may be empty). */
export function parseNetstat(text: string): Map<string, { rx: number; tx: number }> {
  const out = new Map<string, { rx: number; tx: number }>()
  for (const line of text.split('\n')) {
    const c = line.trim().split(/\s+/)
    if (!c[2]?.startsWith('<Link#') || out.has(c[0])) continue
    out.set(c[0], { rx: Number(c.at(-5)) || 0, tx: Number(c.at(-2)) || 0 })
  }
  return out
}

/** `networksetup -listallhardwareports` → device → port name ("Wi-Fi", "Thunderbolt Ethernet"). */
export function parsePorts(text: string): Map<string, string> {
  return new Map([...text.matchAll(/Hardware Port:\s*(.+)\nDevice:\s*(\S+)/g)].map((m) => [m[2], m[1].trim()]))
}

/** `route -n get default` */
export function parseDefaultRoute(text: string) {
  return { gateway: /gateway:\s*(\S+)/.exec(text)?.[1] ?? null, iface: /interface:\s*(\S+)/.exec(text)?.[1] ?? null }
}

/** `scutil --dns`: the first resolver's servers are the ones in use. */
export function parseScutil(text: string): string[] {
  const first = text.split(/\nresolver #/)[1] ?? ''
  return [...first.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => noZone(m[1]))
}

/** `arp -an`: "? (192.168.1.1) at a4:2b:b0:11:22:33 on en0 ifscope [ethernet]" */
export function parseArpMac(text: string): Neighbor[] {
  return [...text.matchAll(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+) on (\S+)/gi)]
    .map((m) => ({ ip: m[1], mac: normMac(m[2]), via: m[3], vendor: null }))
    .filter((n) => n.mac && n.mac !== 'ff:ff:ff:ff:ff:ff')
}

/** `system_profiler SPAirPortDataType -json`. Recent macOS hide the SSID from apps without Location access. */
export function parseAirport(json: string): Map<string, Wifi> {
  const out = new Map<string, Wifi>()
  let data: { SPAirPortDataType?: { spairport_airport_interfaces?: Record<string, unknown>[] }[] }
  try {
    data = JSON.parse(json)
  } catch {
    return out
  }
  for (const i of data.SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? []) {
    const cur = i.spairport_current_network_information as Record<string, unknown> | undefined
    if (!cur) continue
    const chan = String(cur.spairport_network_channel ?? '')
    const dbm = /(-\d+)\s*dBm/.exec(String(cur.spairport_signal_noise ?? ''))?.[1]
    const ssid = String(cur._name ?? '')
    out.set(String(i._name), {
      ssid: ssid === '<redacted>' ? '' : ssid,
      bssid: '',
      // Common dBm → % mapping: -50 dBm or better is 100 %, -100 dBm is 0 %.
      signal: dbm ? Math.max(0, Math.min(100, 2 * (Number(dbm) + 100))) : null,
      channel: parseInt(chan, 10) || null,
      band: /(\d+(?:\.\d+)?)GHz/.exec(chan)?.[1]?.concat(' GHz') ?? '',
      radio: String(cur.spairport_network_phymode ?? ''),
      auth: String(cur.spairport_security_mode ?? '')
        .replace(/^spairport_security_mode_/, '')
        .replace(/_/g, ' ')
        .toUpperCase(),
      rxMbps: Number(cur.spairport_network_rate) || null,
      txMbps: null
    })
  }
  return out
}

/** Slow commands (system_profiler takes ~1 s) are refreshed every few seconds, the rest every tick. */
function cached<T>(ms: number, load: () => Promise<T>, empty: T) {
  let value = empty
  let at = 0
  return async () => {
    if (Date.now() - at > ms) {
      at = Date.now()
      value = await load()
    }
    return value
  }
}

const ports = cached(30_000, async () => parsePorts(await tryRun('networksetup', ['-listallhardwareports'])), new Map<string, string>())
const airport = cached(10_000, async () => parseAirport(await tryRun('system_profiler', ['SPAirPortDataType', '-json'], 15_000)), new Map<string, Wifi>())
const dnsServers = cached(10_000, async () => parseScutil(await tryRun('scutil', ['--dns'])), [] as string[])

function hint(port: string): AdapterKind {
  if (/wi-?fi|airport/i.test(port)) return 'wifi'
  if (/bridge/i.test(port)) return 'virtual'
  if (/ethernet|lan/i.test(port)) return 'ethernet'
  return 'other'
}

export async function snapshot(): Promise<Adapter[]> {
  const [ifc, stats, route, names, wifi, dns] = await Promise.all([
    run('ifconfig', []),
    tryRun('netstat', ['-ibn']),
    tryRun('route', ['-n', 'get', 'default']),
    ports(),
    airport(),
    dnsServers()
  ])
  const bytes = parseNetstat(stats)
  const def = parseDefaultRoute(route)
  return parseIfconfig(ifc).map((i) => {
    const port = names.get(i.name) ?? ''
    const isDefault = i.name === def.iface
    return {
      id: i.name,
      name: port || i.name,
      description: port ? i.name : '',
      kind: i.name.startsWith('lo') ? 'loopback' : adapterKind(i.name, port, hint(port)),
      up: i.up,
      mac: i.mac,
      speed: i.speed,
      ipv4: i.ipv4,
      ipv6: i.ipv6,
      gateway: isDefault ? def.gateway : null,
      dns: isDefault ? dns : [],
      dhcp: null,
      rx: bytes.get(i.name)?.rx ?? 0,
      tx: bytes.get(i.name)?.tx ?? 0,
      wifi: wifi.get(i.name) ?? null
    }
  })
}

export const mac: Collector = {
  watch: poll(snapshot),
  neighbors: async () => parseArpMac(await run('arp', ['-an']))
}
