import { execFile } from 'node:child_process'
import dgram from 'node:dgram'
import dns from 'node:dns/promises'
import net from 'node:net'
import type { DiagnoseStep, Hop, LookupResult, PingResult, PortState, PublicIp, ScanHit, Snapshot } from '../shared/types'

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

/**
 * `tracert -d` (Windows: times, then the address), `traceroute -n` (address, then times) or `tracepath -n`
 * ("1:  address  0.05ms"; "1?:" lines are path-MTU notes, a repeated hop number is an extra answer) lines.
 */
export function parseTrace(text: string): Omit<Hop, 'org' | 'country'>[] {
  const hops: Omit<Hop, 'org' | 'country'>[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)(\?)?:?\s+(.*)$/.exec(line)
    if (!m || m[2] || hops.some((h) => h.n === Number(m[1]))) continue
    const ip = m[3].split(/\s+/).find((w) => net.isIP(w)) ?? null
    // "<1 ms" counts as 1; "*" is a lost probe.
    const times = [...m[3].matchAll(/(<?)([\d.]+)\s*(?:ms|мс)/gi)].map((t) => (t[1] ? 1 : Number(t[2])))
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
  if (!text.trim()) throw new Error('E_NO_TRACE')
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

/** What an open port said: the HTTP `Server` header or status line, "TLS", or its first line of text. */
export function bannerOf(raw: string): string | null {
  if (raw.startsWith('\x15\x03')) return 'TLS'
  const http = /^HTTP\/[\d.]+ \d{3}/.test(raw)
  const line = (http && /^server:[ \t]*(.+)$/im.exec(raw)?.[1]) || raw.split(/\r?\n/).find((l) => l.trim()) || ''
  const text = line.replace(/[^\x20-\x7e]+/g, ' ').trim().slice(0, 120)
  return text || null
}

/**
 * One port: undefined when nothing accepts the connection, else what it says. A silent service is asked
 * `HEAD /` once, which names web servers on any port (and makes most others answer with an error that names them).
 */
function probe(ip: string, host: string, port: number, timeout: number): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port })
    let data = ''
    let open = false
    let asked = false
    const done = (v: string | null | undefined) => {
      clearTimeout(timer)
      s.destroy()
      resolve(v)
    }
    const wait = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (data || asked) return done(bannerOf(data))
        asked = true
        s.write(`HEAD / HTTP/1.0\r\nHost: ${host}\r\n\r\n`)
        wait()
      }, 700)
    }
    let timer = setTimeout(() => done(undefined), timeout)
    s.once('connect', () => {
      open = true
      wait()
    })
    s.on('data', (b: Buffer) => {
      data += b.toString('latin1')
      if (data.length > 4096 || (asked ? /\r?\n\r?\n/ : /\n/).test(data)) done(bannerOf(data))
    })
    s.once('error', () => done(open ? bannerOf(data) : undefined))
    s.once('end', () => done(bannerOf(data)))
  })
}

/** Connects to `ports`, `width` at a time, and returns the open ones in order. The name is looked up once; throws E_NOT_FOUND. */
export async function scanPorts(host: string, ports: number[], width = 200, timeout = 1200): Promise<ScanHit[]> {
  const ip = net.isIP(host) ? host : (await dns.lookup(host).catch(() => null))?.address
  if (!ip) throw new Error('E_NOT_FOUND')
  const hits: ScanHit[] = []
  let next = 0
  const worker = async () => {
    while (next < ports.length) {
      const port = ports[next++]
      const banner = await probe(ip, host, port, timeout)
      if (banner !== undefined) hits.push({ port, banner })
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, ports.length) }, worker))
  return hits.sort((a, b) => a.port - b.port)
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

/** Wake-on-LAN: six 0xff bytes, then the MAC sixteen times. */
export const magicPacket = (mac: string) => Buffer.concat([Buffer.alloc(6, 0xff), ...Array<Buffer>(16).fill(Buffer.from(mac.replace(/[:-]/g, ''), 'hex'))])

/** "192.168.1.20/24" → "192.168.1.255": the address every device on that network hears. */
export function broadcastOf(cidr: string): string | null {
  const [ip, bits] = cidr.split('/')
  const p = Number(bits)
  if (!net.isIPv4(ip) || !Number.isInteger(p) || p < 0 || p > 30) return null
  const n = ip.split('.').reduce((a, x) => a * 256 + Number(x), 0)
  const b = n + (2 ** (32 - p) - 1 - (n % 2 ** (32 - p)))
  return [24, 16, 8, 0].map((s) => Math.floor(b / 2 ** s) % 256).join('.')
}

/** Sends the wake-up packet to every local network's broadcast address (and the general one), on UDP 9 and 7. */
export async function wake(mac: string, cidrs: string[]): Promise<void> {
  const packet = magicPacket(mac)
  const s = dgram.createSocket('udp4')
  try {
    await new Promise<void>((r) => s.bind(r))
    s.setBroadcast(true)
    const to = [...new Set(['255.255.255.255', ...cidrs.map(broadcastOf).filter((x): x is string => x !== null)])]
    let sent = 0
    for (const addr of to) for (const port of [9, 7]) sent += await new Promise<number>((r) => s.send(packet, port, addr, (e) => r(e ? 0 : 1)))
    if (!sent) throw new Error('E_WAKE')
  } finally {
    s.close()
  }
}
