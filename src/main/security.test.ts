import { expect, it } from 'vitest'
import { createSecurity } from './security'

// Reads this computer's real settings (no admin rights needed); Windows only.
it.skipIf(process.platform !== 'win32')('reads the Windows security picture', async () => {
  const s = await createSecurity({ online: async () => [], dns: () => [], geo: () => ({ org: null }) }).get()
  expect(s.users.some((u) => u.me)).toBe(true)
  expect(s.services.length).toBeGreaterThan(50)
  // Signatures are read (CI runners may not answer for catalog-signed system files: then unknown, never "bad").
  expect(s.services.some((x) => x.signer?.status === 'valid')).toBe(true)
  const log = s.services.find((x) => x.name.toLowerCase() === 'eventlog')
  expect(['valid', undefined], JSON.stringify(log)).toContain(log?.signer?.status)
  expect(s.firewall.length).toBeGreaterThan(0)
  expect(s.findings.some((f) => f.key.startsWith('firewall'))).toBe(true)
}, 120_000)
