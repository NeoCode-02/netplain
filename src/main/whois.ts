import net from 'node:net'
import type { Whois } from '../shared/types'

type Entity = { roles?: string[]; vcardArray?: [string, [string, unknown, string, unknown][]]; entities?: Entity[] }
type Rdap = {
  objectClassName?: string
  ldhName?: string
  name?: string
  handle?: string
  country?: string
  startAddress?: string
  endAddress?: string
  status?: string[]
  events?: { eventAction: string; eventDate: string }[]
  entities?: Entity[]
  nameservers?: { ldhName?: string }[]
  remarks?: { title?: string; description?: string[] }[]
}

const HIDDEN = /redact|privacy|withheld|not disclosed|data protected/i
/** Maintainer handles ("AS8193-MNT") are not a name. */
const HANDLE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/

const card = (e: Entity, field: string) => {
  const v = e.vcardArray?.[1]?.find((x) => x[0] === field)?.[3]
  return typeof v === 'string' && v.trim() && !HIDDEN.test(v) ? v.trim() : null
}

const flat = (list: Entity[] = []): Entity[] => list.flatMap((e) => [e, ...flat(e.entities)])

/** The parts of an RDAP answer a person asks about: who holds it, through whom, since and until when, whom to report abuse to. */
export function parseRdap(r: Rdap): Whois {
  const all = flat(r.entities)
  const named = (role: string, field: string) =>
    all
      .filter((e) => e.roles?.includes(role))
      .map((e) => card(e, field))
      .find((v) => v && !HANDLE.test(v)) ?? null
  const date = (action: string) => r.events?.find((e) => e.eventAction === action)?.eventDate?.slice(0, 10) ?? null
  const ip = r.objectClassName === 'ip network'
  return {
    kind: ip ? 'ip' : 'domain',
    name: (ip ? r.name : r.ldhName?.toLowerCase()) ?? r.handle ?? '',
    holder: named('registrant', 'fn'),
    about: r.remarks?.find((x) => x.title === 'description')?.description?.[0] ?? null,
    registrar: named('registrar', 'fn'),
    country: r.country ?? null,
    range: r.startAddress && r.endAddress ? `${r.startAddress} – ${r.endAddress}` : null,
    created: date('registration'),
    updated: date('last changed'),
    expires: date('expiration'),
    abuse: named('abuse', 'email'),
    status: r.status ?? [],
    nameservers: (r.nameservers ?? []).map((n) => (n.ldhName ?? '').toLowerCase().replace(/\.$/, '')).filter((n) => n && n !== 'not.defined')
  }
}

/** Asks rdap.org, which forwards to the registry in charge. "www.example.com" falls back to "example.com". */
export async function whois(query: string): Promise<Whois> {
  const ip = net.isIP(query) > 0
  let name = query.toLowerCase().replace(/\.$/, '')
  for (;;) {
    const res = await fetch(`https://rdap.org/${ip ? 'ip' : 'domain'}/${encodeURIComponent(name)}`, {
      // rdap.org turns away the default "node" agent.
      headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'Netplain (+https://github.com/NeoCode-02/netplain)' },
      signal: AbortSignal.timeout(15_000)
    }).catch(() => null)
    if (res?.ok) return parseRdap((await res.json()) as Rdap)
    if (res?.status === 404 && !ip && name.split('.').length > 2) {
      name = name.slice(name.indexOf('.') + 1)
      continue
    }
    throw new Error(res?.status === 404 ? 'E_NO_RDAP' : 'E_RDAP')
  }
}
