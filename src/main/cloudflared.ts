import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { run, tryRun } from './exec'
import { powershell, signScript, toSigner } from './security'

const ASSETS: Record<string, string> = {
  'win32-x64': 'cloudflared-windows-amd64.exe',
  'win32-ia32': 'cloudflared-windows-386.exe',
  'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
  'darwin-x64': 'cloudflared-darwin-amd64.tgz',
  'linux-x64': 'cloudflared-linux-amd64',
  'linux-arm64': 'cloudflared-linux-arm64',
  'linux-arm': 'cloudflared-linux-arm'
}

/** The release file for this computer, or null when Cloudflare builds none. */
export const asset = (platform: string = process.platform, arch: string = process.arch) => ASSETS[`${platform}-${arch}`] ?? null

/** The SHA-256 the release notes list for `name` ("cloudflared-linux-amd64: 86ae…"). */
export function checksum(notes: string, name: string): string | null {
  const line = notes.split(/\r?\n/).find((l) => l.trim().startsWith(`${name}:`))
  return /\b([0-9a-f]{64})\b/.exec(line ?? '')?.[1] ?? null
}

const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'

/** cloudflared downloaded by Netplain into `dir`, else one installed on the system, else null. */
export async function findCloudflared(dir: string): Promise<{ file: string; where: 'app' | 'system' } | null> {
  const own = path.join(dir, exe)
  if (fs.existsSync(own)) return { file: own, where: 'app' }
  return (await tryRun('cloudflared', ['--version'], 10_000)) ? { file: 'cloudflared', where: 'system' } : null
}

/**
 * Downloads the latest cloudflared from Cloudflare's GitHub releases into `dir`. The file must match the
 * checksum in the release notes and, on Windows, carry a valid Cloudflare signature.
 */
export async function installCloudflared(dir: string): Promise<string> {
  const name = asset()
  if (!name) throw new Error('E_UNSUPPORTED')
  const rel = (await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { body?: string; assets?: { name: string; browser_download_url: string }[] } | null
  const url = rel?.assets?.find((a) => a.name === name)?.browser_download_url
  const sum = checksum(rel?.body ?? '', name)
  if (!url?.startsWith('https://github.com/cloudflare/cloudflared/releases/download/') || !sum) throw new Error('E_CLOUDFLARED_DOWNLOAD')
  const data = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => Buffer.from(b))
    .catch(() => {
      throw new Error('E_CLOUDFLARED_DOWNLOAD')
    })
  if (crypto.createHash('sha256').update(data).digest('hex') !== sum) throw new Error('E_CLOUDFLARED_DOWNLOAD')

  const tmp = path.join(dir, 'download')
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(tmp, { recursive: true })
  const file = path.join(tmp, exe)
  if (name.endsWith('.tgz')) {
    fs.writeFileSync(path.join(tmp, name), data)
    await run('tar', ['-xzf', path.join(tmp, name), '-C', tmp], 60_000)
  } else fs.writeFileSync(file, data)
  fs.chmodSync(file, 0o755)
  if (process.platform === 'win32') {
    const signed = JSON.parse((await powershell(signScript([file]))) || '{}') as Record<string, { status?: string; publisher?: string }>
    const s = toSigner(Object.values(signed)[0])
    if (s?.status !== 'valid' || !/^Cloudflare/i.test(s.publisher ?? '')) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw new Error('E_CLOUDFLARED_SIGNATURE')
    }
  }
  fs.renameSync(file, path.join(dir, exe))
  fs.rmSync(tmp, { recursive: true, force: true })
  return path.join(dir, exe)
}
