// The mascot scene's frame tables: the figure, its poses, the accessories,
// the crown, the beside items and the laptop as text, one terminal cell per
// glyph. hooks/mascot-poses.ts and hooks/mascot-glyphs.ts compose them;
// docs/mascots.md shows each look as `spriteSheet()` (hooks/mascot-sheet.ts)
// prints it.
//
// Every full mascot is drawn in a box 13 cells wide and 4 rows tall: row 0 the
// air row (its role letter or crown centred, its hat at one end, its energy at
// the other), row 1 its head, row 2 its torso, row 3 its legs; columns 2 to 10 the figure, 0 and 1 its left side, 11 and 12 its right
// side. Its slot is 17 cells: the box and four more, where an agent's laptop
// stands while a tool runs (its deck reaching back to column 11) and where a
// thought's biggest bubble floats. One more row, the sky row above the box,
// takes the thought's phrase bubble, the `Z` and the flying cap's propeller where the
// pane has a row to spare. A child is a mini of 5 by 4.
//
// The figure is drawn only from the body tables, in its own colour: no foreign
// cell on its head, torso or legs, and nothing breaks its head's outline: the
// eyes only move, widen, cross or close as notches in its lower half. Everything else (the letter, the hat,
// the energy, the thought, the laptop, the blanket, the cigarette) has a
// colour of its own and a fixed place off the figure.

/**
 * What a cell is drawn in: `b` the mascot's own colour, `f` the terminal's
 * foreground, `d` dim, `a` the accent, `g` success, `y` warning, `r` error,
 * `p` the accented question, `i` the warning-coloured drop, `k` a raw colour
 * of the cell's own (an accessory, the crown, the laptop, the blanket).
 */
export type Ink = 'b' | 'f' | 'd' | 'a' | 'g' | 'y' | 'r' | 'p' | 'i' | 'k'

/**
 * A mark or item laid on a mascot's grid: its rows (a space lets what is under
 * it show through), the ink of every glyph and the glyphs inked otherwise, and
 * for `k` its raw colour.
 */
export type Overlay = { art: readonly string[]; lowArt?: readonly string[]; ink: Ink; by?: Readonly<Partial<Record<string, Ink>>>; colour?: string }

// --- the box -------------------------------------------------------------------

/** A full mascot's box: its left side, the figure, its right side. */
export const BOX = 13
/** A full mascot's slot: its box and the four cells its laptop or its biggest thought takes. */
export const SLOT = 17
/** The box's rows: air, head, torso, legs. */
export const BOX_ROWS = 4
/** Rows of sky drawn above the box: the thought's phrase bubble, the `Z`, the propeller. */
export const SKY = 1
/** A full mascot's grid: the sky row and the box. */
export const GRID_ROWS = SKY + BOX_ROWS
/** The figure's columns in the box: 9 cells from column 2. */
export const BODY_X = 2
export const BODY_WIDTH = 9
/** Over the head's centre (box column 6): the role letter, or the session's crown around it. */
export const LETTER_X = BODY_X + 4
/** Where a hat's three cells start on the air row: an agent's on the head's left or right corner, the crown centred. */
export const HAT_X = { left: 3, centre: 5, right: 7 } as const
export type HatSide = keyof typeof HAT_X
/** A mini's cells across. */
export const MINI = 5

// --- the figure ------------------------------------------------------------------

/**
 * The head row (9 cells, box columns 2 to 10), by its eyes: as Claude Code
 * draws Clawd, the eyes are notches in the lower half of the head, and every
 * look keeps the head's outline whole: the eyes only move, widen or close.
 */
