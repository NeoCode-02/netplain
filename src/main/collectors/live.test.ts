import net from 'node:net'
import { expect, it } from 'vitest'
import type { Adapter } from '../../shared/types'
import { collector } from '.'

// Runs the real collector of the OS the tests run on (CI covers Windows, macOS and Linux),
// so a changed command output shows up here and not only in the app.
it('reads this computer’s adapters and neighbour table', async () => {
  const adapters = await new Promise<Adapter[]>((resolve, reject) => {
    const stop = collector.watch(
      (a) => {
        stop()
        resolve(a)
      },
      (e) => {
        stop()
        reject(e)
      }
    )
  })
  expect(adapters.length).toBeGreaterThan(0)
  expect(adapters.some((a) => a.up && a.ipv4.length > 0)).toBe(true)
  for (const a of adapters) expect(a.rx).toBeGreaterThanOrEqual(0)
  expect(Array.isArray(await collector.neighbors())).toBe(true)
}, 20_000)

it('finds a listening socket and the process that owns it', async () => {
  const server = net.createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as net.AddressInfo).port
  try {
    const [sockets, procs] = await Promise.all([collector.sockets(), collector.processes()])
    expect(sockets.find((s) => s.proto === 'tcp' && s.localPort === port)).toMatchObject({ localIp: '127.0.0.1', state: 'listen', pid: process.pid })
    expect(procs.find((p) => p.pid === process.pid)?.name).toMatch(/node/i)
  } finally {
    server.close()
  }
}, 20_000)
