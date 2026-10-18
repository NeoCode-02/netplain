import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { Conn } from '../shared/types'
import { stopGuard, stopProcess } from './kill'

const conn = (pid: number, path: string | null): Conn => ({ proto: 'tcp', localIp: '0.0.0.0', localPort: 3000, remoteIp: null, remotePort: null, state: 'LISTEN', pid, app: 'x', title: null, path, host: null, country: null, org: null, scope: 'any' }) as unknown as Conn

describe('stopping the program behind a port', () => {
  const listening = [conn(4, null), conn(900, 'C:\\Windows\\System32\\svchost.exe'), conn(901, '/usr/sbin/sshd'), conn(902, null), conn(5000, 'C:\\Program Files\\nodejs\\node.exe'), conn(5001, 'D:\\netplain\\electron.exe')]

  it('refuses the system, unknown files, Netplain itself and anything not listening', () => {
    expect(stopGuard(4, listening, [])).toBe('E_BAD_ARGS')
    expect(stopGuard(900, listening, [])).toBe('E_SYSTEM_PROCESS')
    expect(stopGuard(901, listening, [])).toBe('E_SYSTEM_PROCESS')
    expect(stopGuard(902, listening, [])).toBe('E_SYSTEM_PROCESS')
    expect(stopGuard(5001, listening, [5001, 5002])).toBe('E_NETPLAIN')
    expect(stopGuard(7777, listening, [])).toBe('E_BAD_ARGS')
    expect(stopGuard(5000, listening, [])).toBeNull()
  })

  it('ends a program of this user without asking for admin rights, and a gone one is fine', async () => {
    const child = spawn(process.execPath, ['-e', "require('net').createServer().listen(0); setTimeout(() => {}, 60000)"], { stdio: 'ignore' })
    await new Promise((r) => child.once('spawn', r))
    const exited = new Promise((r) => child.once('exit', r))
    await stopProcess(child.pid!)
    await exited
    await expect(stopProcess(child.pid!)).resolves.toBeUndefined()
  })
})