export const HEADS = {
  open: ' ▐▛███▜▌ ',
  left: ' ▐▜██▛█▌ ',
  right: ' ▐█▜██▛▌ ',
  /** Eyes up (at a thought, or a message going over): the head's top is its outline, so it looks on ahead. */
  up: ' ▐▛███▜▌ ',
  /** Shut: no eyes, the head whole (a blink, asleep, a stretch). */
  shut: ' ▐█████▌ ',
  /** Dizzy: the eyes cross, then roll apart, a frame each. */
  spiral: ' ▐█▜█▛█▌ ',
  spin: ' ▐▜███▛▌ ',
  /** Eyes down: scanning the floor in flight (the smooth scene). */
  down: ' ▐▀███▀▌ ',
  /** Eyes wide: held up by the pointer, or thrown (the smooth scene). */
  wide: ' ▐▀███▀▌ ',
} as const

/** A row turned upside down: each quadrant glyph's top and bottom swapped. */
const FLIPPED: Readonly<Record<string, string>> = { '▛': '▙', '▙': '▛', '▜': '▟', '▟': '▜', '▀': '▄', '▄': '▀', '▘': '▖', '▖': '▘', '▝': '▗', '▗': '▝' }

export const flipped = (row: string): string => [...row].map(glyph => FLIPPED[glyph] ?? glyph).join('')

export type Head = keyof typeof HEADS

/** The torso row (9 cells), by its arms. */
export const TORSOS = {
  rest: '▝▜█████▛▘',
  /** Arms down: a breath out, sitting, a landing. */
  low: '▗▜█████▛▖',
  /** Arms up: the shoulders as at rest, the arms going on up beside the head (`ARMS_UP`). */
  up: '▝▜█████▛▘',
  /** The right arm raised beside the head with its `?` (`OVERLAYS.ask`): the shoulder as at rest. */
  raised: '▝▜█████▛▘',
  /** The right arm out: pointing, or reaching for the keys. */
  point: '▝▜█████▛▀',
} as const

export type Arms = keyof typeof TORSOS

/** The legs row (9 cells). */
export const LEGS = {
  stand: '  ▘▘ ▝▝  ',
  /** The walk: four frames, the feet passing each other. */
  step: '  ▝▝ ▘▘  ',
  pass: '  ▘▝ ▘▝  ',
  back: '  ▝▘ ▝▘  ',
  /** Drawn up at a hop's apex and in flight. */
  tuck: '  ▝▘ ▝▘  ',
  /** Long, at a hop's take-off. */
  stretch: '  ▐▌ ▐▌  ',
  /** The cheer's shuffle: both feet left, then right. */
  shuffleLeft: '  ▘▘ ▘▘  ',
  shuffleRight: '  ▝▝ ▝▝  ',
  none: '         ',
} as const

export type Legs = keyof typeof LEGS

/** The walk's legs, frame by frame. */
export const WALK_LEGS: readonly Legs[] = ['stand', 'step', 'pass', 'back']

/** Both arms up from the shoulders, a stub beside each side of the head: cells in the box (row, column), in the mascot's colour. */
export const ARMS_UP: readonly (readonly [number, number, string])[] = [[1, 2, '▐'], [1, 10, '▌']]

/** Walking, the torso a half cell the way it goes (its arms with it), head and feet where they are. */
export const LEANING = { left: '▀██████▀ ', right: ' ▀██████▀' } as const

/** Squashed on a hop's take-off and landing: a row shorter and wider, eyes kept, the arms out, its feet under it. Drawn on rows 2 and 3. */
export const SQUASHED = [' █▛███▜█ ', '▀▀▛▛▀▜▜▀▀'] as const

/** Knocked flat on its back: legs in the air (row 1), the body upside down (2), the head on the floor (3). */
export const FLAT = { legs: '  ▖▖ ▗▗  ', body: '▗▟█████▙▖' } as const

/** Getting up: crouched a row lower, hands planted on the floor. */
export const CROUCHED = '▄▟█████▙▄'

/** Asleep under the blanket: the quilt over its torso, rising a little with each breath, the hem on the floor. */
export const BLANKET = { colour: '#5C86B8', quilt: ['▗███████▖', '▟███████▙'], hem: '▝▀▀▀▀▀▀▀▘' } as const

// --- what an agent wears -----------------------------------------------------------

