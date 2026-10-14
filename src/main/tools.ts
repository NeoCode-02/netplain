import { execFile } from 'node:child_process'
import dns from 'node:dns/promises'
import net from 'node:net'
import type { DiagnoseStep, Hop, LookupResult, PingResult, PortState, PublicIp, Snapshot } from '../shared/types'

type Geo = (ip: string) => { country: string | null; org: string | null }

/** Host names and IPs only: never something a command could read as an option ("-n"). */
export const isHost = (v: unknown): v is string => typeof v === 'string' && v.length <= 253 && /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/.test(v)

/** Runs a program; resolves with what it printed whatever its exit code (ping exits 1 when a host does not answer). */
function out(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) =>
    execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (_e, stdout) => resolve(stdout ?? ''))
  )
}

/** Windows `Test-Connection` lines "80|1.1.1.1"; nothing for lost probes. */
export function parseTestConnection(text: string, count: number): Pick<PingResult, 'ip' | 'times'> {
  const ok = text
    .split(/\r?\n/)
    .map((l) => /^(\d+)\|(\S*)/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
  const times: (number | null)[] = ok.map((m) => Number(m[1]))
  while (times.length < count) times.push(null)
  return { ip: ok[0]?.[2] || null, times }
}

/** `ping -c` output in the C locale: "64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.3 ms". */
export function parsePing(text: string, count: number): Pick<PingResult, 'ip' | 'times'> {
  const ip = /\(([\d.:a-f]+)\)/i.exec(text)?.[1] ?? null
  const seen = new Map<number, number>()
  for (const m of text.matchAll(/icmp_seq=(\d+).*?time[=<]([\d.]+)/g)) seen.set(Number(m[1]), Number(m[2]))
  // Linux counts from 1, macOS from 0.
  const first = seen.has(0) ? 0 : 1
  return { ip, times: Array.from({ length: count }, (_, i) => seen.get(first + i) ?? null) }
}

/** `tracert -d` (Windows: times, then the address) or `traceroute -n` (address, then times) lines; "*" is a lost probe. */
export function parseTrace(text: string): Omit<Hop, 'org' | 'country'>[] {
  const hops: Omit<Hop, 'org' | 'country'>[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const ip = m[2].split(/\s+/).find((w) => net.isIP(w)) ?? null
    // "<1 ms" counts as 1; "*" is a lost probe.
    const times = [...m[2].matchAll(/(<?)([\d.]+)\s*(?:ms|мс)/gi)].map((t) => (t[1] ? 1 : Number(t[2])))
    hops.push({ n: Number(m[1]), ip, ms: times.length ? Math.min(...times) : null })
  }
  return hops
}

export async function ping(host: string, count = 4): Promise<PingResult> {
  const r =
    process.platform === 'win32'
      ? parseTestConnection(
          await out('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Test-Connection -ComputerName '${host}' -Count ${count} -ErrorAction SilentlyContinue | ForEach-Object { '{0}|{1}' -f $_.ResponseTime, $_.IPV4Address }`], 30_000),
          count
        )
      : parsePing(await out('ping', ['-c', String(count), '-W', process.platform === 'darwin' ? '2000' : '2', host], 30_000), count)
  return { host, ...r }
}

export async function trace(host: string, geo: Geo): Promise<Hop[]> {
  const text =
    process.platform === 'win32'
      ? await out('tracert', ['-d', '-h', '15', '-w', '600', host], 90_000)
      : (await out('traceroute', ['-n', '-q', '1', '-w', '1', '-m', '15', host], 60_000)) || (await out('tracepath', ['-n', '-m', '15', host], 60_000))
  return parseTrace(text).map((h) => ({ ...h, ...(h.ip ? geo(h.ip) : { org: null, country: null }) }))
}

export async function lookup(name: string, geo: Geo): Promise<LookupResult> {
  const t0 = Date.now()
  if (net.isIP(name)) {
    const names = await dns.reverse(name).catch(() => [])
    return { name, addresses: [{ ip: name, ...geo(name) }], names, ms: Date.now() - t0 }
  }
  const found = await dns.lookup(name, { all: true }).catch(() => [])
  if (!found.length) throw new Error('E_NOT_FOUND')
  return { name, addresses: found.map((a) => ({ ip: a.address, ...geo(a.address) })), names: [], ms: Date.now() - t0 }
}

/** TCP connect: refused = closed (something answered), no answer in time = filtered (a firewall drops it). */
export function checkPort(host: string, port: number, timeout = 3000): Promise<PortState> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (state: PortState) => {
      s.destroy()
      resolve(state)
    }
    s.setTimeout(timeout, () => done('filtered'))
    s.once('connect', () => done('open'))
    s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'closed' : 'filtered'))
  })
}

/** Asks ipify (the only service contacted) for the address the internet sees; company and country come from the local database. */
export async function publicIp(geo: Geo): Promise<PublicIp> {
  const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) }).catch(() => null)
  const ip = res?.ok ? (await res.text()).trim() : ''
  if (!net.isIP(ip)) throw new Error('E_PUBLIC_IP')
  return { ip, ...geo(ip) }
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

/** Walks the chain adapter → address → router → DNS → internet and stops explaining at the first broken link. */
export async function diagnose(snap: Snapshot | null): Promise<DiagnoseStep[]> {
  const steps: DiagnoseStep[] = []
  const add = (key: DiagnoseStep['key'], ok: boolean, detail = '') => {
    steps.push({ key, state: ok ? 'ok' : 'fail', detail })
    return ok
  }
  const skipRest = () => {
    for (const key of ['adapter', 'address', 'router', 'dns', 'internet'] as const) if (!steps.some((s) => s.key === key)) steps.push({ key, state: 'skip', detail: '' })
    return steps
  }
  const up = (snap?.adapters ?? []).filter((a) => a.up && a.kind !== 'virtual' && a.kind !== 'loopback')
  const a = up.find((x) => x.id === snap?.defaultId) ?? up.find((x) => x.gateway) ?? up[0]
  if (!add('adapter', !!a, a?.name ?? '')) return skipRest()
  const ip = a.ipv4[0]?.split('/')[0] ?? ''
  if (!add('address', !!ip && !ip.startsWith('169.254.'), ip)) return skipRest()
  if (!a.gateway) {
    add('router', false, '')
    return skipRest()
  }
  // A router may ignore ping; its web or DNS port answering also proves it is there.
  const reached = (await ping(a.gateway, 2)).times.some((t) => t !== null) || (await Promise.all([80, 443, 53].map((p) => checkPort(a.gateway!, p, 1500)))).some((s) => s !== 'filtered')
  if (!add('router', reached, a.gateway)) return skipRest()
  const name = await withTimeout(dns.lookup('www.microsoft.com'), 5000).catch(() => null)
  if (!add('dns', !!name, a.dns.join(', '))) return skipRest()
  add('internet', (await checkPort('1.1.1.1', 443, 4000)) === 'open' || (await checkPort('8.8.8.8', 443, 4000)) === 'open')
  return steps
}
