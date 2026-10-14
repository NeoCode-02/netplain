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
