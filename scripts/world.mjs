// Builds src/renderer/src/world.json from Natural Earth's countries (public domain, https://www.naturalearthdata.com):
//   node scripts/world.mjs ne_110m_admin_0_countries.geojson ne_50m_admin_0_countries.geojson
// One SVG path per country of the 110m set (equirectangular, Antarctica left out) and the point its label
// sits on; countries too small for 110m (Singapore, Hong Kong, Malta…) get only their point, from the 50m set.
import fs from 'node:fs'

const TOP = 84
const BOTTOM = -58
const W = 1000
const k = W / 360
const xy = ([lon, lat]) => [Math.round((lon + 180) * k * 10) / 10, Math.round((TOP - lat) * k * 10) / 10]

function ring(points) {
  const out = []
  for (const p of points.map(xy)) if (!out.length || p[0] !== out.at(-1)[0] || p[1] !== out.at(-1)[1]) out.push(p)
  return out.length > 2 ? `M${out.map((p) => p.join(',')).join('L')}Z` : ''
}

const features = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).features
// ISO_A2_EH also codes France and Norway, which ISO_A2 marks -99.
const iso = (f) => f.properties.ISO_A2_EH
const wanted = (code) => /^[A-Z]{2}$/.test(code) && code !== 'AQ'

const countries = {}
for (const f of features(process.argv[2])) {
  if (!wanted(iso(f)) || countries[iso(f)]) continue
  const g = f.geometry
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  countries[iso(f)] = { d: polygons.map((poly) => poly.map(ring).join('')).join(''), at: xy([f.properties.LABEL_X, f.properties.LABEL_Y]) }
}
for (const f of features(process.argv[3])) if (wanted(iso(f)) && !countries[iso(f)]) countries[iso(f)] = { d: '', at: xy([f.properties.LABEL_X, f.properties.LABEL_Y]) }

fs.writeFileSync(new URL('../src/renderer/src/world.json', import.meta.url), JSON.stringify({ w: W, h: Math.round((TOP - BOTTOM) * k), countries }))
console.log(Object.keys(countries).length, 'countries')
