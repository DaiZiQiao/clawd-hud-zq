import { BLANKET, CROWN, placed, thoughtFrames } from './mascot-sprites'
import type { Overlay } from './mascot-sprites'
import type { Cell, Grid, MascotRole } from './scene-types'

// Usagi (the rabbit from Chiikawa, fan art), the scene's other mascot, picked
// by the `character` option: the same 13 by 4 box as Clawd, the same looks
// (hooks/mascot-poses.ts), drawn by hooks/usagi-glyphs.ts. Clawd is written
// as glyph rows; Usagi as quarters, two a cell across and two down, laid
// into a bitmap and turned into cells (`cellsOf`), so its face can hold two
// colours in a cell: a cell whose four quarters are all drawn may be one
// colour on another (its glyph on a background), a cell with a quarter left
// empty is one colour.
//
// The figure is 18 quarters across (box columns 2 to 10) and 8 down (the air
// row to the legs row): its ears standing in the air row, its head's top on
// the head row, its eyes and then its cheeks and mouth on the torso row, its
// body and feet on the legs row. Pale yellow, the same for every agent: an
// agent's role is its hat (`ROLE_HATS`), the session's own wears the crown on
// the side of its head; no letter, no accessory.

/** Usagi's colours: its body, eyes, mouth and cheeks. */
export const USAGI = { body: '#F3DC8C', eye: '#2B211C', mouth: '#6B2D2A', blush: '#F2A0AE' } as const

/** A bitmap's quarter: `.` none, `#` the body, `K` an eye, `M` the mouth, `P` a cheek, else a hat's own keys. */
export type Palette = Readonly<Record<string, string>>

export const BODY_PALETTE: Palette = { '#': USAGI.body, K: USAGI.eye, M: USAGI.mouth, P: USAGI.blush }

/** The figure's quarters across and down. */
export const FIGURE_W = 18
export const FIGURE_H = 8

// --- the figure's parts, figure quarters (column 0 is box column 2's left half) ---

/** The ears, rows 0 to 2: standing; lowered, sitting or asleep; their tips trailing a walk; drooping, slumped. */
export const EARS = {
  up: ['....##......##....', '....##......##....', '....##......##....'],
  short: ['..................', '....##......##....', '....##......##....'],
  trailLeft: ['...##......##.....', '....##......##....', '....##......##....'],
  trailRight: ['.....##......##...', '....##......##....', '....##......##....'],
  droop: ['..................', '..................', '.####........####.'],
} as const

export type Ears = keyof typeof EARS

/** The head's top (row 3), the face's two rows (4, 5), the body (6) and the seat sitting (6, 7). */
export const TOP = '...############...'
export const FACE = '..##############..'
export const BASE = '...############...'
export const SEAT = ['..##############..', '.################.'] as const
/** Drooping ears' tips hang beside the head's top. */
export const DROOP_TOP = '#..############..#'

/** The eyes' columns by the head's look (row 4; `down` on row 5). */
export const EYES = {
  open: [5, 12],
  left: [4, 11],
  right: [6, 13],
  up: [5, 12],
  shut: [],
  spiral: [6, 11],
  spin: [4, 13],
  down: [5, 12],
  wide: [5, 6, 11, 12],
} as const satisfies Record<string, readonly number[]>

/**
 * The cheeks' columns (row 5), and the mouth's: small, or wide open, turned
 * with the eyes; never in a cell with an eye (a cell holds two colours).
 */
export const CHEEKS = [3, 14] as const
export const MOUTHS = {
  open: [8, 9],
  left: [7, 8],
  right: [9, 10],
  wide: [7, 8, 9, 10],
  wideLeft: [6, 7, 8, 9],
  wideRight: [8, 9, 10, 11],
} as const

/** The feet's columns (row 7) by the legs' look. */
export const FEET = {
  stand: [4, 13],
  step: [5, 13],
  pass: [5, 12],
  back: [4, 12],
  tuck: [5, 12],
  stretch: [4, 13],
  shuffleLeft: [3, 12],
  shuffleRight: [5, 14],
  none: [],
} as const satisfies Record<string, readonly number[]>

/** Arms, as quarters (row, column) beyond the head and body: hands up beside the face, the right arm out, the right shoulder up (its `?` hand is the ask overlay's). */
export const ARMS = {
  up: [[3, 0], [3, 17], [4, 0], [4, 1], [4, 16], [4, 17]],
  point: [[5, 16], [5, 17]],
  raised: [[4, 16], [4, 17]],
} as const satisfies Record<string, readonly (readonly [number, number])[]>

/** Knocked flat: its ears out flat either side, eyes on row 6, cheeks and mouth on row 7. */
export const FLAT = ['###.##########.###', '..##############..', '.################.'] as const

/** Under the blanket, rows 6 and 7, rising a little with each breath; its own colour. */
export const QUILT = [['..QQQQQQQQQQQQQQ..', '.QQQQQQQQQQQQQQQQ.'], ['.QQQQQQQQQQQQQQQQ.', '.QQQQQQQQQQQQQQQQ.']] as const
export const QUILT_PALETTE: Palette = { Q: BLANKET.colour }