/** The session's crown, three points on a band, in a fixed gold that reads on dark and light (3.88:1 and 3.24:1). */
export const CROWN = { art: '▙█▟', colour: '#A6801F' } as const

/**
 * An agent's accessory: its three cells at one end of the air row (a mini
 * wears the two cells, centred), and its own colour, each 3:1 or more on
 * #282a36 and #eff1f5.
 */
export const ACCESSORIES = {
  beanie: { art: '▗▄▖', mini: '▗▖', colour: '#D05454' },
  cap: { art: '▄▄▖', mini: '▄▖', colour: '#38905A' },
  tophat: { art: '▗█▖', mini: '▗█', colour: '#9B5CB8' },
  flower: { art: ' ✿ ', mini: '✿ ', colour: '#BD55B8' },
  bow: { art: ' ⋈ ', mini: '⋈ ', colour: '#CF6248' },
  halo: { art: '◜◠◝', mini: '◠ ', colour: '#9E7F45' },
  note: { art: ' ♫ ', mini: '♫ ', colour: '#2E8F6E' },
  propeller: { art: ' ✣ ', mini: '✣ ', colour: '#5C86B8' },
} as const

export type Accessory = keyof typeof ACCESSORIES
export const ACCESSORY_NAMES = Object.keys(ACCESSORIES) as Accessory[]

/** Flying: the propeller cap in its hat's place, its blade a row above it, turning every frame. */
export const FLYING_CAP = { art: '▄▄▄', blades: ['+', 'x'] } as const

/**
 * Energy by effort, at the outer two cells of the air row's other end (from
 * column 9 when the hat is left or centred, from column 2 when it is right):
 * none for low, medium or unknown; one star (the inner cell) for high; two
 * for xhigh and max.
 */
export const ENERGY_MARKS = { right: ['  ', '✦ ', '✦✦'], left: ['  ', ' ✦', '✦✦'] } as const
export const ENERGY_X = { right: 9, left: 2 } as const

/** An agent's role, one letter centred above its head in the foreground: blank for any other type. */
export const ROLE_LETTERS = {
  reviewer: 'r',
  debugger: 'd',
  planner: 'p',
  worker: 'w',
  frontend: 'f',
  explorer: 'e',
} as const

export type RoleName = keyof typeof ROLE_LETTERS

// --- beside the figure ---------------------------------------------------------------

/** One overlay's art from cells: [box row, box column, glyphs], row −1 the sky row, every row a slot wide. */
export const placed = (...cells: readonly (readonly [number, number, string])[]): string[] => {
  const rows = Array.from({ length: GRID_ROWS }, () => Array.from({ length: SLOT }, () => ' '))
  for (const [row, column, glyphs] of cells) {
    ;[...glyphs].forEach((glyph, index) => {
      const line = rows[row + SKY]
      if (line !== undefined && column + index < SLOT) line[column + index] = glyph
    })
  }

  return rows.map(row => row.join(''))
}

const twice = <T,>(frame: T): T[] => [frame, frame]
const each = (ink: Ink, frames: readonly (readonly string[])[], extra: Omit<Overlay, 'art' | 'ink'> = {}): Overlay[] => frames.map(art => ({ art, ink, ...extra }))

/** Three steps a cycle: the first two frames, the next two, then the last four. */
const GROWING = [0, 0, 1, 1, 2, 2, 2, 2] as const

/** Thinking phrases: one choice per eight-frame growth spell, shared with the session. */
export const THOUGHTS = ['hmm', 'hmmm…', 'lemme think', 'pondering', 'wait…', 'noodling', 'mulling it', 'brain go brr', 'cogitating', 'deep in it', 'ooh?', 'thinky thinky', 'one sec', 'plotting', 'hm hm hm'] as const

/** Parentheses included: at most fourteen single-width cells, clipped with an ellipsis. */
export const thoughtBubble = (phrase: string, width = 14): string => {
  const room = Math.max(1, Math.min(14, width) - 2)

  return `(${phrase.length <= room ? phrase : `${phrase.slice(0, room - 1)}…`})`
}

