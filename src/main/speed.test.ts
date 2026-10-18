import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { colo, createSpeed, jitter, mbps, median } from './speed'

describe('speed maths', () => {
  it('takes medians, jitter and Mbit/s', () => {
    expect(median([30, 10, 20])).toBe(20)
    expect(median([10, 20, 30, 41])).toBe(25)
    expect(median([])).toBeNull()
    expect(jitter([10, 14, 10, 10])).toBe(3)
    expect(jitter([10])).toBeNull()
    // 12.5 MB in 1 s is 100 Mbit/s.
    expect(mbps(12_500_000, 1000)).toBe(100)
    expect(mbps(5, 0)).toBe(0)
    expect(colo('a4c3f04a0925f56d-WAW')).toBe('WAW')
    expect(colo(undefined)).toBeNull()
  })
})

// Downloads and uploads for real (about 20 s and some data): SPEED_LIVE=1 npx vitest run src/main/speed.test.ts
describe.runIf(process.env.SPEED_LIVE)('live', () => {
  it('runs the three phases and keeps the result', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-speed-'))
    const s = createSpeed(dir)
    for (const p of ['latency', 'down', 'up'] as const) {
      const t0 = Date.now()
      const r = await s.phase(p)
      console.log(p, Date.now() - t0, 'ms', JSON.stringify(r))
    }
    const [r] = s.history()
    expect(r.down).toBeGreaterThan(0)
    expect(r.up).toBeGreaterThan(0)
    expect(r.idle).toBeGreaterThan(0)
    expect(r.loadedDown).toBeGreaterThan(0)
    fs.rmSync(dir, { recursive: true })
  }, 60_000)
})
