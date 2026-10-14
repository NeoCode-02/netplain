import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Reader, type AsnResponse, type CountryResponse } from 'mmdb-lib'
import type { GeoInfo } from '../shared/types'

// DB-IP Lite (CC BY 4.0, https://db-ip.com): free country and ASN databases, published monthly.
const KINDS = ['country', 'asn'] as const
const MAX = 64 * 1024 * 1024

const month = (back: number) => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - back)
  return d.toISOString().slice(0, 7)
}

async function fetchDb(kind: (typeof KINDS)[number]): Promise<Buffer> {
  // This month's file appears on the 1st; until then the previous month is the newest.
  for (const back of [0, 1]) {
    const res = await fetch(`https://download.db-ip.com/free/dbip-${kind}-lite-${month(back)}.mmdb.gz`)
    if (!res.ok) continue
    const gz = Buffer.from(await res.arrayBuffer())
    if (gz.length > MAX) break
    const data = gunzipSync(gz, { maxOutputLength: MAX })
    new Reader(data) // throws on anything that is not a MaxMind DB
    return data
  }
  throw new Error('E_GEO_DOWNLOAD')
}

export function createGeo(dir: string) {
  let country: Reader<CountryResponse> | null = null
  let asn: Reader<AsnResponse> | null = null

  const open = <T extends CountryResponse | AsnResponse>(kind: string): Reader<T> | null => {
    try {
      return new Reader<T>(fs.readFileSync(path.join(dir, `${kind}.mmdb`)))
    } catch {
      return null
    }
  }
  const load = () => {
    country = open<CountryResponse>('country')
    asn = open<AsnResponse>('asn')
  }
  load()

  const info = (): GeoInfo => ({ ready: !!country && !!asn, built: country?.metadata.buildEpoch.getTime() ?? null })

  return {
    info,
    lookup(ip: string): { country: string | null; org: string | null } {
      try {
        return { country: country?.get(ip)?.country?.iso_code ?? null, org: asn?.get(ip)?.autonomous_system_organization ?? null }
      } catch {
        return { country: null, org: null }
      }
    },
    /** Downloads both databases (~9 MB) and swaps them in; the old files stay if anything fails. */
    async update(): Promise<GeoInfo> {
      const files = await Promise.all(KINDS.map(fetchDb))
      fs.mkdirSync(dir, { recursive: true })
      KINDS.forEach((kind, i) => {
        const file = path.join(dir, `${kind}.mmdb`)
        fs.writeFileSync(`${file}.tmp`, files[i])
        fs.renameSync(`${file}.tmp`, file)
      })
      load()
      return info()
    }
  }
}
