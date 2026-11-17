// Builds the Tidepool backdrop SVG (run: node scripts/gen-scene.mjs): two drifting caustic nets that brighten toward a
// light source in the top-right, light shafts from it, and a few drifting motes.
// Deterministic (seeded). Cheap to animate: no masks or filters, and every animation
// steps on one shared 10 Hz clock, so the scene repaints 10 times a second, not 60.
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const TICK = 0.1 // seconds per step, shared by every animation
const SRC = [1380, -120] // the light source, above the top-right corner
const REACH = [1400, 700] // how far the caustics reach from it (an ellipse)

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

function clip(poly, px, py, nx, ny) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const da = (a[0] - px) * nx + (a[1] - py) * ny, db = (b[0] - px) * nx + (b[1] - py) * ny
    if (da <= 0) out.push(a)
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]) }
  }
  return out
}

// A Voronoi net drawn as rounded cells: each cell's outline is a chain of quadratic
// curves through its edge midpoints, so neighbours touch mid-edge and part at the
// corners, the look of caustic light. Cells beyond the light's reach are left out.
function net({ seed, spacing, x0, x1, y0, y1, jitter = 0.38, cutoff = 0.98 }) {
  const r = rng(seed), pts = []
  for (let y = y0, row = 0; y <= y1; y += spacing * 0.87, row++)
    for (let x = x0 + (row % 2 ? spacing / 2 : 0); x <= x1; x += spacing)
      pts.push([x + (r() - 0.5) * 2 * jitter * spacing, y + (r() - 0.5) * 2 * jitter * spacing])
  const f = Math.round
  let d = '', cells = 0
  for (const p of pts) {
    if (Math.hypot((p[0] - SRC[0]) / REACH[0], (p[1] - SRC[1]) / REACH[1]) > cutoff) continue
    let poly = [[p[0] - 3 * spacing, p[1] - 3 * spacing], [p[0] + 3 * spacing, p[1] - 3 * spacing], [p[0] + 3 * spacing, p[1] + 3 * spacing], [p[0] - 3 * spacing, p[1] + 3 * spacing]]
    for (const q of pts) {
      if (q === p) continue
      const dx = q[0] - p[0], dy = q[1] - p[1]
      if (dx * dx + dy * dy > 9 * spacing * spacing) continue
      poly = clip(poly, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, dx, dy)
    }
    if (poly.length < 3 || poly.some(v => Math.abs(v[0] - p[0]) >= 2.9 * spacing || Math.abs(v[1] - p[1]) >= 2.9 * spacing)) continue
    poly = poly.filter((v, i) => { const w = poly[(i + 1) % poly.length]; return Math.hypot(v[0] - w[0], v[1] - w[1]) > 2 })
    const n = poly.length, mid = i => { const a = poly[i], b = poly[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }
    const m = mid(n - 1)
    d += `M${f(m[0])} ${f(m[1])}`
    for (let i = 0; i < n; i++) { const v = poly[i], mm = mid(i); d += `Q${f(v[0])} ${f(v[1])} ${f(mm[0])} ${f(mm[1])}` }
    d += 'Z'; cells++
  }
  return { d, cells }
}

const A = net({ seed: 7, spacing: 112, x0: -160, x1: 1760, y0: -160, y1: 600 })
const B = net({ seed: 31, spacing: 158, x0: -200, x1: 1800, y0: -200, y1: 640, jitter: 0.33 })

// an animation on the shared clock: duration a whole number of ticks, delay too
const anim = (name, seconds, delay = 0, extra = 'infinite alternate') =>
  `animation:${name} ${seconds}s steps(${Math.round(seconds / TICK)},jump-none) ${-Math.abs(delay)}s ${extra}`

const r = rng(99), motes = []
for (let i = 0; i < 16; i++) {
  const right = i < 11
  const x = right ? 1120 + r() * 460 : 60 + r() * 380
  const y = 260 + r() * 520
  motes.push({ x: Math.round(x), y: Math.round(y), r: (1.6 + r() * 2.4).toFixed(1), dur: Math.round(16 + r() * 16), delay: Math.round(r() * 30), side: i % 2 ? 'r' : 'l' })
}

const css = [
  '/* light mode, sunlit shallows */',
  '.w0{stop-color:#cbe6e1}.w1{stop-color:#dfede9}.w2{stop-color:#e8efeb}',
  '.sun0{stop-color:#ffffff;stop-opacity:.85}.sun1{stop-color:#ffffff;stop-opacity:0}',
  '.ray0{stop-color:#ffffff;stop-opacity:.75}.ray1{stop-color:#ffffff;stop-opacity:0}',
  '.c0,.c1,.c2,.c3{stop-color:#ffffff}.c0{stop-opacity:1}.c1{stop-opacity:.9}.c2{stop-opacity:.4}.c3{stop-opacity:0}',
  '.e0,.e1,.e2,.e3{stop-color:#7fc2b8}.e0{stop-opacity:.55}.e1{stop-opacity:.45}.e2{stop-opacity:.2}.e3{stop-opacity:0}',
  '.a .line{opacity:.85}.b .line{opacity:.55}',
  '.mote{fill:#7cc4bd}',
  '@media (prefers-color-scheme: dark){',
  '/* dark mode, a tidepool at night */',
  '.w0{stop-color:#103036}.w1{stop-color:#0b1f23}.w2{stop-color:#0a181b}',
  '.sun0{stop-color:#5fd0c4;stop-opacity:.32}.sun1{stop-color:#5fd0c4;stop-opacity:0}',
  '.ray0{stop-color:#9be6dc;stop-opacity:.22}.ray1{stop-color:#9be6dc;stop-opacity:0}',
  '.c0,.c1,.c2,.c3{stop-color:#86e8da}.c0{stop-opacity:.95}.c1{stop-opacity:.8}.c2{stop-opacity:.3}.c3{stop-opacity:0}',
  '.edge{display:none}',
  '.a .line{opacity:.55}.b .line{opacity:.32}',
  '.mote{fill:#8ff3e4}',
  '}',
  `.a{${anim('driftA', 31)}}`,
  `.b{${anim('driftB', 43)}}`,
  `.a .line{${anim('breathe', 9)}}`,
  `.b .line{${anim('breathe', 13, 6)}}`,
  `.rays{transform-origin:1520px -140px;${anim('sway', 24)}}`,
  `.ray{${anim('shaft', 11)}}`,
  `.ray:nth-child(2){${anim('shaft', 14, 5)}}`,
  `.ray:nth-child(3){${anim('shaft', 17, 9)}}`,
  `.ray:nth-child(4){${anim('shaft', 12, 3)}}`,
  `.ray:nth-child(5){${anim('shaft', 19, 12)}}`,
  '.mote{opacity:.55}',
  ...motes.map((m, i) => `.m${i}{${anim(m.side === 'r' ? 'riseR' : 'riseL', m.dur, m.delay, 'infinite')}}`),
  '@keyframes driftA{from{transform:translate(0px,0px)}to{transform:translate(70px,26px)}}',
  '@keyframes driftB{from{transform:translate(0px,0px)}to{transform:translate(-64px,34px)}}',
  '@keyframes breathe{from{opacity:.35}to{opacity:1}}',
  '@keyframes sway{from{transform:rotate(-1.6deg)}to{transform:rotate(1.4deg)}}',
  '@keyframes shaft{from{opacity:.35}to{opacity:1}}',
  '@keyframes riseL{0%{transform:translate(0px,0px);opacity:0}15%{opacity:.6}85%{opacity:.6}100%{transform:translate(-18px,-120px);opacity:0}}',
  '@keyframes riseR{0%{transform:translate(0px,0px);opacity:0}15%{opacity:.6}85%{opacity:.6}100%{transform:translate(16px,-104px);opacity:0}}',
  '/* a tall narrow box, such as a phone held upright, brings the shafts into view */',
  '@media (max-aspect-ratio: 4/5){.rays{translate:-120px 0px}}',
  '@media (prefers-reduced-motion: reduce){svg *{animation:none !important}}',
].join('')

const shafts = [
  [1500, -140, 1240, 760, 70, 170],
  [1520, -140, 1050, 820, 46, 120],
  [1540, -140, 1400, 900, 40, 110],
  [1490, -140, 860, 700, 30, 90],
  [1560, -140, 1560, 880, 36, 100],
].map(([sx, sy, ex, ey, w0, w1]) => {
  const dx = ex - sx, dy = ey - sy, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L
  const p = [[sx + nx * w0 / 2, sy + ny * w0 / 2], [ex + nx * w1 / 2, ey + ny * w1 / 2], [ex - nx * w1 / 2, ey - ny * w1 / 2], [sx - nx * w0 / 2, sy - ny * w0 / 2]]
  return `<polygon class="ray" fill="url(#ray)" points="${p.map(q => q.map(Math.round).join(',')).join(' ')}"/>`
}).join('')

const moteEls = motes.map((m, i) => `<circle class="mote m${i}" cx="${m.x}" cy="${m.y}" r="${m.r}"/>`).join('')

// the caustic strokes fade with distance from the light, as an elliptical gradient
const falloff = (id, cls) => `<radialGradient id="${id}" cx="${SRC[0]}" cy="${SRC[1]}" r="${REACH[0]}" gradientUnits="userSpaceOnUse" gradientTransform="translate(${SRC[0]} ${SRC[1]}) scale(1 ${REACH[1] / REACH[0]}) translate(${-SRC[0]} ${-SRC[1]})"><stop class="${cls}0" offset="0"/><stop class="${cls}1" offset=".3"/><stop class="${cls}2" offset=".65"/><stop class="${cls}3" offset=".98"/></radialGradient>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMaxYMin slice">` +
`<style>${css}</style>` +
`<defs>` +
`<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop class="w0" offset="0"/><stop class="w1" offset=".45"/><stop class="w2" offset="1"/></linearGradient>` +
`<radialGradient id="sun" cx="1500" cy="-60" r="760" gradientUnits="userSpaceOnUse"><stop class="sun0" offset="0"/><stop class="sun1" offset="1"/></radialGradient>` +
`<linearGradient id="ray" x1="1500" y1="-140" x2="1150" y2="820" gradientUnits="userSpaceOnUse"><stop class="ray0" offset="0"/><stop class="ray1" offset="1"/></linearGradient>` +
falloff('lit', 'c') + falloff('rim', 'e') +
`<path id="na" d="${A.d}"/><path id="nb" d="${B.d}"/>` +
`</defs>` +
`<!-- water -->` +
`<rect x="-400" y="-400" width="2400" height="1800" fill="url(#water)"/>` +
`<rect x="-400" y="-400" width="2400" height="1800" fill="url(#sun)"/>` +
`<!-- caustic light on the surface -->` +
`<g fill="none">` +
`<g class="b"><use href="#nb" class="edge" stroke="url(#rim)" stroke-width="5"/><g class="line"><use href="#nb" stroke="url(#lit)" stroke-width="2"/></g></g>` +
`<g class="a"><use href="#na" class="edge" stroke="url(#rim)" stroke-width="5.5"/><g class="line"><use href="#na" stroke="url(#lit)" stroke-width="2.6"/></g></g>` +
`</g>` +
`<!-- light shafts -->` +
`<g class="rays">${shafts}</g>` +
`<!-- drifting motes -->` +
`<g>${moteEls}</g>` +
`</svg>`

const out = fileURLToPath(new URL('../hooks/scene.ts', import.meta.url))
writeFileSync(out, '// Generated by scripts/gen-scene.mjs. Edit that file and run it again, rather than this one.\n// The Tidepool backdrop: caustic light drifting on a tidepool, light shafts and motes.\nexport const SCENE = ' + JSON.stringify(svg) + '\n')
console.log('svg chars:', svg.length, 'cells:', A.cells, '+', B.cells)