const thoughtArt = (phrase: string, step: number, width = 14): string[] => {
  const bubble = thoughtBubble(phrase, width)

  return placed(...([[1, 11, '·'], [0, 12, '∘'], [-1, Math.min(11, SLOT - bubble.length), bubble]] as const).slice(0, step + 1))
}

/** Each phrase's thought frames: the growth stays 1,1,2,2,3,3,3,3; without sky, the bubble fits beside the badge. */
export const thoughtFrames = (phrases: readonly string[]): readonly (readonly Overlay[])[] => phrases.map(phrase => GROWING.map(step => ({
  art: thoughtArt(phrase, step),
  lowArt: thoughtArt(phrase, step, SLOT - 11),
  ink: 'd',
  by: Object.fromEntries([...phrase, '…'].filter(ch => ch !== ' ').map(ch => [ch, 'f' as const])),
})))

export const THOUGHT_FRAMES: readonly (readonly Overlay[])[] = thoughtFrames(THOUGHTS)

/**
 * The mascot's overlays, laid out in its standing box (row 0 the air row,
 * row −1 the sky row); each rides with the head, a row lower when the mascot
 * sits, crouches or is squashed. A table animates in order, a frame a tick.
 */
export const OVERLAYS = {
  /**
   * A thought rising diagonally from beside the head, each bubble bigger: `·`,
   * then `∘`, then a phrase in parentheses in the sky row, held. Dim border,
   * foreground text. This first phrase is the frame-table preview.
   */
  thought: THOUGHT_FRAMES[0]!,
  /** Asleep: `z`, then `z z`, then `z z Z`, rising the same way, held. Dim. */
  zzz: each('d', GROWING.map(step => placed(...([[1, 11, 'z'], [0, 12, 'z'], [-1, 13, 'Z']] as const).slice(0, step + 1)))),
  /** After ten minutes idle: the moon, in the warning colour. */
  moon: each('y', [placed([0, 0, '☾'])]),
  /** The context 85 % full: a drop beside the head, falling. */
  sweat: each('i', [placed([1, 1, "'"]), placed([1, 1, ','])].flatMap(twice)),
  /** Stalled: a turning clock beside the head. */
  clock: each('y', ['◴', '◷', '◶', '◵'].map(glyph => placed([0, 11, glyph])).flatMap(twice)),
  /** Stalled asleep under the blanket: the same clock on the floor beside it, clear of the z z Z (drawn a row lower with no sky row). */
  blanketClock: each('y', ['◴', '◷', '◶', '◵'].map(glyph => placed([3, 11, glyph])).flatMap(twice)),
  /** Asking: the right hand up beside the head (its colour), the `?` above it. */
  ask: [{ art: placed([0, 11, '?'], [1, 10, '▌']), ink: 'b' as const, by: { '?': 'p' as const } }],
  /** Done: a tick beside the head. */
  tick: each('g', [placed([1, 11, '✓'])]),
  /** Failed: a cross over the slumped head (drawn a row lower, sitting). */
  cross: each('r', [placed([-1, 6, '✗'])]),
  /** Back from the TV, shaken: `!?` beside its head. */
  startle: each('y', [placed([0, 11, '!?'])]),
  /** A parent pointing at its child as it lands: its arm out, the pointer beside it. */
  pointing: each('b', [placed([2, 11, '⇢'])]),
  /** The cigarette in the right hand, its tip glowing. */
  cigarette: each('k', [placed([2, 11, '╼'])], { colour: '#CF6248' }),
  /** Its smoke rising, half a second a puff. */
  smoke: each('d', [placed([1, 12, '·']), placed([0, 12, '∘']), placed([0, 12, '○']), placed()].flatMap(twice)),
  /**
   * Tidying up (a compaction running), eight frames on a loop: a stack of
   * pages three high beside it (`≡`, dim: the foreground is the letter's and
   * the thought's alone), pressed to two as its arm comes down, dust puffing
   * up (dim), then to a cube on the floor (`▄▄`, the accent) with a spark
   * (warning); the next stack lands from above.
   */
  tidy: [
    { art: placed([1, 12, '≡≡≡'], [2, 12, '≡≡≡'], [3, 12, '≡≡≡']), ink: 'd' },
    { art: placed([1, 12, '≡≡≡'], [2, 12, '≡≡≡'], [3, 12, '≡≡≡']), ink: 'd' },
    { art: placed([1, 15, '·'], [2, 12, '≡≡≡'], [3, 12, '≡≡≡']), ink: 'd' },
    { art: placed([0, 15, '∘'], [1, 16, '·'], [2, 12, '≡≡≡'], [3, 12, '≡≡≡']), ink: 'd' },
    { art: placed([0, 16, '·'], [3, 12, '▄▄']), ink: 'a', by: { '·': 'd' } },
    { art: placed([2, 14, '✦'], [3, 12, '▄▄']), ink: 'a', by: { '✦': 'y' } },
    { art: placed([2, 14, '✧'], [3, 12, '▄▄']), ink: 'a', by: { '✧': 'y' } },
    { art: placed([-1, 12, '≡≡≡'], [3, 12, '▄▄']), ink: 'a', by: { '≡': 'd' } },
  ],
  /**
   * Dizzy: three stars over the figure on its back (columns 3, 6 and 9), one
   * hidden a frame in turn, each coming back as the other star.
   */
  dizzy: each('y', Array.from({ length: 8 }, (_, frame) => placed(...[3, 6, 9].flatMap((column, star): (readonly [number, number, string])[] => {
    if (frame % 3 === star) return []
    const hidden = frame < star ? 0 : Math.floor((frame - star) / 3) + 1

    return [[0, column, hidden % 2 === 0 ? '✦' : '✧']]
  })))),
} satisfies Record<string, readonly Overlay[]>

