// Lava lamp: glossy wax blobs drift, merge and split in warm light. Each
// pointer is a blob of its own, so one follows your finger or mouse.
import { clamp, dot, exp, fract, max, mix, normalize, picture, pointers, pow, shader, sin, size, smoothstep, time, vec2, vec3, vec4 } from 'claude-code/shader'

const hash = (q: vec2) => fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453)

const field = (p: vec2, asp: number) => {
  const shrink = 0.55 + 0.45 * clamp(asp, 0, 1)
  let s = 0
  for (let i = 0; i < 9; i++) {
    const c = vec2((0.5 + 0.38 * sin(time * (0.07 + i * 0.013) + i * 1.9)) * asp, 0.5 + 0.42 * sin(time * (0.05 + i * 0.011) + i * 2.7))
    const r = (0.07 + 0.05 * hash(vec2(i, 2))) * shrink
    const d = vec2(p - c)
    s += (r * r) / max(dot(d, d), 0.0001)
  }
  for (const q of pointers) {
    const here = clamp(1 - q.gone * 2, 0, 1)
    const d = vec2(p - vec2(q.where.x * asp, q.where.y))
    const r = 0.085 * shrink
    s += here * (r * r) / max(dot(d, d), 0.0001)
  }
  return s
}
// a smooth height that rises toward each blob's heart and never spikes
const height = (p: vec2, asp: number) => 1 - exp(-0.55 * max(field(p, asp) - 0.85, 0))

const lamp = picture(px => {
  const uv = px.uv
  const asp = size.x / max(size.y, 1)
  const p = vec2(uv.x * asp, uv.y)
  const f = field(p, asp)
  const h = 1 - exp(-0.55 * max(f - 0.85, 0))
  const e = 0.004
  const g = vec2(height(vec2(p + vec2(e, 0)), asp) - height(vec2(p - vec2(e, 0)), asp), height(vec2(p + vec2(0, e)), asp) - height(vec2(p - vec2(0, e)), asp))
  const n = vec3(normalize(vec3(g.x * (-0.09 / (2 * e)), g.y * (-0.09 / (2 * e)), 1)))
  const L = vec3(normalize(vec3(-0.45, 0.55, 0.7)))
  const diff = clamp(dot(n, L), 0, 1)
  // reflect(-L, n) seen from straight above: its z
  const rz = 2 * dot(n, L) * n.z - L.z
  const spec = pow(clamp(rz, 0, 1), 22)
  const bg = vec3(mix(vec3(0.06, 0.01, 0.07), vec3(0.16, 0.03, 0.12), uv.y))
  const inside = smoothstep(0.92, 1.06, f)
  const wax = vec3(mix(vec3(0.85, 0.16, 0.08), vec3(1, 0.62, 0.22), h))
  const blob = vec3(wax * (0.55 + 0.6 * diff) + vec3(1, 0.85, 0.65) * (spec * 0.5) + wax * ((1 - n.z) * 0.6))
  const glow = vec3(bg + vec3(0.9, 0.25, 0.3) * (smoothstep(0.35, 1, f) * 0.25))
  return vec4(mix(glow, blob, inside), 1)
})

export default shader({ fps: 30, passes: [lamp] })
