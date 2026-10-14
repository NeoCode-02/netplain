import fs from 'node:fs'
import os from 'node:os'
import type { Adapter, AdapterKind, Neighbor, Wifi } from '../../shared/types'
import { tryRun } from '../exec'
import { adapterKind, normMac } from './kind'
import { poll, type Collector } from './common'

// Everything comes from /proc and /sys (what `ip` and `ss` read too), so no tool has to be installed.
const read = (p: string) => {
  try {
    return fs.readFileSync(p, 'utf8').trim()
  } catch {
    return ''
  }
}

/** /proc/net/route stores IPv4 addresses as little-endian hex. */
const hexIp = (h: string) => [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join('.')

/** Default gateway per interface from /proc/net/route. */
export function parseRoute(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n').slice(1)) {
    const [iface, dest, gw, flags] = line.trim().split(/\s+/)
    if (dest === '00000000' && parseInt(flags, 16) & 2 && !out.has(iface)) out.set(iface, hexIp(gw))
  }
  return out
}

/** /proc/net/arp; flags 0x0 means the lookup never completed. */
export function parseProcArp(text: string): Neighbor[] {
  return text
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c.length >= 6 && c[2] !== '0x0')
    .map(([ip, , , mac, , dev]) => ({ ip, mac: normMac(mac), via: dev, vendor: null }))
    .filter((n) => n.mac)
}

/** Link quality (out of 70) from /proc/net/wireless, as a percentage. */
export function parseWireless(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of text.matchAll(/^\s*(\S+):\s+\S+\s+(\d+)\./gm)) out.set(m[1], Math.min(100, Math.round((Number(m[2]) / 70) * 100)))
  return out
}

export const parseResolv = (text: string) => [...text.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1])

/** `nmcli -t -f ACTIVE,SSID,BSSID,SIGNAL,CHAN,FREQ,RATE,SECURITY,DEVICE dev wifi`; ':' inside values is escaped as '\:'. */
export function parseNmcli(text: string): Map<string, Wifi> {
  const out = new Map<string, Wifi>()
  for (const line of text.split('\n')) {
    const f = line.split(/(?<!\\):/).map((s) => s.replace(/\\:/g, ':'))
    if (f[0] !== 'yes' || f.length < 9) continue
    const mhz = parseInt(f[5], 10)
    out.set(f[8], {
      ssid: f[1],
      bssid: normMac(f[2]),
      signal: Number(f[3]) || null,
      channel: Number(f[4]) || null,
      band: mhz >= 5925 ? '6 GHz' : mhz >= 4900 ? '5 GHz' : mhz ? '2.4 GHz' : '',
      radio: '',
      auth: f[7],
      rxMbps: parseInt(f[6], 10) || null,
      txMbps: null
    })
  }
  return out
}

function hint(dir: string, name: string): AdapterKind {
  if (read(`${dir}/type`) === '772') return 'loopback'
  if (fs.existsSync(`${dir}/wireless`) || fs.existsSync(`${dir}/phy80211`)) return 'wifi'
  if (fs.existsSync(`${dir}/device`)) return /^(wwan|rmnet)/.test(name) ? 'cellular' : 'ethernet'
  return 'virtual'
}

let nm = new Map<string, Wifi>()
let nmAt = 0

async function wifiInfo(): Promise<Map<string, Wifi>> {
  // nmcli is slow-ish and the answer changes rarely; --rescan no keeps it from scanning.
  if (Date.now() - nmAt > 5000) {
    nmAt = Date.now()
    nm = parseNmcli(await tryRun('nmcli', ['-t', '-f', 'ACTIVE,SSID,BSSID,SIGNAL,CHAN,FREQ,RATE,SECURITY,DEVICE', 'dev', 'wifi', 'list', '--rescan', 'no'], 4000))
  }
  return nm
}

export async function snapshot(): Promise<Adapter[]> {
  const addrs = os.networkInterfaces()
  const gateways = parseRoute(read('/proc/net/route'))
  const quality = parseWireless(read('/proc/net/wireless'))
  // systemd-resolved's stub (127.0.0.53) hides the real servers; its own file lists them.
  const dns = parseResolv(read('/run/systemd/resolve/resolv.conf') || read('/etc/resolv.conf'))
  const nmWifi = await wifiInfo()
  return fs.readdirSync('/sys/class/net').map((name): Adapter => {
    const dir = `/sys/class/net/${name}`
    const kindHint = hint(dir, name)
    const list = addrs[name] ?? []
    const state = read(`${dir}/operstate`)
    const speed = Number(read(`${dir}/speed`))
    const gateway = gateways.get(name) ?? null
    const wifi = nmWifi.get(name) ?? (quality.has(name) ? { ssid: '', bssid: '', signal: quality.get(name)!, channel: null, band: '', radio: '', auth: '', rxMbps: null, txMbps: null } : null)
    return {
      id: name,
      name,
      description: '',
      kind: adapterKind(name, '', kindHint),
      up: state === 'up' || (state === 'unknown' && (parseInt(read(`${dir}/flags`), 16) & 1) === 1),
      mac: normMac(read(`${dir}/address`)),
      speed: speed > 0 ? speed * 1e6 : null,
      ipv4: list.filter((a) => a.family === 'IPv4').map((a) => a.cidr ?? a.address),
      ipv6: list.filter((a) => a.family === 'IPv6').map((a) => a.cidr ?? a.address),
      gateway,
      // ponytail: Linux keeps resolvers global; shown on adapters with a gateway. resolvectl has per-link ones.
      dns: gateway ? dns.filter((d) => d !== '127.0.0.53') : [],
      dhcp: null,
      rx: Number(read(`${dir}/statistics/rx_bytes`)) || 0,
      tx: Number(read(`${dir}/statistics/tx_bytes`)) || 0,
      wifi: wifi && (kindHint === 'wifi' || wifi.ssid) ? wifi : null
    }
  })
}

export const linux: Collector = {
  watch: poll(snapshot),
  neighbors: async () => parseProcArp(read('/proc/net/arp'))
}
