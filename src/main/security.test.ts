import { expect, it } from 'vitest'
import { createSecurity } from './security'

// Reads this computer's real settings (no admin rights needed); Windows only.
it.skipIf(process.platform !== 'win32')('reads the Windows security picture', async () => {
  const s = await createSecurity({ online: async () => [], dns: () => [], geo: () => ({ org: null, country: null }) }).get()
  expect(s.users.some((u) => u.me)).toBe(true)
  expect(s.services.length).toBeGreaterThan(50)
  // Signature answers depend on the machine (GitHub's Windows runners verify none of them), so CI only reports them.
  const log = s.services.find((x) => x.name.toLowerCase() === 'eventlog')
  const valid = s.services.filter((x) => x.signer?.status === 'valid').length
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Signatures on this runner::${valid} of ${s.services.length} valid; eventlog ${JSON.stringify(log?.signer ?? null)}`)
  else expect(log?.signer?.status).toBe('valid')
  expect(s.firewall.length).toBeGreaterThan(0)
  expect(s.findings.some((f) => f.key.startsWith('firewall'))).toBe(true)
}, 120_000)
