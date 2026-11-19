// Summer meadow: a painted sky of towering cumulus drifting over blue
// mountains, green hills with round trees, and wind rolling through the grass.
// Your pointer is a gust: it bends the grass and trees and scatters the petals.
import { Buffer, abs, buffer, clamp, cos, sqrt, dot, exp, first, floor, fract, length, max, min, mix, normalize, picture, pointer, pointerCount, pointers, pow, shader, sin, size, smoothstep, table, time, vec2, vec3, vec4 } from 'claude-code/shader'

const hash = (q: vec2) => fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453)
const noise = (q: vec2) => {
  const i = vec2(floor(q))
  const f = vec2(fract(q))
  const u = vec2(f * f * (3 - 2 * f))
  return mix(mix(hash(i), hash(vec2(i + vec2(1, 0))), u.x), mix(hash(vec2(i + vec2(0, 1))), hash(vec2(i + vec2(1, 1))), u.x), u.y)
}

const fbm = (q0: vec2, octaves: number) => {
  let s = 0
  let a = 0.5
  let q = q0
  for (let i = 0; i < octaves; i++) {
    s += a * noise(q)
    q = vec2(q * 2.03 + 17.1)
    a *= 0.5
  }
  return s
}

const smin = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
  return mix(b, a, h) - k * h * (1 - h)
}
// Layouts fixed when this file was written, so no pixel works them out again:
// each cloud puff's offset along its cloud, its rise and its radius, in three layouts.
const PUFFS = table([
  [-0.500, 0.000, 0.421], [-0.333, 0.254, 0.669], [-0.167, 0.620, 0.784], [0.000, 0.627, 0.680],
  [0.167, 0.603, 0.722], [0.333, 0.282, 0.478], [0.500, 0.000, 0.373], [0.171, 1.569, 0.651],
  [0.037, 1.761, 0.637], [-0.046, 1.479, 0.560], [-0.193, 1.266, 0.572], [-0.500, 0.000, 0.320],
  [-0.333, 0.495, 0.712], [-0.167, 0.692, 0.867], [0.000, 0.815, 0.878], [0.167, 0.838, 0.879],
  [0.333, 0.240, 0.562], [0.500, 0.000, 0.354], [-0.065, 1.686, 0.623], [-0.157, 1.548, 0.632],
  [0.182, 1.006, 0.477], [-0.087, 1.175, 0.484], [-0.500, 0.000, 0.399], [-0.333, 0.404, 0.503],
  [-0.167, 0.795, 0.676], [0.000, 0.640, 0.660], [0.167, 0.818, 0.896], [0.333, 0.289, 0.623],
  [0.500, 0.000, 0.426], [-0.088, 1.240, 0.503], [-0.002, 1.658, 0.605], [-0.114, 1.512, 0.593],
  [0.035, 1.927, 0.683],
])
// each petal: where it starts, its speed, its height, and the cosine of its tilt
const PETALS = table([
  [0.232, 0.119, 0.234, 0.915], [0.804, 0.748, 0.438, 0.039], [0.632, 0.543, 0.501, -0.207], [0.373, 0.853, 0.168, -0.992], [0.995, 0.616, 0.558, -0.968], [0.978, 0.829, 0.501, 0.236], [0.691, 0.729, 0.107, 0.912], [0.174, 0.301, 0.506, 0.937], [0.926, 0.592, 0.386, 0.998], [0.580, 0.333, 0.545, 0.966], [0.829, 0.225, 0.031, -0.283], [0.210, 0.620, 0.571, -0.978], [0.371, 0.825, 0.049, 0.123], [0.337, 0.108, 0.955, 0.633],
])
const TREES = table([[0.121, 0.0236], [0.245, 0.0307], [0.440, 0.0360], [0.591, 0.0353], [0.759, 0.0316], [0.908, 0.0374], [1.089, 0.0334]])
const CLOUDS = table([[0.086, 0.606], [0.999, 0.548], [1.300, 0.515], [1.602, 0.487], [1.075, 0.484]])

