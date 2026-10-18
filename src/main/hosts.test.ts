import dns from 'node:dns/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyHosts, parseHosts, readHosts, writeHosts } from './hosts'

const FILE = ['# Copyright (c) Microsoft Corp.', '#      102.54.94.97     rhino.acme.com          # source server', '127.0.0.1 kubernetes.docker.internal # Added by Docker', '', '0.0.0.0\tads.example.com tracker.example.com', ''].join('\r\n')

describe('hosts file', () => {
  it('lists address lines only, with their names and notes', () => {
    expect(parseHosts(FILE)).toEqual([
      { line: 2, ip: '127.0.0.1', names: ['kubernetes.docker.internal'], on: true, comment: 'Added by Docker' },
      { line: 4, ip: '0.0.0.0', names: ['ads.example.com', 'tracker.example.com'], on: true, comment: '' }
    ])
  })

  it('switches an entry off and on again, keeping the rest and the line endings', () => {
    const off = applyHosts(FILE, { kind: 'toggle', line: 4, ip: '0.0.0.0' })
    expect(off.split('\r\n')[4]).toBe('#netplain-off 0.0.0.0\tads.example.com tracker.example.com')
    expect(parseHosts(off).find((e) => e.line === 4)?.on).toBe(false)
    expect(applyHosts(off, { kind: 'toggle', line: 4, ip: '0.0.0.0' })).toBe(FILE)
  })

  it('adds before the final newline and removes by line', () => {
    const added = applyHosts(FILE, { kind: 'add', ip: '192.168.1.5', name: 'nas.home' })
    expect(added.endsWith('192.168.1.5\tnas.home\r\n')).toBe(true)
    expect(applyHosts(added, { kind: 'remove', line: 5, ip: '192.168.1.5' })).toBe(FILE)
  })

  it('refuses bad input and a file that changed under it', () => {
    for (const [ip, name] of [['1.2.3', 'a.com'], ['1.2.3.4', 'a.com\r\n6.6.6.6 bank.com'], ['1.2.3.4', 'a b'], ['::1', '-x.com']]) expect(() => applyHosts(FILE, { kind: 'add', ip, name })).toThrow('E_BAD_ARGS')
    expect(() => applyHosts(FILE, { kind: 'remove', line: 2, ip: '0.0.0.0' })).toThrow('E_HOSTS_CHANGED')
    expect(() => applyHosts(FILE, { kind: 'toggle', line: 1, ip: '102.54.94.97' })).toThrow('E_HOSTS_CHANGED')
  })

  // GitHub's Windows runners are admin without a UAC prompt; never run on a real machine.
  it.runIf(process.env.CI === 'true' && process.platform === 'win32')('writes the real file and Windows answers from it (CI)', async () => {
    const dir = path.join(os.tmpdir(), 'np-hosts')
    const before = readHosts()
    await writeHosts(applyHosts(before, { kind: 'add', ip: '127.0.0.7', name: 'netplain-ci.test' }), dir)
    try {
      expect((await dns.lookup('netplain-ci.test', { family: 4 })).address).toBe('127.0.0.7')
    } finally {
      await writeHosts(before, dir)
    }
    expect(readHosts()).toBe(before)
  }, 60_000)
})
