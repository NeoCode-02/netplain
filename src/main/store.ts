import fs from 'node:fs'
import path from 'node:path'

/** A JSON file's value, or `fallback` when it is missing or unreadable. */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Writes through a temporary file and a rename, so a crash never leaves half a file behind. */
export function writeJson(file: string, value: unknown, space?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, space))
  fs.renameSync(`${file}.tmp`, file)
}
