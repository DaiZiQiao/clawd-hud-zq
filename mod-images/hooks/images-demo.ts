import type { Master } from './image-types'

// Three sample pictures for `/mod-images test`, drawn in code so the sample
// strip needs no file and no decoder: a hue ramp (light to dark, every hue
// the cells can show), a checker with transparent squares (the terminal's own
// background through the gaps), and a dark editor-like screenshot with a
// light dialog over it (what most pastes are). Deterministic; each within 256
// pixels a side, as a decoded master is.

// A module constant: the hooks environment looks a global up afresh at every use.
const { abs, floor, imul, max, min, round } = Math

const RAMP = { width: 256, height: 144 }
const CHECKER = { width: 192, height: 192, square: 24 }
const EDITOR = { width: 256, height: 160 }

/** Writes one opaque pixel, `0xRRGGBB`, at pixel index `at`. */
const put = (rgba: Uint8Array, at: number, colour: number): void => {
  rgba[at * 4] = (colour >> 16) & 0xff
  rgba[at * 4 + 1] = (colour >> 8) & 0xff
  rgba[at * 4 + 2] = colour & 0xff
  rgba[at * 4 + 3] = 255
}

// Hue (degrees), saturation and lightness (0..1) to `0xRRGGBB`.
const hslOf = (hue: number, saturation: number, lightness: number): number => {
  const chroma = (1 - abs(2 * lightness - 1)) * saturation
  const part = chroma * (1 - abs(((hue / 60) % 2) - 1))
  const base = lightness - chroma / 2
  const sector = floor(hue / 60) % 6
  const red = sector === 0 || sector === 5 ? chroma : sector === 1 || sector === 4 ? part : 0
  const green = sector === 1 || sector === 2 ? chroma : sector === 0 || sector === 3 ? part : 0
  const blue = sector === 3 || sector === 4 ? chroma : sector === 2 || sector === 5 ? part : 0

  return (round((red + base) * 255) << 16) | (round((green + base) * 255) << 8) | round((blue + base) * 255)
}

/** Left to right every hue at full saturation; top to bottom from light to dark. */
const rampOf = (): Master => {
  const { width, height } = RAMP
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const lightness = 0.78 - (0.56 * y) / (height - 1)
    for (let x = 0; x < width; x += 1) put(rgba, y * width + x, hslOf((x * 360) / width, 1, lightness))
  }

  return { width, height, rgba }
}

/** Opaque squares warming from teal to coral, every other one left transparent. */
const checkerOf = (): Master => {
  const { width, height, square } = CHECKER
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const across = floor(x / square)
      const down = floor(y / square)
      if ((across + down) % 2 === 1) continue
      const t = (across + down) / 14
      put(rgba, y * width + x, (round(64 + 153 * t) << 16) | (round(176 - 57 * t) << 8) | round(170 - 83 * t))
    }
  }

  return { width, height, rgba }
}

/** A dark code editor: title bar, side bar, tabs, syntax-coloured lines, a blue status bar, and a light `save changes?` dialog with a shadow. */
const editorOf = (): Master => {
  const { width, height } = EDITOR
  const rgba = new Uint8Array(width * height * 4)
  const fill = (left: number, top: number, wide: number, tall: number, colour: number): void => {
    for (let y = max(0, top); y < min(height, top + tall); y += 1) {
      for (let x = max(0, left); x < min(width, left + wide); x += 1) put(rgba, y * width + x, colour)
    }
  }
  // The same lines every time: a fixed-seed linear congruential generator.
  let seed = 0x2545f491
  const next = (below: number): number => {
    seed = (imul(seed, 1664525) + 1013904223) >>> 0

    return seed % below
  }
  const syntax = [0x569cd6, 0xce9178, 0xdcdcaa, 0x9cdcfe, 0x6a9955, 0x4ec9b0, 0xc586c0]
  fill(0, 0, width, height, 0x1e1e1e)
  fill(0, 0, width, 10, 0x323233)
  fill(5, 4, 3, 3, 0xff5f57)
  fill(11, 4, 3, 3, 0xfebc2e)
  fill(17, 4, 3, 3, 0x28c840)
  fill(0, 10, 12, 142, 0x333333)
  fill(12, 10, 52, 142, 0x252526)
  fill(12, 39, 52, 7, 0x37373d)
  for (let row = 0; row < 15; row += 1) fill(row % 4 === 0 ? 17 : 23, 16 + row * 8, 14 + next(22), 3, row === 3 ? 0xe0e0e0 : 0x9d9d9d)
  fill(64, 10, width - 64, 12, 0x252526)
  fill(64, 10, 56, 12, 0x1e1e1e)
  fill(121, 10, 54, 12, 0x2d2d2d)
  for (let line = 0; line < 20; line += 1) {
    const top = 26 + line * 6
    fill(66, top, 5, 3, 0x858585)
    let left = 78 + next(4) * 8
    for (let token = 2 + next(4); token > 0 && left < 236; token -= 1) {
      const wide = min(6 + next(21), 240 - left)
      fill(left, top, wide, 3, syntax[next(syntax.length)] ?? 0xd4d4d4)
      left += wide + 4
    }
  }
  fill(248, 22, 8, 130, 0x2a2a2a)
  fill(0, 152, width, 8, 0x007acc)
  fill(6, 154, 30, 4, 0xd8ecfa)
  fill(73, 49, 120, 60, 0x0c0c0c)
  fill(69, 45, 122, 62, 0xc8c8c8)
  fill(70, 46, 120, 60, 0xf3f3f3)
  fill(70, 46, 120, 12, 0xdddddd)
  fill(78, 64, 80, 4, 0x333333)
  fill(78, 71, 96, 4, 0x333333)
  fill(78, 78, 60, 4, 0x6b6b6b)
  fill(96, 90, 40, 10, 0xc8c8c8)
  fill(141, 90, 42, 10, 0x0e639c)
  fill(152, 94, 20, 2, 0xffffff)

  return { width, height, rgba }
}

/** Three sample masters for `/mod-images test`: a hue ramp (16:9), a checker with transparent squares (1:1), and a dark editor-like screenshot with a light dialog (16:10). Deterministic, and new arrays each call. */
export const demoMastersOf = (): readonly Master[] => [rampOf(), checkerOf(), editorOf()]