export type OverlayName = keyof typeof OVERLAYS

// --- the laptop ---------------------------------------------------------------------
//
// An open laptop, seen from the front and a little from its left: the lid's
// top on the head row, the screen (a dim fill, no content) on the torso row,
// the base on the floor, its deck reaching back under the near hand (column
// 11) with a row of keys. Slate; the screen and the keys dim. Only at work.

export const LAPTOP_X = 11
export const LAPTOP_COLOUR = '#78828F'

export const LAPTOP: readonly Overlay[] = [
  { art: placed([1, 12, '▗▄▄▄▖'], [2, 12, '▐'], [2, 16, '▌'], [3, 11, '▀'], [3, 13, '▀'], [3, 15, '▀▀']), ink: 'k', colour: LAPTOP_COLOUR },
  { art: placed([2, 13, '▒▒▒'], [3, 12, '▀'], [3, 14, '▀']), ink: 'd' },
]

/** The near hand on the keys, every other frame at work: its arm out on the torso row, the hand at column 11. */
export const REACH = placed([2, 11, '▖'])

// --- the mini --------------------------------------------------------------------------

/**
 * The mini, Clawd at half size: its head row (the eyes notches, shut eyes
 * none, as the full figure's) over its body row (the arms out, two legs).
 * Every frame 5 cells.
 */
export const MINI_HEADS = {
  open: ' ▛█▜ ',
  left: ' ▛▛█ ',
  right: ' █▜▜ ',
  shut: ' ███ ',
} as const

export const MINI_LEGS = {
  stand: '▝▜▀▛▘',
  step: '▝▛▀▜▘',
  tap: '▝▜▀▜▘',
  none: '▝▀▀▀▘',
} as const

/** The mini slumped or down: one row on the floor, head and body together, eyes shut. */
export const MINI_SAT = '▗███▖'

export type MiniHead = keyof typeof MINI_HEADS
export type MiniLegs = keyof typeof MINI_LEGS

export const B5 = '     '
const mini = (r0: string, r1 = B5, r2 = B5, r3 = B5): readonly string[] => [r0, r1, r2, r3]

