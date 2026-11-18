// Ink in water: glowing dye carried by a slow curling current. A moving or
// pressed pointer pours ink and pushes the water; faint currents keep it alive.
import { Buffer, buffer, clamp, cos, dot, dt, exp, first, floor, fract, fresh, length, max, min, mix, normalize, picture, pointers, pow, shader, sin, size, time, vec2, vec3, vec4 } from 'claude-code/shader'

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

// the water's current: the curl of a slowly changing noise field
const curl = (p: vec2) => {
  const e = 0.004
  const t = time * 0.04
  const n1 = fbm(vec2(p * 1.6 + vec2(t, t + e)), 4)
  const n2 = fbm(vec2(p * 1.6 + vec2(t, t - e)), 4)
  const n3 = fbm(vec2(p * 1.6 + vec2(t + e, t)), 4)
  const n4 = fbm(vec2(p * 1.6 + vec2(t - e, t)), 4)
  return vec2((n1 - n2) / (2 * e), -(n3 - n4) / (2 * e))
}
const hue = (h: number) => vec3(0.5 + 0.5 * cos(vec3(6.2831 * h, 6.2831 * (h + 0.33), 6.2831 * (h + 0.67))))

const dye: Buffer = buffer({ scale: 0.5, float: 16, filter: 'linear' }, px => {
  if (first || fresh) return vec4(0, 0, 0, 1)
  const uv = px.uv
  const asp = size.x / max(size.y, 1)
  const p = vec2(uv.x * asp, uv.y)
  const step = min(dt, 0.05)
  let v = vec2(curl(p) * 0.035)
  let add = vec3(0)
  for (const q of pointers) {
    const here = q.gone > 0 ? 0 : 1
    const qp = vec2(q.where.x * asp, q.where.y)
    const vel = vec2((q.where.x - q.where.z) / max(dt, 0.001), (q.where.y - q.where.w) / max(dt, 0.001))
    const d = vec2(p - qp)
    const d2 = dot(d, d)
    v = vec2(v + vel * (exp(-d2 / 0.012) * here * 0.9))
    const speed = clamp(length(vel) * 3, 0, 1.5)
    add = vec3(add + hue(time * 0.03 + qp.x * 0.15) * (exp(-d2 / 0.0018) * here * (0.7 * q.down + speed) * step * 5))
  }
  // three faint wandering springs, so the water never goes still
  for (let i = 0; i < 3; i++) {
    const t = time * (0.05 + i * 0.02) + i * 2.1
    const s = vec2((0.5 + 0.42 * sin(t * 1.3 + i)) * asp, 0.5 + 0.38 * sin(t * 0.9 + i * 1.7))
    const d = vec2(p - s)
    add = vec3(add + hue(0.55 + i * 0.18 + time * 0.01) * (exp(-dot(d, d) / 0.0016) * step * 0.9))
  }
  const back = vec2(uv.x - (v.x / asp) * step, uv.y - v.y * step)
  const c = vec3(dye.sample(back).rgb * (1 - 0.18 * step) + add)
  return vec4(min(c, vec3(4)), 1)
})

const water = picture(px => {
  const uv = px.uv
  const t = vec2(1 / max(dye.size.x, 1), 1 / max(dye.size.y, 1))
  const d = vec3(dye.sample(uv).rgb)
  const l = dot(d, vec3(0.3, 0.5, 0.2))
  const gx = dot(vec3(dye.sample(vec2(uv.x + t.x, uv.y)).rgb - dye.sample(vec2(uv.x - t.x, uv.y)).rgb), vec3(0.33))
  const gy = dot(vec3(dye.sample(vec2(uv.x, uv.y + t.y)).rgb - dye.sample(vec2(uv.x, uv.y - t.y)).rgb), vec3(0.33))
  const n = vec3(normalize(vec3(-gx * 6, -gy * 6, 0.4)))
  const sheen = pow(clamp(0.5 + dot(n, vec3(normalize(vec3(-0.4, 0.6, 0.7)))) * 0.5, 0, 1), 8)
  const bg = vec3(mix(vec3(0.015, 0.017, 0.03), vec3(0.035, 0.03, 0.06), uv.y))
  const col = vec3(bg + (1 - exp(vec3(d * -1.4))) + sheen * 0.35 * clamp(l, 0, 1))
  return vec4(col, 1)
})

export default shader({ fps: 30, passes: [dye, water] })
