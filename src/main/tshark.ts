import fs from 'node:fs'
import path from 'node:path'
import { run } from './exec'

const EXE = process.platform === 'win32' ? 'tshark.exe' : 'tshark'
const KNOWN: Record<string, string[]> = {
  win32: [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Wireshark')],
  darwin: ['/Applications/Wireshark.app/Contents/MacOS', '/opt/homebrew/bin', '/usr/local/bin'],
  linux: ['/usr/bin', '/usr/local/bin']
}

/** Wireshark's command-line engine, if installed. */
export function findTshark(): string | null {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...(KNOWN[process.platform] ?? [])]
  for (const d of dirs) {
    const file = d && path.join(d, EXE)
    if (file && fs.existsSync(file)) return file
  }
  return null
}

/** `tshark -G manuf`: "A4:2B:B0         \tTpLinkTechno\tTp-Link Technologies Co.,Ltd." → "a4:2b:b0" → long name. */
export function parseManuf(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const [prefix, short, long] = line.split('\t')
    const p = prefix?.trim().toLowerCase()
    // ponytail: only whole 24-bit blocks; the few /28 and /36 sub-blocks fall back to "unknown".
    if (p?.length === 8 && short) out.set(p, (long || short).trim())
  }
  return out
}

let vendors: Promise<Map<string, string>> | null = null

/** MAC prefix → company. Empty without Wireshark; loaded once (~0.4 s). */
export function vendorTable(): Promise<Map<string, string>> {
  vendors ??= (async () => {
    const tshark = findTshark()
    return tshark ? parseManuf(await run(tshark, ['-G', 'manuf'], 20_000)) : new Map<string, string>()
  })().catch(() => new Map<string, string>())
  return vendors
}
