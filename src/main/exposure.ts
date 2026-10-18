import dgram from 'node:dgram'
import type { Exposure, InternetDb, NatKind, PortMap, Upnp } from '../shared/types'
import { isPrivate } from './net'
import { publicIp } from './tools'

type Geo = Parameters<typeof publicIp>[0]
const HOUR = 3_600_000
const list = (v: unknown, ok: (x: unknown) => boolean) => (Array.isArray(v) ? v.filter(ok) : [])
const isStr = (x: unknown) => typeof x === 'string' && x.length < 300

/** Shodan's InternetDB answer, or null when it holds nothing on the address. */
export function parseInternetDb(j: unknown): InternetDb | null {
  const o = (j ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.ports)) return null
  return {
    ports: list(o.ports, (x) => Number.isInteger(x)).sort((a, b) => (a as number) - (b as number)) as number[],
    vulns: list(o.vulns, isStr).slice(0, 200) as string[],
    tags: list(o.tags, isStr) as string[],
    hostnames: list(o.hostnames, isStr).slice(0, 20) as string[]
  }
}

const seen = new Map<string, { at: number; v: InternetDb | null }>()

/** What Shodan's free InternetDB last saw open on an address (no key; cached an hour). Throws E_INTERNETDB. */
export async function internetDb(ip: string): Promise<InternetDb | null> {
  const hit = seen.get(ip)
  if (hit && Date.now() - hit.at < HOUR) return hit.v
  const res = await fetch(`https://internetdb.shodan.io/${ip}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  // 404 is its "nothing known about this address".
  if (!res || (res.status !== 200 && res.status !== 404)) throw new Error('E_INTERNETDB')
  const v = res.status === 404 ? null : parseInternetDb(await res.json().catch(() => null))
  seen.set(ip, { at: Date.now(), v })
  return v
}

/** The router's description URL from an SSDP reply: plain http on this network only. */
export function locationOf(reply: string): string | null {
  const loc = /^location:\s*(\S+)/im.exec(reply)?.[1] ?? ''
  try {
    const u = new URL(loc)
    return u.protocol === 'http:' && isPrivate(u.hostname) ? u.href : null
  } catch {
    return null
  }
}

/** Asks the network for an internet gateway (SSDP M-SEARCH) from the given local address. */
export function findGateway(local: string, wait = 2500): Promise<string | null> {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      s.close()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), wait)
    s.on('error', () => finish(null))
    s.on('message', (m) => {
      const loc = locationOf(m.toString())
      if (loc) finish(loc)
    })
    s.bind(0, local, () => {
      // Out of the internet adapter, not a VPN or virtual one.
      s.setMulticastInterface(local)
      for (const v of [1, 2]) {
        const st = `urn:schemas-upnp-org:device:InternetGatewayDevice:${v}`
        s.send(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`, 1900, '239.255.255.250')
      }
    })
  })
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
/** The text of the first <name> element (any namespace prefix), entities decoded. */
export const tag = (xml: string, name: string) =>
  (new RegExp(`<(?:\\w+:)?${name}>([^<]*)<`).exec(xml)?.[1] ?? '').trim().replace(/&(\w+);/g, (m, e: string) => ENTITY[e] ?? m)

/** The WAN connection services a router description offers, with absolute control URLs. */
export function wanServices(xml: string, base: string): { type: string; url: string }[] {
  const root = tag(xml, 'URLBase') || base
  return [...xml.matchAll(/<service>([\s\S]*?)<\/service>/g)]
    .map((m) => ({ type: tag(m[1], 'serviceType'), control: tag(m[1], 'controlURL') }))
    .filter((s) => /:WAN(IP|PPP)Connection:\d$/.test(s.type) && s.control)
    .map((s) => ({ type: s.type, url: new URL(s.control, root).href }))
}

async function soap(url: string, type: string, action: string, args: Record<string, string | number> = {}): Promise<string> {
  const inner = Object.entries(args)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('')
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${type}">${inner}</u:${action}></s:Body></s:Envelope>`
  const res = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'text/xml; charset="utf-8"', soapaction: `"${type}#${action}"` }, body, signal: AbortSignal.timeout(3000) })
  const text = await res.text()
  if (!res.ok) throw new Error('E_UPNP')
  return text
}

/** The router's public side and the ports programs asked it to open, from its UPnP description URL. */
export async function readGateway(location: string): Promise<Upnp> {
  const res = await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(3000) })
  const xml = await res.text()
  const router = tag(xml, 'friendlyName') || tag(xml, 'modelName') || null
  // Routers often list both IP and PPP; the one in use knows the external address.
  for (const s of wanServices(xml, location)) {
    const externalIp = tag(await soap(s.url, s.type, 'GetExternalIPAddress').catch(() => ''), 'NewExternalIPAddress') || null
    if (!externalIp) continue
    const maps: PortMap[] = []
    // ponytail: entries one by one, as every router supports; 100 is far more than homes have.
    for (let i = 0; i < 100; i++) {
      const x = await soap(s.url, s.type, 'GetGenericPortMappingEntry', { NewPortMappingIndex: i }).catch(() => null)
      if (!x) break
      maps.push({
        external: Number(tag(x, 'NewExternalPort')),
        protocol: tag(x, 'NewProtocol').toUpperCase(),
        client: tag(x, 'NewInternalClient'),
        internal: Number(tag(x, 'NewInternalPort')),
        description: tag(x, 'NewPortMappingDescription'),
        enabled: tag(x, 'NewEnabled') !== '0',
        lease: Number(tag(x, 'NewLeaseDuration')) || 0
      })
    }
    return { router, externalIp, maps }
  }
  return { router, externalIp: null, maps: [] }
}

const isCgnat = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

/** Whether the router's internet side is the address the world sees, or the provider shares it. */
export function natOf(seen: string, wan: string | null): NatKind {
  if (!wan) return 'unknown'
  if (wan === seen) return 'direct'
  return isPrivate(wan) && !isCgnat(wan) ? 'double' : 'cgnat'
}

/** The network as the internet sees it. `local` is the internet adapter's address (for the UPnP search). */
export async function exposure(geo: Geo, local: string | null): Promise<Exposure> {
  const [pub, upnp] = await Promise.all([
    publicIp(geo),
    local ? findGateway(local).then((loc) => (loc ? readGateway(loc).catch(() => null) : null)) : Promise.resolve(null)
  ])
  return { ...pub, at: Date.now(), db: await internetDb(pub.ip), upnp, nat: natOf(pub.ip, upnp?.externalIp ?? null) }
}
