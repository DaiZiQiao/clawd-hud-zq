// Text measured in terminal cells, as the pane lays it out: CJK and emoji
// two cells, combining marks none, everything else one. The HUD
// (hooks/hud.tsx), the rows in pixels (hooks/text-svg.ts), the lists and the
// inspect view cut and pad their text with these.

const isZeroWidth = (cp: number): boolean =>
  (cp >= 0x0300 && cp <= 0x036f)
  || (cp >= 0x200b && cp <= 0x200f)
  || (cp >= 0x20d0 && cp <= 0x20ff)
  || (cp >= 0xfe00 && cp <= 0xfe0f)

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f)
  || (cp >= 0x2e80 && cp <= 0x303e)
  || (cp >= 0x3041 && cp <= 0x33ff)
  || (cp >= 0x3400 && cp <= 0x4dbf)
  || (cp >= 0x4e00 && cp <= 0x9fff)
  || (cp >= 0xa000 && cp <= 0xa4cf)
  || (cp >= 0xac00 && cp <= 0xd7a3)
  || (cp >= 0xf900 && cp <= 0xfaff)
  || (cp >= 0xfe30 && cp <= 0xfe4f)
  || (cp >= 0xff00 && cp <= 0xff60)
  || (cp >= 0xffe0 && cp <= 0xffe6)
  || (cp >= 0x1f300 && cp <= 0x1f64f)
  || (cp >= 0x1f680 && cp <= 0x1f6ff)
  || (cp >= 0x1f900 && cp <= 0x1f9ff)
  || (cp >= 0x20000 && cp <= 0x3fffd)

const cellsOf = (char: string): number => {
  const cp = char.codePointAt(0) ?? 0

  return isZeroWidth(cp) ? 0 : isWide(cp) ? 2 : 1
}

/** Terminal cells the text takes: CJK and emoji two, combining marks none. */
export const displayWidth = (text: string): number => {
  let width = 0
  for (const char of text) width += cellsOf(char)

  return width
}

/** The text cut to `width` cells, ending in `…` when cut. */
export const truncate = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (displayWidth(text) <= width) return text
  let kept = ''
  let used = 0
  for (const char of text) {
    const cells = cellsOf(char)
    if (used + cells > width - 1) break
    kept += char
    used += cells
  }

  return `${kept.trimEnd()}…`
}

export const truncateStart = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (displayWidth(text) <= width) return text
  const chars = [...text]
  let kept = ''
  let used = 0
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index] ?? ''
    const cells = cellsOf(char)
    if (used + cells > width - 1) break
    kept = char + kept
    used += cells
  }

  return `…${kept.trimStart()}`
}

export const padStart = (text: string, width: number): string => ' '.repeat(Math.max(0, width - displayWidth(text))) + text

export const padEnd = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - displayWidth(text)))
