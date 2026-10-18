import { describe, expect, it } from 'vitest'
import { run } from './exec'
import { block, blockCommand, blockedList, parseBlocked, publicIp, unblock, unblockCommand } from './firewall'

describe('firewall', () => {
  it('builds block commands for a program (outbound) and an address (both ways)', () => {
    expect(blockCommand({ program: 'C:\\Program Files\\App\\app.exe' })).toBe(
      'netsh advfirewall firewall add rule name="Netplain: C:\\Program Files\\App\\app.exe" dir=out action=block program="C:\\Program Files\\App\\app.exe" enable=yes'
    )
    expect(blockCommand({ ip: '203.0.113.7' })).toBe(
      'netsh advfirewall firewall add rule name="Netplain: 203.0.113.7" dir=out action=block remoteip=203.0.113.7 enable=yes & netsh advfirewall firewall add rule name="Netplain: 203.0.113.7" dir=in action=block remoteip=203.0.113.7 enable=yes'
    )
  })

  it('refuses what could break out of the command or cut off the home network', () => {
    for (const program of ['C:\\a" & calc & ".exe', 'C:\\%TEMP%\\x.exe', 'relative\\app.exe', '\\\\server\\share\\x.exe', 'C:\\Windows\\System32\\svchost.exe']) expect(() => blockCommand({ program })).toThrow('E_BAD_ARGS')
    for (const ip of ['192.168.1.1', '10.0.0.8', '127.0.0.1', '::1', 'fe80::1', '1.2.3.4 & calc', 'example.com']) expect(() => blockCommand({ ip })).toThrow('E_BAD_ARGS')
    expect(() => unblockCommand('Core Networking - DNS (UDP-Out)')).toThrow('E_BAD_ARGS')
    expect(unblockCommand('Netplain: 203.0.113.7')).toBe('netsh advfirewall firewall delete rule name="Netplain: 203.0.113.7"')
    expect(publicIp('2001:db8::1')).toBe(true)
  })

  it('reads its own rules, one entry for the two directions of an address', () => {
    const json = JSON.stringify([
      { name: 'Netplain: 203.0.113.7', program: 'Any', remote: '203.0.113.7' },
      { name: 'Netplain: 203.0.113.7', program: 'Any', remote: '203.0.113.7' },
      { name: 'Netplain: C:\\App\\app.exe', program: 'C:\\App\\app.exe', remote: 'Any' },
      { name: 'Someone else', program: 'Any', remote: '198.51.100.1' }
    ])
    expect(parseBlocked(json)).toEqual([
      { name: 'Netplain: 203.0.113.7', program: null, ip: '203.0.113.7' },
      { name: 'Netplain: C:\\App\\app.exe', program: 'C:\\App\\app.exe', ip: null }
    ])
    expect(parseBlocked(JSON.stringify({ name: 'Netplain: 203.0.113.9', program: 'Any', remote: '203.0.113.9' }))).toHaveLength(1)
    expect(parseBlocked('')).toEqual([])
  })

  // GitHub's Windows runners are admin without a UAC prompt; never run on a real machine.
  const ci = process.env.CI === 'true' && process.platform === 'win32'

  it.runIf(ci)('reads a rule netsh made directly (CI)', async () => {
    const name = 'Netplain: 192.0.2.124'
    const said = await run('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${name}`, 'dir=out', 'action=block', 'remoteip=192.0.2.124', 'enable=yes']).catch((e: Error) => `netsh failed: ${e.message}`)
    const list = await blockedList()
    await run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`]).catch(() => '')
    expect(list, said).toContainEqual({ name, program: null, ip: '192.0.2.124' })
  }, 60_000)

  it.runIf(ci)('blocks and unblocks through the admin prompt (CI)', async () => {
    // A path nothing runs from: the rule is real, nothing on the runner loses its connection.
    const program = 'C:\\netplain-test\\nothing.exe'
    expect(await block({ ip: '192.0.2.123' })).toContainEqual({ name: 'Netplain: 192.0.2.123', program: null, ip: '192.0.2.123' })
    expect((await block({ program })).find((b) => b.program?.toLowerCase() === program.toLowerCase())).toBeTruthy()
    for (const b of await blockedList()) await unblock(b.name)
    expect(await blockedList()).toEqual([])
  }, 60_000)
})
