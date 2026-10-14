import type { Release } from '../shared/types'

const REPO = 'NeoCode-02/netplain'

/** True when version `a` ("0.2.0" or "v0.2.0") is newer than `b`. */
export function newer(a: string, b: string): boolean {
  const n = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number(x) || 0)
  const [x, y] = [n(a), n(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/** The latest published release when it is newer than `current`; null when up to date or there is none yet. */
export async function checkRelease(current: string): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) return null
  const r = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || !r.html_url.startsWith(`https://github.com/${REPO}/`)) return null
  return newer(r.tag_name, current) ? { version: r.tag_name.replace(/^v/, ''), url: r.html_url } : null
}
