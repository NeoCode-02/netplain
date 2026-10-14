import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Adapter, AdapterKind, Neighbor, Proc, Socket, Wifi } from '../../shared/types'
import { list, noZone, run } from '../exec'
import { hostPort, tcpState, type Collector } from './common'
import { adapterKind, normMac } from './kind'

// One long-lived PowerShell prints a JSON line per second: starting powershell.exe costs ~250 ms,
// a snapshot through .NET ~5 ms. netsh is the only Wi-Fi source that needs no admin rights.
const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue';",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8;',
  'while ($true) {',
  '$a = foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {',
  '$p = $n.GetIPProperties(); $s = $n.GetIPStatistics(); $d = $null; try { $d = $p.GetIPv4Properties().IsDhcpEnabled } catch {};',
  '@{ id = $n.Id; name = $n.Name; desc = $n.Description; type = [string]$n.NetworkInterfaceType; up = [string]$n.OperationalStatus -eq \'Up\'; speed = $n.Speed; mac = [string]$n.GetPhysicalAddress();',
  "ip = @($p.UnicastAddresses | ForEach-Object { [string]$_.Address + '/' + $_.PrefixLength }); gw = @($p.GatewayAddresses | ForEach-Object { [string]$_.Address }); dns = @($p.DnsAddresses | ForEach-Object { [string]$_ }); dhcp = $d; rx = $s.BytesReceived; tx = $s.BytesSent } };",
  "[Console]::Out.WriteLine((@{ a = @($a); w = ((netsh wlan show interfaces) -join [char]10) } | ConvertTo-Json -Compress -Depth 4));",
  'Start-Sleep -Milliseconds 1000 }'
].join(' ')

interface Raw {
  id: string
  name: string
  desc: string
  type: string
  up: boolean
  speed: number
  mac: string
  ip: string | string[]
  gw: string | string[]
  dns: string | string[]
  dhcp: boolean | null
  rx: number
  tx: number
}

const HINTS: Record<string, AdapterKind> = { Wireless80211: 'wifi', Loopback: 'loopback', Ppp: 'vpn', Wwanpp: 'cellular', Wwanpp2: 'cellular' }
const hint = (type: string): AdapterKind => HINTS[type] ?? (/ethernet/i.test(type) ? 'ethernet' : 'other')

const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i

/**
 * `netsh wlan show interfaces`, keyed by the adapter's MAC. Labels are translated on non-English
 * Windows, so the key facts are found by their values (MACs, "86%", "802.11ax", "5 GHz") and
 * only the extras rely on English labels.
 */
export function parseWlan(text: string): Map<string, Wifi> {
  const out = new Map<string, Wifi>()
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const rows = block
      .split(/\r?\n/)
      .map((l) => /^\s+([^:]+?)\s*:\s?(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1].trim(), m[2].trim()] as const)
    const macs = rows.filter(([, v]) => MAC.test(v)).map(([, v]) => normMac(v))
    const ssid = rows.find(([k]) => k === 'SSID')?.[1]
    if (macs.length < 2 || !ssid) continue
    const by = (label: string) => rows.find(([k]) => k.toLowerCase() === label)?.[1] ?? ''
    const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null)
    const signal = rows.find(([, v]) => /^\d{1,3}\s?%$/.test(v))?.[1]
    out.set(macs[0], {
      ssid,
      bssid: macs[1],
      signal: signal ? parseInt(signal, 10) : null,
      channel: num(by('channel')),
      band: rows.find(([, v]) => /^\d(\.\d)?\s*(GHz|ГГц)$/i.test(v))?.[1] ?? '',
      radio: rows.find(([, v]) => /^802\.11/.test(v))?.[1] ?? '',
      auth: by('authentication'),
      rxMbps: num(by('receive rate (mbps)')),
      txMbps: num(by('transmit rate (mbps)'))
    })
  }
  return out
}

