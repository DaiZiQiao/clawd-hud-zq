// Living coral: a reaction-diffusion pattern that grows, splits and keeps
// changing. Pressing seeds new growth under the pointer.
import { Buffer, buffer, clamp, dot, first, floor, fract, fresh, length, max, mix, normalize, picture, pointers, pow, shader, sin, size, smoothstep, time, vec2, vec3, vec4 } from 'claude-code/shader'

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

const reef: Buffer = buffer({ scale: 0.35, float: 16, filter: 'linear', repeat: 12 }, px => {
  const uv = px.uv
  const asp = size.x / max(size.y, 1)
  const p = vec2(uv.x * asp, uv.y)
  if (first || fresh) {
    let seed = 0
    for (let i = 0; i < 14; i++) {
      const c = vec2(hash(vec2(i, 1.7)) * asp, hash(vec2(i, 9.2)))
      seed += length(vec2(p - c)) < 0.012 + 0.012 * hash(vec2(i, 3.3)) ? 1 : 0
    }
    return vec4(1, clamp(seed, 0, 1) * 0.5, 0, 1)
  }
  const s = vec4(reef.at(px.cell))
  const lap = vec2(
    -s.x + 0.2 * (reef.at(vec2(px.cell.x + 1, px.cell.y)).x + reef.at(vec2(px.cell.x - 1, px.cell.y)).x + reef.at(vec2(px.cell.x, px.cell.y + 1)).x + reef.at(vec2(px.cell.x, px.cell.y - 1)).x)
      + 0.05 * (reef.at(vec2(px.cell.x + 1, px.cell.y + 1)).x + reef.at(vec2(px.cell.x - 1, px.cell.y - 1)).x + reef.at(vec2(px.cell.x + 1, px.cell.y - 1)).x + reef.at(vec2(px.cell.x - 1, px.cell.y + 1)).x),
    -s.y + 0.2 * (reef.at(vec2(px.cell.x + 1, px.cell.y)).y + reef.at(vec2(px.cell.x - 1, px.cell.y)).y + reef.at(vec2(px.cell.x, px.cell.y + 1)).y + reef.at(vec2(px.cell.x, px.cell.y - 1)).y)
      + 0.05 * (reef.at(vec2(px.cell.x + 1, px.cell.y + 1)).y + reef.at(vec2(px.cell.x - 1, px.cell.y - 1)).y + reef.at(vec2(px.cell.x + 1, px.cell.y - 1)).y + reef.at(vec2(px.cell.x - 1, px.cell.y + 1)).y))
  const u = s.x
  const v = s.y
  const uvv = u * v * v
  // feed and kill drift slowly across the reef, so the pattern never settles
  const f = 0.026 + 0.016 * noise(vec2(uv * 2.2 + time * 0.006))
  const k = 0.055 + 0.0075 * noise(vec2(uv * 2.6 - time * 0.005 + 7))
  let nu = u + (lap.x - uvv + f * (1 - u))
  let nv = v + (0.5 * lap.y + uvv - (f + k) * v)
  for (const q of pointers) {
    const qp = vec2(q.where.x * asp, q.where.y)
    nv = q.down > 0.5 && length(vec2(p - qp)) < 0.022 ? max(nv, 0.6) : nv
  }
  nv = hash(vec2(px.cell + floor(time * 0.7))) > 0.99997 ? 0.5 : nv
  return vec4(clamp(nu, 0, 1), clamp(nv, 0, 1), 0, 1)
})

const sea = picture(px => {
  const uv = px.uv
  const t = vec2(1 / max(reef.size.x, 1), 1 / max(reef.size.y, 1))
  const v = reef.sample(uv).y
  const vx = reef.sample(vec2(uv.x + t.x, uv.y)).y - reef.sample(vec2(uv.x - t.x, uv.y)).y
  const vy = reef.sample(vec2(uv.x, uv.y + t.y)).y - reef.sample(vec2(uv.x, uv.y - t.y)).y
  const n = vec3(normalize(vec3(-vx * 9, -vy * 9, 0.35)))
  const L = vec3(normalize(vec3(-0.5, 0.6, 0.65)))
  const diff = clamp(dot(n, L), 0, 1)
  const spec = pow(clamp(2 * dot(n, L) * n.z - L.z, 0, 1), 24)
  const m = smoothstep(0.12, 0.32, v)
  const deep = vec3(mix(vec3(0.01, 0.03, 0.05), vec3(0.02, 0.06, 0.09), uv.y))
  const coral = vec3(mix(vec3(0.05, 0.42, 0.45), vec3(0.98, 0.66, 0.32), smoothstep(0.25, 0.42, v)))
  return vec4(vec3(mix(deep, coral * (0.35 + 0.75 * diff), m) + spec * m * 0.55), 1)
})

export default shader({ fps: 30, passes: [reef, sea] })
