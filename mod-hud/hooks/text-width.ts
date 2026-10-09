// Text measured in terminal cells, as the pane lays it out (and as Ink's
// string-width counts): cluster by cluster, a character and what is drawn
// with it. CJK and emoji two cells, a lone mark or joiner none, everything
// else one. The HUD (hooks/hud.tsx), the rows in pixels (hooks/text-svg.ts),
// the lists and the inspect view cut and pad their text with these, never
// inside a cluster.

/** A character and what is drawn with it (marks, joiners, a skin tone, the rest of a ZWJ sequence or flag), in its cells. */
type Cluster = { text: string; cells: number }

/** A character as the clusters see it: drawn on the one before, an emoji as it stands, a pictograph, made an emoji by U+FE0F. */
type Kind = { joining: boolean; presented: boolean; pictograph: boolean; emojiBase: boolean }

const ZWJ = 0x200d
const VS16 = 0xfe0f

// Drawn on the character before, in no cell of its own: combining marks,
// format characters (joiners, the soft hyphen, tags) and variation selectors.
const JOINING = /[\p{Mn}\p{Me}\p{Cf}]/u
const PRESENTED = /\p{Emoji_Presentation}/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u
// What U+FE0F turns into an emoji: a pictograph, or a keycap's base.
const EMOJI_BASE = /[#*0-9\p{Extended_Pictographic}]/u

// Each character's kind, worked out the first time it is met.
const KINDS = new Map<number, Kind>()

const kindOf = (cp: number): Kind => {
  const known = KINDS.get(cp)
  if (known !== undefined) return known
  const char = String.fromCodePoint(cp)
  const kind = { joining: JOINING.test(char), presented: PRESENTED.test(char), pictograph: PICTOGRAPH.test(char), emojiBase: EMOJI_BASE.test(char) }
  KINDS.set(cp, kind)

  return kind
}

// Latin, punctuation, arrows, maths, box drawing, blocks and shapes: one cell
// each, and none drawn on the character before.
const isNarrow = (cp: number): boolean =>
  (cp < 0x300 && cp !== 0xad)
  || (cp >= 0x2010 && cp <= 0x2027)
  || (cp >= 0x2030 && cp <= 0x205f)
  || (cp >= 0x2190 && cp <= 0x22ff)
  || (cp >= 0x2500 && cp <= 0x25fc)

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
  || (cp >= 0x1f200 && cp <= 0x1f2ff)
  || (cp >= 0x20000 && cp <= 0x3fffd)

const isRegional = (cp: number): boolean => cp >= 0x1f1e6 && cp <= 0x1f1ff

const isModifier = (cp: number): boolean => cp >= 0x1f3fb && cp <= 0x1f3ff

const isJoining = (cp: number): boolean => !isNarrow(cp) && kindOf(cp).joining

// A cluster's cells from the character it begins with: a lone mark or joiner
// (only ever first in the text) none; CJK and emoji two, a regional indicator
// one until it pairs; everything else one.
const ownCells = (cp: number, first: boolean): number => {
  if (isNarrow(cp)) return 1
  if (first && isJoining(cp)) return 0

  return isWide(cp) || (!isRegional(cp) && kindOf(cp).presented) ? 2 : 1
}

/**
 * The cells a cluster takes with `cp` drawn in it after `prior`, or undefined
 * when `cp` begins a cluster of its own; the cluster begins with `base`, is
 * that `alone` until something joins it, and takes `cells` so far. A mark or
 * joiner joins anything, U+FE0F making an emoji of a pictograph; a skin tone
 * joins the pictograph before it; a pictograph after a ZWJ joins its
 * sequence; a second regional indicator makes a flag.
 */
const joined = (base: number, alone: boolean, cells: number, prior: number, cp: number): number | undefined => {
  if (isJoining(cp)) return cp === VS16 && kindOf(base).emojiBase ? 2 : cells
  if (isModifier(cp) && kindOf(prior).pictograph) return cells
  if (prior === ZWJ && kindOf(base).pictograph && kindOf(cp).pictograph) return Math.max(cells, ownCells(cp, false))
  if (isRegional(cp) && alone && isRegional(base)) return 2

  return undefined
}

/** Hands `visit` where each of the text's clusters ends, in turn, and its cells. */
const eachCluster = (text: string, visit: (end: number, cells: number) => void): void => {
  let base = 0
  let alone = false
  let cells = 0
  let prior = -1
  let at = 0
  while (at < text.length) {
    const cp = text.codePointAt(at) ?? 0
    // A narrow character joins nothing but a ZWJ sequence: no need to ask.
    const grown = prior < 0 || (isNarrow(cp) && prior !== ZWJ) ? undefined : joined(base, alone, cells, prior, cp)
    if (grown === undefined) {
      if (prior >= 0) visit(at, cells)
      base = cp
      alone = true
      cells = ownCells(cp, prior < 0)
    } else {
      alone = false
      cells = grown
    }
    prior = cp
    at += cp > 0xffff ? 2 : 1
  }
  if (prior >= 0) visit(at, cells)
}

const clustersOf = (text: string): Cluster[] => {
  const clusters: Cluster[] = []
  let start = 0
  eachCluster(text, (end, cells) => {
    clusters.push({ text: text.slice(start, end), cells })
    start = end
  })

  return clusters
}

/** The leading clusters that fit in `cells`, blanks at the cut dropped. */
const fitting = (clusters: readonly Cluster[], cells: number): string[] => {
  const kept: string[] = []
  let used = 0
  for (const cluster of clusters) {
    if (used + cluster.cells > cells) break
    kept.push(cluster.text)
    used += cluster.cells
  }
  while (kept.at(-1)?.trim() === '') kept.pop()

  return kept
}

/**
 * Text from the world (a task description, an answer's first line) as one
 * line of printable text: a terminal's colour and cursor sequences dropped,
 * each run of other control characters a blank. A `Text` holding an escape
 * sequence is refused, and the whole tree with it.
 */
export const printable = (text: string | undefined): string =>
  (text ?? '')
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()

/** Terminal cells the text takes: CJK and emoji two, a lone mark or joiner none. */
export const displayWidth = (text: string): number => {
  let narrow = 0
  while (narrow < text.length && isNarrow(text.charCodeAt(narrow))) narrow += 1
  if (narrow === text.length) return narrow
  let width = 0
  eachCluster(text, (_, cells) => {
    width += cells
  })

  return width
}

/** The text cut to `width` cells, ending in `…` when cut. */
export const truncate = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (displayWidth(text) <= width) return text

  return `${fitting(clustersOf(text), width - 1).join('')}…`
}

export const truncateStart = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (displayWidth(text) <= width) return text

  return `…${fitting(clustersOf(text).reverse(), width - 1).reverse().join('')}`
}

export const padStart = (text: string, width: number): string => ' '.repeat(Math.max(0, width - displayWidth(text))) + text

export const padEnd = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - displayWidth(text)))

/** A clock's two digits: `7` as `07`. */
export const pad2 = (n: number): string => String(n).padStart(2, '0')