// --- what it wears -----------------------------------------------------------------

/**
 * A hat, rows 0 to 3 over the figure (`.` lets the figure show): worn over the
 * head's top, its ears through the brim; its colours, each 3:1 or more on
 * #282a36 and #eff1f5. `floor`: its three cells knocked off beside it; `mini`:
 * its one cell between a mini's ears.
 */
export type Hat = { art: readonly string[]; palette: Palette; colour: string; floor: string; mini: string }

/** An agent's hat, by role: its job at a glance. */
export const HATS = {
  /** The worker's construction hat. */
  hardhat: {
    art: ['..................', '.......OOOO.......', '......OOOOOO......', '..OOOOOOOOOOOOOO..'],
    palette: { O: '#C8691C' },
    colour: '#C8691C',
    floor: '▗▄▖',
    mini: '▄',
  },
  /** The explorer's fedora: a dented crown, a dark band, a wide brim. */
  fedora: {
    art: ['..................', '......BB..BB......', '......DDDDDD......', '..BBBBBBBBBBBBBB..'],
    palette: { B: '#9A6A3A', D: '#5C3D1E' },
    colour: '#9A6A3A',
    floor: '▗▀▖',
    mini: '▄',
  },
  /** The reviewer's mortarboard: a wide flat board over its ears, its tassel's knot at the end. */
  mortarboard: {
    art: ['..................', '..NNNNNNNNNNNNNNG.', '......NNNNNN......', '..................'],
    palette: { N: '#4D79C4', G: CROWN.colour },
    colour: '#4D79C4',
    floor: '▀▀▀',
    mini: '▀',
  },
  /** The debugger's miner's helmet, its lamp lit: hunting bugs in the dark. */
  helmet: {
    art: ['..................', '.......AAAA.......', '......AALLAA......', '..AAAAAAAAAAAAAA..'],
    palette: { A: '#7A828C', L: '#FFE27A' },
    colour: '#7A828C',
    floor: '▗▄▖',
    mini: '▄',
  },
  /** The planner's top hat, with its band. */
  tophat: {
    art: ['......UUUUUU......', '......UUUUUU......', '......RRRRRR......', '..UUUUUUUUUUUUUU..'],
    palette: { U: '#9B5CB8', R: '#D05454' },
    colour: '#9B5CB8',
    floor: '▗█▖',
    mini: '█',
  },
  /** The frontend's beret: flat, tilted over its right ear, its little stalk on top. */
  beret: {
    art: ['........R.........', '.....RRRRRRRRR....', '......RRRRRRR.....', '..................'],
    palette: { R: '#D05454' },
    colour: '#D05454',
    floor: '▄▄▖',
    mini: '▄',
  },
} as const satisfies Record<string, Hat>

export type HatName = keyof typeof HATS

export const ROLE_HATS: Readonly<Record<MascotRole, HatName>> = {
  worker: 'hardhat',
  explorer: 'fedora',
  reviewer: 'mortarboard',
  debugger: 'helmet',
  planner: 'tophat',
  frontend: 'beret',
}

/** The session's crown, small, tilted on the left of its head (rows 2 and 3), in front of its ear. */
export const SIDE_CROWN = { art: ['G.G.G', 'GGGGG'], palette: { G: CROWN.colour }, floor: CROWN.art } as const

/** Flying: the propeller cap between its ears, its blade a row above; a bare head's in this colour. */
export const CAP = { art: ['......CCCCCC......'], colour: '#5C86B8' } as const

/** Every raw colour Usagi is drawn in: its own, its hats', the crown's, the cap's, the blanket's. */
export const USAGI_COLOURS: readonly string[] = [
  ...new Set([...Object.values(USAGI), ...Object.values(HATS).flatMap(hat => Object.values(hat.palette)), ...Object.values(SIDE_CROWN.palette), CAP.colour, BLANKET.colour]),
]

// --- the mini ------------------------------------------------------------------------

/** The mini (a child), 10 quarters across, rows 1 to 3 of its 5 by 4: thin ears, its head and eyes, its body and feet. */
export const MINI_W = 10
export const MINI_EARS = '...#..#...'
export const MINI_HEAD = '.########.'
export const MINI_EYES = { open: [2, 7], left: [1, 6], right: [3, 8], shut: [] } as const satisfies Record<string, readonly number[]>
export const MINI_BODY = '..######..'
export const MINI_FEET = { stand: [2, 7], step: [3, 7], tap: [2, 6], none: [] } as const satisfies Record<string, readonly number[]>
/** Slumped or down: on the floor, ears short, eyes shut. */
export const MINI_SAT = ['..........', '..........', '...#..#...', '..######..', '.########.', '.########.'] as const

// --- what it says --------------------------------------------------------------------

/** Usagi barely talks: its thoughts are its shouts and its lines (`HUHHH?`, `UNA!`), one per spell as Clawd's phrases are. */
export const USAGI_THOUGHTS = ['Ura!', 'Yaha!', 'HUHHH?', 'UNA!', 'Puruya', 'Haa?', 'Fuun', 'Yahaa!', 'Uraa!', 'HUHHH?!', 'UNA UNA', 'Yaha ha', 'Puruu', 'Ura ura', 'Puru…'] as const

