// Aurora: curtains of light over a starry sky. The pointer bends the curtains
// near it and brightens them; a press sends a soft shimmer out from it.
import { Buffer, buffer, clamp, dot, exp, first, floor, fract, length, max, mix, picture, pointer, pointerCount, pointers, pow, shader, sin, size, smoothstep, step, time, vec2, vec3, vec4 } from 'claude-code/shader'

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

// Where and when the last press began: x, y, time, and whether it is still down.
const press: Buffer = buffer({ size: [1, 1], float: 32, filter: 'nearest' }, () => {
  const was = press.at(vec2(0, 0))
  const down = pointerCount > 0 ? pointer(0).down : 0
  const fresh = down > 0.5 && was.w < 0.5
  return first ? vec4(0, 0, -100, 0) : fresh ? vec4(pointer(0).where.x, pointer(0).where.y, time, 1) : vec4(was.x, was.y, was.z, down)
})

const sky = picture(px => {
  const uv = px.uv
  const asp = size.x / max(size.y, 1)
  const p = vec2(uv.x * asp, uv.y)
  let col = vec3(mix(vec3(0.012, 0.03, 0.06), vec3(0.004, 0.008, 0.025), uv.y))

  // stars, twinkling
  const h = hash(vec2(floor(vec2(p * 140)) + 1000))
  const tw = 0.55 + 0.45 * sin(time * (1.5 + h * 3) + h * 60)
  col = vec3(col + vec3(0.75, 0.82, 1) * (step(0.993, h) * tw * smoothstep(0.5, 0, length(vec2(fract(vec2(p * 140)) - 0.5))) * 0.9))

  // the pointer's pull on the curtains
  let near = 0
  let bend = 0
  for (const q of pointers) {
    const here = clamp(1 - q.gone * 1.5, 0, 1)
    const w = exp(-pow((p.x - q.where.x * asp) / 0.28, 2)) * here
    near = max(near, w)
    bend += w * (q.where.y - 0.62) * 0.35
  }

  for (let i = 0; i < 4; i++) {
    const x = p.x * (1.1 + i * 0.25) + i * 3.7
    const base = 0.5 + 0.28 * (fbm(vec2(x * 0.7, time * 0.045 + i * 1.3), 4) - 0.5) + bend + i * 0.05
    const dy = uv.y - base
    const curtain = smoothstep(-0.012, 0.004, dy) * exp(-max(dy, 0) * (5 + i * 1.6))
    const rays = 0.45 + 0.55 * fbm(vec2(x * 14 + time * 0.12, time * 0.25 + i * 5), 3)
    const c = vec3(mix(vec3(0.15, 1, 0.6), vec3(0.55, 0.25, 1), clamp(dy * 3.2 + i * 0.12, 0, 1)))
    col = vec3(col + c * (curtain * rays * (0.5 - i * 0.08) * (1 + near * 0.9)))
  }

  // a shimmer from the last press
  const last = press.at(vec2(0, 0))
  const age = time - last.z
  const fade = pow(clamp(1 - age / 2.5, 0, 1), 2)
  const d = length(vec2(p - vec2(last.x * asp, last.y)))
  const sparkle = 0.6 + 0.4 * noise(vec2(p * 60 + time * 4))
  col = vec3(col + vec3(0.45, 1, 0.8) * (exp(-pow((d - age * 0.3) / 0.05, 2)) * fade * 0.35 * sparkle))
  col = vec3(col + vec3(0.3, 0.9, 0.7) * (exp(-d * d / 0.006) * fade * 0.45))

  // the far mountains
  const m = 0.11 + 0.07 * fbm(vec2(p.x * 2.2, 4), 4)
  col = vec3(mix(col, vec3(0.003, 0.006, 0.012), smoothstep(m + 0.004, m - 0.002, uv.y)))
  return vec4(col, 1)
})

export default shader({ fps: 30, passes: [press, sky] })