// A cumulus in its own units (height 1, width `ratio`, base at 0): rounded puffs
// along a dome with a tower on top, flat underneath, lit from the upper right.
// Answers its light and its signed distance from the edge (below 0 is inside).
const SUNWARD = vec2(0.55, 0.835)
const shape = (q: vec2, ratio: number, layout: number) => {
  let d = 1000
  let nx = 0
  let ny = 0
  let ws = 0
  for (let k = 0; k < 11; k++) {
    const puff = PUFFS.at(layout * 11 + k)
    const ox = q.x - puff.x * ratio
    const oy = q.y - puff.y
    const r = puff.z
    const sd = length(vec2(ox, oy)) - r
    d = smin(d, sd, 0.18)
    const wk = clamp(1 - max(sd, 0) * 3.6, 0, 1) * r
    nx += (ox / r) * wk
    ny += (oy / r) * wk
    ws += wk
  }
  d = max(d, -0.08 - q.y)
  const light = clamp(((nx * SUNWARD.x + ny * SUNWARD.y) / max(ws, 0.0001)) * 0.55 + 0.5 + q.y * 0.25, 0, 1)
  return vec2(light, d)
}
// The four cloud shapes, worked out once for each window size into one map:
// three layouts for the drifting clouds, and a long one for the horizon bank.
// Each quarter covers u = x / width from -0.8 to 0.8 and v = y / height from -0.3 to 2.9.
const U0 = -0.8
const U1 = 0.8
const V0 = -0.3
const V1 = 2.9
const shapes: Buffer = buffer({ size: [1024, 512], float: 16, filter: 'linear', once: true }, px => {
  const right = px.uv.x < 0.5 ? 0 : 1
  const top = px.uv.y < 0.5 ? 0 : 1
  const slot = top * 2 + right
  const u = U0 + fract(px.uv.x * 2) * (U1 - U0)
  const v = V0 + fract(px.uv.y * 2) * (V1 - V0)
  const ratio = slot > 2.5 ? 5.5 : 3.5
  const res = shape(vec2(u * ratio, v), ratio, slot > 2.5 ? 0 : slot)
  return vec4(res.x, res.y, 0, 1)
})
// One cloud in the sky: its light (above 1 is the sunlit fringe) and its cover.
const cloud = (p: vec2, c: vec2, w: number, hgt: number, slot: number, edge: number) => {
  const u = (p.x - c.x) / w
  const v = (p.y - c.y) / hgt
  const inside = u > U0 && u < U1 && v > V0 && v < V1
  const sx = (slot - 2 * floor(slot / 2)) * 0.5 + ((u - U0) / (U1 - U0)) * 0.5
  const sy = floor(slot / 2) * 0.5 + ((v - V0) / (V1 - V0)) * 0.5
  const t = shapes.sample(vec2(clamp(sx, 0, 1), clamp(sy, 0, 1)))
  const d = inside ? t.y * hgt + edge : 1
  return vec2(t.x + smoothstep(-0.02, 0, d) * 0.35, smoothstep(0.004, -0.004, d))
}
const ridge = (x: number, y0: number, a1: number, f1: number, ph: number, a2: number, f2: number) => y0 + a1 * sin(x * f1 + ph) + a2 * (fbm(vec2(x * f2, ph), 4) - 0.5)

// The hill lines depend on x alone: worked out once for each window size.
const hills: Buffer = buffer({ size: [1024, 1], float: 16, filter: 'linear', once: true }, px => {
  const x = px.uv.x * (size.x / max(size.y, 1))
  return vec4(ridge(x, 0.4, 0.03, 4, 0.5, 0.09, 3.5), ridge(x, 0.37, 0.025, 3.1, 1, 0.06, 2), ridge(x, 0.29, 0.04, 2.2, 2, 0.07, 3), ridge(x, 0.19, 0.025, 1.6, 4, 0.05, 2.5))
})

// where and when the last press began, for the ripple of wind it sends out
const press: Buffer = buffer({ size: [1, 1], float: 32, filter: 'nearest' }, () => {
  const was = press.at(vec2(0, 0))
  const down = pointerCount > 0 ? pointer(0).down : 0
  const fresh = down > 0.5 && was.w < 0.5
  return first ? vec4(0, 0, -100, 0) : fresh ? vec4(pointer(0).where.x, pointer(0).where.y, time, 1) : vec4(was.x, was.y, was.z, down)
})