export function parseSnapshot(line: string): Adapter[] {
  const { a, w } = JSON.parse(line) as { a: Raw | Raw[]; w: string }
  const wifi = parseWlan(w ?? '')
  return list(a).map((r) => {
    const ips = list(r.ip).map(noZone)
    const mac = normMac(r.mac ?? '')
    const gws = list(r.gw).map(noZone).filter((g) => g && g !== '0.0.0.0')
    return {
      id: r.id,
      name: r.name,
      description: r.desc,
      kind: adapterKind(r.name, r.desc, hint(r.type)),
      up: r.up,
      mac,
      speed: r.speed > 0 ? r.speed : null,
      ipv4: ips.filter((ip) => !ip.includes(':')),
      ipv6: ips.filter((ip) => ip.includes(':')),
      gateway: gws.find((g) => !g.includes(':')) ?? gws[0] ?? null,
      // fec0:0:0:ffff::1-3 are Windows' placeholder resolvers, not real ones.
      dns: list(r.dns).map(noZone).filter((d) => d && !d.startsWith('fec0:')),
      dhcp: r.dhcp ?? null,
      rx: r.rx ?? 0,
      tx: r.tx ?? 0,
      wifi: (mac && wifi.get(mac)) || null
    }
  })
}

/** `arp -a`. The header words are translated, the layout is not. */
export function parseArp(text: string): Neighbor[] {
  const out: Neighbor[] = []
  let via = ''
  for (const line of text.split(/\r?\n/)) {
    const head = /(\d+\.\d+\.\d+\.\d+)\s+---\s+0x/.exec(line)
    if (head) {
      via = head[1]
      continue
    }
    const m = /^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s/i.exec(line)
    if (m && via) out.push({ ip: m[1], mac: normMac(m[2]), via, vendor: null })
  }
  return out
}

/** `netstat -ano`: "TCP  192.168.0.2:52345  140.82.112.25:443  ESTABLISHED  5678"; UDP rows have no state. */
export function parseNetstat(text: string): Socket[] {
  const out: Socket[] = []
  for (const line of text.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/)
    if (c[0] !== 'TCP' && c[0] !== 'UDP') continue
    const local = hostPort(c[1])
    const remote = hostPort(c[2])
    const pid = Number(c.at(-1))
    if (!local) continue
    const peer = remote && remote.port ? remote : null
    const tcp = c[0] === 'TCP'
    out.push({
      proto: tcp ? 'tcp' : 'udp',
      localIp: local.ip,
      localPort: local.port,
      remoteIp: peer?.ip ?? null,
      remotePort: peer?.port ?? null,
      state: tcp ? tcpState(c.length >= 5 ? c[3] : '', !!peer) : 'bound',
      pid: Number.isInteger(pid) ? pid : null
    })
  }
  return out
}

/** Tab-separated lines from the PowerShell commands below; a tab inside a value would only shorten it. */
const rows = (text: string) => text.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'))

export const parseProcs = (text: string): Proc[] =>
  rows(text)
    .filter((r) => /^\d+$/.test(r[0]))
    .map(([pid, name, path, title]) => ({ pid: Number(pid), name, path: path || null, title: title || null }))

const ps = (script: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15_000)

export const win: Collector = {
  watch(on, onError) {
    let ps: ChildProcessWithoutNullStreams
    let stopped = false
    let restart: NodeJS.Timeout | undefined
    const start = () => {
      ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true })
      ps.stdin.write(SCRIPT + '\n')
      let buf = ''
      ps.stdout.setEncoding('utf8')
      ps.stdout.on('data', (d: string) => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line) continue
          try {
            on(parseSnapshot(line))
          } catch (e) {
            onError(e)
          }
        }
      })
      ps.stderr.on('data', (d) => onError(new Error(String(d))))
      ps.on('error', onError)
      ps.on('exit', (code) => {
        if (stopped) return
        onError(new Error(`powershell exited with ${code}`))
        restart = setTimeout(start, 3000)
      })
    }
    start()
    return () => {
      stopped = true
      clearTimeout(restart)
      ps.kill()
    }
  },
  neighbors: async () => parseArp(await run('arp', ['-a'])),
  sockets: async () => parseNetstat(await run('netstat', ['-ano'])),
  // Description is the program's own name ("Google Chrome"); paths of other users' and system processes stay hidden without admin rights.
  processes: async () => parseProcs(await ps('Get-Process | ForEach-Object { ($_.Id, $_.ProcessName, $_.Path, $_.Description) -join [char]9 }')),
  dnsCache: async () =>
    rows(await ps('Get-DnsClientCache | Where-Object { $_.Type -in 1,28 -and $_.Data } | ForEach-Object { $_.Data + [char]9 + $_.Entry }')).map(
      ([ip, name]) => [ip, name] as [string, string]
    )
}
