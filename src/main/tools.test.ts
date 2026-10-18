import http from 'node:http'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { safeName, serviceCommand, startupChange, uacScript, userCommand, userGuard } from './admin'
import { bannerOf, checkPort, isHost, lookup, parsePing, parseTestConnection, parseTrace, ping, scanPorts } from './tools'

describe('parsers', () => {
  it('reads Windows Test-Connection and Unix ping', () => {
    expect(parseTestConnection('80|1.1.1.1\r\n81|1.1.1.1\r\n', 4)).toEqual({ ip: '1.1.1.1', times: [80, 81, null, null] })
    expect(parseTestConnection('', 2)).toEqual({ ip: null, times: [null, null] })
    const linux = 'PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.\n64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.3 ms\n64 bytes from 1.1.1.1: icmp_seq=3 ttl=57 time=11.9 ms\n'
    expect(parsePing(linux, 3)).toEqual({ ip: '1.1.1.1', times: [12.3, null, 11.9] })
    const mac = 'PING example.com (93.184.215.14): 56 data bytes\n64 bytes from 93.184.215.14: icmp_seq=0 ttl=56 time=150.214 ms\n'
    expect(parsePing(mac, 2)).toEqual({ ip: '93.184.215.14', times: [150.214, null] })
  })
  it('reads tracert and traceroute hops, including lost probes', () => {
    const win = [
      'Tracing route to 1.1.1.1 over a maximum of 15 hops',
      '',
      '  1     2 ms     5 ms     1 ms  192.168.0.1',
      '  2    <1 ms     2 ms     2 ms  192.168.1.1',
      '  3     *        *        *     Request timed out.',
      '  4    14 мс    12 мс    13 мс  89.249.60.97',
      '',
      'Trace complete.'
    ].join('\r\n')
    expect(parseTrace(win)).toEqual([
      { n: 1, ip: '192.168.0.1', ms: 1 },
      { n: 2, ip: '192.168.1.1', ms: 1 },
      { n: 3, ip: null, ms: null },
      { n: 4, ip: '89.249.60.97', ms: 12 }
    ])
    expect(parseTrace('traceroute to 1.1.1.1 (1.1.1.1), 15 hops max\n 1  192.168.0.1  1.234 ms\n 2  *\n')).toEqual([
      { n: 1, ip: '192.168.0.1', ms: 1.234 },
      { n: 2, ip: null, ms: null }
    ])
    // tracepath (Ubuntu's default): MTU notes and repeated answers are skipped.
    expect(parseTrace(' 1?: [LOCALHOST]                      pmtu 1500\n 1:  192.168.0.1                                           0.512ms\n 1:  192.168.0.1                                           0.498ms\n 2:  no reply\n 3:  1.1.1.1                                               9.120ms reached\n     Resume: pmtu 1500 hops 3 back 3\n')).toEqual([
      { n: 1, ip: '192.168.0.1', ms: 0.512 },
      { n: 2, ip: null, ms: null },
      { n: 3, ip: '1.1.1.1', ms: 9.12 }
    ])
  })
})

describe('inputs that reach commands', () => {
  it('accepts hosts and IPs only', () => {
    expect(['example.com', '1.1.1.1', 'fe80::1', 'my-router.lan', '_srv.local'].every(isHost)).toBe(true)
    expect(['-n', 'a b', 'x;rm', "x'", '', 'a'.repeat(254), 'a&b'].some(isHost)).toBe(false)
  })
  it('keeps adapter names and the UAC script free of injection', () => {
    expect(['WiFi', 'Ethernet 2', 'vEthernet (WSL (Hyper-V firewall))', 'Local Area Connection* 9', 'en0'].every(safeName)).toBe(true)
    expect(['a"b', 'a&b', 'a|b', 'a%PATH%', 'a^b', 'a<b'].some(safeName)).toBe(false)
    expect(uacScript("ipconfig /renew \"WiFi\" & echo it's")).toContain("-ArgumentList '/c ipconfig /renew \"WiFi\" & echo it''s'")
  })
})

// Real commands against this computer only (CI runs them on every OS).
describe('live', () => {
  it('pings, checks ports and looks up names on this computer', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as net.AddressInfo).port
    try {
      expect(await checkPort('127.0.0.1', port)).toBe('open')
      server.close()
      expect(await checkPort('127.0.0.1', port)).toBe('closed')
      expect((await ping('127.0.0.1', 2)).times.filter((t) => t !== null).length).toBeGreaterThan(0)
      expect((await lookup('localhost', () => ({ country: null, org: null }))).addresses.length).toBeGreaterThan(0)
    } finally {
      server.close()
    }
  }, 30_000)

  it('scans ports and names what answers', async () => {
    const listen = async (s: net.Server) => (await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)), (s.address() as net.AddressInfo).port)
    const greeter = net.createServer((c) => c.end('SSH-2.0-Test_1.0\r\n'))
    const web = http.createServer((_q, r) => r.setHeader('Server', 'TestWeb/2').end())
    const mute = net.createServer(() => {})
    const closed = net.createServer()
    const [a, b, c, d] = await Promise.all([greeter, web, mute, closed].map(listen))
    closed.close()
    try {
      expect(await scanPorts('127.0.0.1', [d, c, b, a])).toEqual(
        [
          { port: a, banner: 'SSH-2.0-Test_1.0' },
          { port: b, banner: 'TestWeb/2' },
          { port: c, banner: null }
        ].sort((x, y) => x.port - y.port)
      )
    } finally {
      for (const s of [greeter, web, mute]) s.close()
    }
  }, 30_000)
})