const meadow = picture(px => {
  const uv = px.uv
  const asp = size.x / max(size.y, 1)
  const p = vec2(uv.x * asp, uv.y)
  const sun = vec2(0.8 * asp, 0.84)
  // the gust: where the pointer is, and how strongly
  let gx = 0.5 * asp
  let gy = 0.5
  let gw = 0
  for (const q of pointers) {
    const here = clamp(1 - q.gone * 1.5, 0, 1)
    gx = here > gw ? q.where.x * asp : gx
    gy = here > gw ? q.where.y : gy
    gw = max(gw, here)
  }
  const gp = vec2(gx, gy)

  // sky and sun
  let col = vec3(mix(vec3(0.7, 0.86, 0.93), vec3(0.2, 0.5, 0.86), smoothstep(0.35, 1, uv.y)))
  const ds = length(vec2(p - sun))
  col = vec3(col + vec3(1, 0.9, 0.7) * (exp(-ds * 3.5) * 0.35 + smoothstep(0.035, 0.03, ds) * 0.5 + exp(-ds * 22) * 0.25))

  const edge = (noise(vec2(p * 38)) - 0.5) * 0.006
  // a towering bank on the horizon, slow and hazy
  const bc = vec2(fract(0.3 + time * 0.0015) * (asp + 1.6) - 0.8, 0.38)
  const bank = cloud(p, bc, 1.1, 0.2, 3, edge)
  const bankCol = vec3(mix(vec3(0.7, 0.76, 0.9), vec3(1, 0.97, 0.92), clamp(bank.x, 0, 1)))
  col = vec3(mix(col, vec3(mix(bankCol, col, 0.25)), bank.y))
  // five drifting cumulus, small and far to large and near, each wrapping around
  for (let i = 0; i < 5; i++) {
    const sc = 0.45 + i * 0.2
    const span = asp + 1.2
    const at = CLOUDS.at(i)
    const c = vec2(fract(at.x + (time * (0.004 + 0.003 * i)) / span) * span - 0.6, at.y)
    const cl = cloud(p, c, 0.42 * sc, 0.12 * sc, i - 3 * floor(i / 3), edge)
    const shade = vec3(mix(vec3(0.62, 0.68, 0.86), vec3(0.74, 0.79, 0.92), 0.5 - i * 0.1))
    const cc = vec3(mix(shade, vec3(1, 0.985, 0.95), clamp(cl.x, 0, 1)) + vec3(1, 0.9, 0.7) * max(cl.x - 1, 0))
    col = vec3(mix(col, cc, cl.y * (0.88 + i * 0.04)))
  }

  // far blue mountains, a hazy far hill, the mid hill with round trees
  const line = hills.sample(vec2(uv.x, 0.5))
  const yb = line.x
  col = vec3(mix(col, vec3(0.55, 0.69, 0.82), smoothstep(yb + 0.002, yb - 0.002, uv.y) * 0.9))
  const yf = line.y
  col = vec3(mix(col, vec3(0.57, 0.75, 0.75), smoothstep(yf + 0.002, yf - 0.002, uv.y)))
  const ym = line.z
  const mid = vec3(mix(vec3(0.3, 0.55, 0.3), vec3(0.5, 0.74, 0.38), smoothstep(ym - 0.05, ym, uv.y)))
  col = vec3(mix(col, mid, smoothstep(ym + 0.002, ym - 0.002, uv.y)))
  const leafy = (noise(vec2(p * 140)) - 0.5) * 0.006
  for (let i = 0; i < 7; i++) {
    const tree0 = TREES.at(i)
    const tx = tree0.x * asp
    const ty = 0.29 + 0.04 * sin(tx * 2.2 + 2) - 0.01
    const r = tree0.y
    const tc = vec2(tx, ty + r * 0.8)
    const sway = sin(time * 0.9 + i) * 0.002 + exp(-pow((tx - gx) / 0.2, 2)) * gw * 0.006
    const rel = vec2((p.x - tc.x - sway) * 1, (p.y - tc.y) * 1.15)
    const tree = smoothstep(r, r - 0.003, length(rel) + leafy)
    const lit = clamp(((p.x - tc.x) * 0.55 + (p.y - tc.y) * 0.835) / r * 0.5 + 0.5, 0, 1)
    col = vec3(mix(col, vec3(mix(vec3(0.14, 0.33, 0.18), vec3(0.32, 0.55, 0.26), lit)), tree))
  }

  // the near meadow: bright waves of wind roll across, pushed by the gust
  const yn = line.w
  const gd = vec2(p - gp)
  const gust = exp(-dot(gd, gd) / 0.05) * gw
  const phase = (p.x + uv.y * 0.6) * 9 - time * 1.3 + fbm(vec2(p.x * 1.5, uv.y * 3 - time * 0.15), 3) * 3 - gust * 3
  let wave = smoothstep(0.55, 1, sin(phase)) * (0.6 + 0.8 * gust)
  const last = press.at(vec2(0, 0))
  const age = time - last.z
  const dr = length(vec2(p - vec2(last.x * asp, last.y)))
  wave += exp(-pow((dr - age * 0.45) / 0.05, 2)) * clamp(1 - age / 2, 0, 1) * 0.9
  const lean = (sin(time * 1.1 + p.x * 4) * 0.5 + gust) * (yn - uv.y) * 0.4
  const blades = noise(vec2((p.x + lean) * 220, uv.y * 26))
  const grass = vec3(vec3(mix(vec3(0.2, 0.43, 0.15), vec3(0.42, 0.66, 0.26), smoothstep(0, yn, uv.y))) * (0.82 + 0.3 * blades) + vec3(0.18, 0.2, 0.06) * wave)
  col = vec3(mix(col, grass, smoothstep(yn + 0.003, yn - 0.003, uv.y)))

  // petals riding the wind, tumbling, scattered by the gust
  for (let i = 0; i < 14; i++) {
    const pt = PETALS.at(i)
    const q0 = vec2(fract(pt.x + time * (0.025 + 0.025 * pt.y)) * (asp + 0.2) - 0.1, 0.12 + 0.72 * pt.z + 0.05 * sin(time * (0.6 + pt.y) + i))
    const away = vec2(q0 - gp)
    const reach = dot(away, away)
    const q = vec2(q0 + away * ((exp(-reach / 0.02) * gw * 0.08) / max(sqrt(reach), 0.01)))
    const ca = pt.w
    const sa = sqrt(max(1 - ca * ca, 0))
    const dd = vec2(p - q)
    const rx = dd.x * ca - dd.y * sa
    const ry = (dd.x * sa + dd.y * ca) / max(abs(sin(time * (1.5 + pt.y * 2) + i)), 0.25)
    const petal = smoothstep(1, 0.6, length(vec2(rx / 0.006, ry / 0.0032)))
    col = vec3(mix(col, vec3(1, 0.93, 0.95), petal * 0.9))
  }
  return vec4(col, 1)
})

export default shader({ fps: 30, passes: [hills, shapes, press, meadow] })
