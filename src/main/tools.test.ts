import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { safeName, uacScript, userCommand, userGuard } from './admin'
import { checkPort, isHost, lookup, parsePing, parseTestConnection, parseTrace, ping } from './tools'

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