/** The mini's overlays: every frame 5 by 4, its head on row 2; nothing on its head, nothing in the foreground. */
export const MINI_OVERLAYS = {
  thought: each('d', [mini(B5, '    ·'), mini('    ∘', '    ·'), mini('    ○', '    ·')].flatMap(twice)),
  zzz: each('d', [mini(B5, '    z'), mini('    Z')].flatMap(twice)),
  laptop: [{ art: mini(B5, B5, B5, '▐▒▒▒▌'), ink: 'k' as const, colour: LAPTOP_COLOUR, by: { '▒': 'd' as const } }],
  ask: [{ art: mini(B5, '    ?', '    ▌'), ink: 'b' as const, by: { '?': 'p' as const } }],
  clock: each('y', ['◴', '◷', '◶', '◵'].map(glyph => mini(B5, `    ${glyph}`)).flatMap(twice)),
  tick: each('g', [mini(B5, '    ✓')]),
  cross: each('r', [mini('  ✗  ')]),
  dizzy: each('y', [mini(B5, '    ✦'), mini(B5, '    ✧')].flatMap(twice)),
} satisfies Record<string, readonly Overlay[]>

export type MiniOverlayName = keyof typeof MINI_OVERLAYS

/** Every table, by name, with the size each of its frames has: what the integrity test walks. */
export const FRAME_TABLES: readonly { name: string; width: number; height: number; frames: readonly (readonly string[])[] }[] = [
  { name: 'HEADS', width: BODY_WIDTH, height: 1, frames: Object.values(HEADS).map(row => [row]) },
  { name: 'TORSOS', width: BODY_WIDTH, height: 1, frames: Object.values(TORSOS).map(row => [row]) },
  { name: 'LEGS', width: BODY_WIDTH, height: 1, frames: Object.values(LEGS).map(row => [row]) },
  { name: 'SQUASHED', width: BODY_WIDTH, height: 2, frames: [SQUASHED] },
  { name: 'FLAT', width: BODY_WIDTH, height: 2, frames: [[FLAT.legs, FLAT.body]] },
  { name: 'CROUCHED', width: BODY_WIDTH, height: 1, frames: [[CROUCHED]] },
  { name: 'BLANKET', width: BODY_WIDTH, height: 2, frames: BLANKET.quilt.map(quilt => [quilt, BLANKET.hem]) },
  { name: 'ACCESSORIES', width: 3, height: 1, frames: [...Object.values(ACCESSORIES).map(one => [one.art]), [CROWN.art], [FLYING_CAP.art]] },
  { name: 'ACCESSORIES.mini', width: 2, height: 1, frames: Object.values(ACCESSORIES).map(one => [one.mini]) },
  { name: 'ENERGY_MARKS', width: 2, height: 1, frames: [...ENERGY_MARKS.right, ...ENERGY_MARKS.left].map(mark => [mark]) },
  { name: 'MINI_HEADS', width: MINI, height: 1, frames: Object.values(MINI_HEADS).map(row => [row]) },
  { name: 'MINI_LEGS', width: MINI, height: 1, frames: Object.values(MINI_LEGS).map(row => [row]) },
  { name: 'MINI_SAT', width: MINI, height: 1, frames: [[MINI_SAT]] },
  { name: 'LEANING', width: BODY_WIDTH, height: 1, frames: Object.values(LEANING).map(row => [row]) },
  ...Object.entries(OVERLAYS).map(([name, frames]) => ({ name: `OVERLAYS.${name}`, width: SLOT, height: GRID_ROWS, frames: frames.map(one => one.art) })),
  { name: 'LAPTOP', width: SLOT, height: GRID_ROWS, frames: LAPTOP.map(one => one.art) },
  { name: 'REACH', width: SLOT, height: GRID_ROWS, frames: [REACH] },
  ...Object.entries(MINI_OVERLAYS).map(([name, frames]) => ({ name: `MINI_OVERLAYS.${name}`, width: MINI, height: BOX_ROWS, frames: frames.map(one => one.art) })),
]