describe('banners', () => {
  it('prefers the Server header, spots TLS and drops control bytes', () => {
    expect(bannerOf('HTTP/1.1 200 OK\r\nServer: nginx/1.25\r\n\r\n')).toBe('nginx/1.25')
    expect(bannerOf('HTTP/1.0 404 Not Found\r\n\r\n')).toBe('HTTP/1.0 404 Not Found')
    expect(bannerOf('\x15\x03\x01\x00\x02\x02\x46')).toBe('TLS')
    expect(bannerOf('\n\nJ\x00\x00\x00\n8.0.33\x00')).toBe('J')
    expect(bannerOf('-ERR unknown command')).toBe('-ERR unknown command')
    expect(bannerOf('')).toBeNull()
  })
})

describe('defender commands', () => {
  it('builds MpCmdRun arguments and a UAC line that keeps the quoted path', async () => {
    const { MPCMD, scanArgs } = await import('./defender')
    expect(scanArgs('quick')).toEqual(['-Scan', '-ScanType', '1'])
    expect(scanArgs('full')).toEqual(['-Scan', '-ScanType', '2'])
    expect(MPCMD).toMatch(/Windows Defender[\\/]MpCmdRun\.exe$/)
    expect(uacScript(`"${MPCMD}" -Scan -ScanType 1`)).toContain(`-ArgumentList '/c "${MPCMD}" -Scan -ScanType 1'`)
  })
})

describe('user changes', () => {
  const users = [
    { name: 'Administrator', enabled: false, last: null, sid: 'S-1-5-21-1-500', admin: true, me: false },
    { name: 'alice', enabled: true, last: null, sid: 'S-1-5-21-1-1001', admin: true, me: true },
    { name: 'bob', enabled: true, last: null, sid: 'S-1-5-21-1-1002', admin: true, me: false },
    { name: 'postgres', enabled: true, last: null, sid: 'S-1-5-21-1-1003', admin: false, me: false }
  ]
  it('never locks the owner out', () => {
    expect(userGuard(users, 'alice', 'disable')).toBe('E_SELF')
    expect(userGuard(users, 'alice', 'unadmin')).toBe('E_SELF')
    expect(userGuard(users, 'bob', 'unadmin')).toBeNull()
    expect(userGuard(users, 'postgres', 'disable')).toBeNull()
    expect(userGuard(users, 'nobody', 'disable')).toBe('E_BAD_ARGS')
    const alone = users.map((u) => (u.name === 'bob' ? { ...u, admin: false } : u)).map((u) => (u.name === 'alice' ? { ...u, me: false } : u))
    expect(userGuard(alone, 'alice', 'unadmin')).toBe('E_LAST_ADMIN')
  })
  it('builds the commands, refusing odd names', () => {
    expect(userCommand('postgres', 'disable')).toBe('net user "postgres" /active:no')
    expect(userCommand('John Doe', 'enable')).toBe('net user "John Doe" /active:yes')
    expect(userCommand('bob', 'unadmin')).toBe("powershell -NoProfile -NonInteractive -Command Remove-LocalGroupMember -SID S-1-5-32-544 -Member 'bob'")
    expect(() => userCommand('a"&calc', 'disable')).toThrow('E_BAD_ARGS')
    expect(() => userCommand("o'brien", 'unadmin')).toThrow('E_BAD_ARGS')
  })
})

describe('service changes', () => {
  it('builds sc.exe lines and refuses odd names', () => {
    expect(serviceCommand('wuauserv', 'stop')).toBe('sc.exe stop "wuauserv"')
    expect(serviceCommand('MatrikonOPC Server for Simulation and Testing', 'start')).toBe('sc.exe start "MatrikonOPC Server for Simulation and Testing"')
    expect(serviceCommand('pgbouncer', 'manual')).toBe('sc.exe config "pgbouncer" start= demand')
    expect(serviceCommand('DiagTrack', 'disabled')).toBe('sc.exe config "DiagTrack" start= disabled')
    expect(() => serviceCommand('x" & del', 'stop')).toThrow('E_BAD_ARGS')
  })
})

describe('startup changes', () => {
  const sa = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
  it('uses the StartupApproved switch for Run entries and schtasks for tasks', () => {
    expect(startupChange({ kind: 'run', hive: 'HKCU', name: 'Steam', approved: sa }, false)).toEqual({
      direct: ['reg.exe', ['add', `HKCU\\${sa}`, '/v', 'Steam', '/t', 'REG_BINARY', '/d', `03${'0'.repeat(22)}`, '/f']],
      line: `reg.exe add "HKCU\\${sa}" /v "Steam" /t REG_BINARY /d 03${'0'.repeat(22)} /f`
    })
    expect(startupChange({ kind: 'run', hive: 'HKLM', name: 'SecurityHealth', approved: sa }, true).direct).toBeNull()
    expect(startupChange({ kind: 'task', hive: '', name: '\\HP\\Printer Health Monitor', approved: '' }, false)).toEqual({
      direct: ['schtasks.exe', ['/Change', '/TN', '\\HP\\Printer Health Monitor', '/DISABLE']],
      line: 'schtasks.exe /Change /TN "\\HP\\Printer Health Monitor" /DISABLE'
    })
  })
  it('refuses RunOnce entries and odd names', () => {
    expect(() => startupChange({ kind: 'run', hive: 'HKCU', name: 'Once', approved: '' }, false)).toThrow('E_BAD_ARGS')
    expect(() => startupChange({ kind: 'run', hive: 'HKCU', name: 'a" & calc', approved: sa }, false)).toThrow('E_BAD_ARGS')
    expect(() => startupChange({ kind: 'task', hive: '', name: '/Delete', approved: '' }, false)).toThrow('E_BAD_ARGS')
  })
})