export const USAGI_THOUGHT_FRAMES: readonly (readonly Overlay[])[] = thoughtFrames(USAGI_THOUGHTS)

/** A line shouted over its head; a row lower, beside its ears, with no sky row free. */
const shout = (line: string): Overlay => ({ art: placed([-1, 11, line]), ink: 'f' })

/** Instead of the cigarette: on each of the puff bit's three puffs, hands up and mouth wide, a shout in turn. */
export const SHOUTS: readonly Overlay[] = ['Ura!', 'HUHHH?', 'UNA!'].map(shout)

/** Up again after a fall, crouched, dazed. */
export const DAZED: Overlay = shout('HUHHH?')

/**
 * Failed, slumped: the cross over its head (its head stays up, so in the sky
 * row); with no sky row free, a row lower beside its ears (its `lowArt` is
 * laid as the sky row's, then lowered).
 */
export const CROSS: Overlay = { art: placed([-1, 6, '✗']), lowArt: placed([-1, 11, '✗']), ink: 'r' }

/** What Usagi says or shows over its head: a row lower with no sky row free. */
export const USAGI_LINES: readonly Overlay[] = [...SHOUTS, DAZED, CROSS]

// --- quarters to cells ---------------------------------------------------------------

/** A cell's glyph by its quarters drawn: top-left 1, top-right 2, bottom-left 4, bottom-right 8. */
const GLYPHS = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'] as const

/**
 * A bitmap's cells: each cell's four quarters as its glyph in its colour; two
 * colours in a cell whose quarters are all drawn as a glyph on a background
 * (the body the background where it is one); a cell with a quarter empty and
 * two colours keeps the one that is not the body (a hat over an ear). The
 * body's cells are inked as the mascot's own (`b`), the rest in their own
 * colour (`k`).
 */
export const cellsOf = (bitmap: readonly string[], palette: Palette): Grid => {
  const rows = Math.ceil(bitmap.length / 2)
  const columns = Math.ceil(Math.max(0, ...bitmap.map(row => row.length)) / 2)
  const quarter = (x: number, y: number): string => bitmap[y]?.[x] ?? '.'

  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column): Cell | undefined => {
    const keys = [quarter(column * 2, row * 2), quarter(column * 2 + 1, row * 2), quarter(column * 2, row * 2 + 1), quarter(column * 2 + 1, row * 2 + 1)]
    const drawn = [...new Set(keys.filter(key => key !== '.' && palette[key] !== undefined))]
    if (drawn.length === 0) return undefined
    const maskOf = (key: string): number => keys.reduce((mask, one, bit) => (one === key ? mask | (1 << bit) : mask), 0)
    const full = keys.every(key => key !== '.' && palette[key] !== undefined)
    const ground = full && drawn.length === 2 ? (drawn.includes('#') ? '#' : drawn[0]) : undefined
    const ink = ground === undefined ? (drawn.length === 1 ? drawn[0] : drawn.find(key => key !== '#')) : drawn.find(key => key !== ground)
    const fg = ink ?? '#'
    const colour = palette[fg] ?? USAGI.body
    const cell: Cell = { ch: GLYPHS[maskOf(fg)] ?? '█', ink: fg === '#' ? 'b' : 'k', colour }

    return ground === undefined ? cell : { ...cell, ink: 'k', bg: palette[ground] ?? USAGI.body }
  }))
}

/**
 * Where a bitmap asks more of a cell than it can draw: three colours, or two
 * with a quarter empty (a glyph has one colour and the background shows
 * through the rest), as `row:column` (Usagi's tables never do).
 */
export const clashesOf = (bitmap: readonly string[], palette: Palette): string[] => {
  const clashes: string[] = []
  for (let row = 0; row * 2 < bitmap.length; row += 1) {
    const width = Math.max(bitmap[row * 2]?.length ?? 0, bitmap[row * 2 + 1]?.length ?? 0)
    for (let column = 0; column * 2 < width; column += 1) {
      const keys = [0, 1].flatMap(dy => [0, 1].map(dx => bitmap[row * 2 + dy]?.[column * 2 + dx] ?? '.'))
      const drawn = new Set(keys.filter(key => key !== '.' && palette[key] !== undefined))
      if (drawn.size > 2 || (drawn.size === 2 && keys.some(key => key === '.' || palette[key] === undefined))) clashes.push(`${row}:${column}`)
    }
  }

  return clashes
}

/** A bitmap with another laid over it from (x, y): its `.` let what is under show. */
export const laid = (under: readonly string[], over: readonly string[], x = 0, y = 0): string[] =>
  under.map((row, at) => {
    const top = over[at - y]
    if (top === undefined) return row

    return [...row].map((key, column) => {
      const mine = top[column - x]

      return mine === undefined || mine === '.' ? key : mine
    }).join('')
  })

/** A row with `key` at each of `columns`. */
export const marked = (row: string, columns: readonly number[], key: string): string =>
  [...row].map((one, column) => (columns.includes(column) ? key : one)).join('')
