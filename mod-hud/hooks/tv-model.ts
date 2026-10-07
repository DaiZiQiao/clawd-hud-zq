import type { TextRow } from './text-svg'
import { displayWidth } from './text-width'
import type { Box, Eyes, Who } from './tv-figure'

// The TV a pressed mascot becomes (hooks/tv-figure.ts draws the mascot): its
// room in the pane, the TV on its forehead (the glass and a panel either
// side, the same width, so the casing shows as much left as right), what a
// press or a key does there, how far the glass scrolls, and how it all looks
// through the animations, frame by frame. Its surface module
// (hooks/tv-client.tsx) runs them on its own frame clock; the hooks hand it
// the rows to show and hear back a press, a channel or a close.

/** One frame of the TV's animations, as the smooth scene's (20 a second). */
export const TV_FRAME_MS = 50

/** The text rows on the glass at most, and at least (with fewer, the pane draws its own view). */
export const TV_MAX_SCREEN = 14
export const TV_MIN_SCREEN = 5
/** The glass's text columns at least. */
export const TV_MIN_CONTENT = 22
/** The figure's columns at most. */
export const TV_MAX_WIDTH = 76

/**
 * Where the TV stands: the figure's box in the region (the pane's body as
 * shown), and in the figure its body (the casing), the TV on its forehead
 * (the glass and both panels), the glass (a rounded row above and below its
 * text), each panel, and the ✕'s three cells; the glass's text columns (a
 * scrollbar right of them) and rows.
 */
export type TvLayout = {
  character: 'clawd' | 'usagi'
  left: number
  top: number
  width: number
  height: number
  body: Box
  tv: Box
  glass: Box
  channel: Box
  scroll: Box
  close: { x: number; y: number }
  content: number
  screen: number
}

/**
 * The TV for a region of `columns` by `rows`, centred: undefined when the
 * glass would hold fewer than TV_MIN_SCREEN rows or TV_MIN_CONTENT columns.
 * Clawd: its crown or accessory over three rows, its body (a row, the TV,
 * a row, its eyes over three, its torso over two, its arms out of it), its
 * legs over two. Usagi: its ears and hat over four rows, its round body (a
 * round row, a row, the TV, a row, its eyes, its cheeks and mouth, a round
 * row), its feet. The TV is the glass with a panel either side, a cell apart.
 */
export const tvLayoutOf = (character: 'clawd' | 'usagi', columns: number, rows: number): TvLayout | undefined => {
  const across = Math.floor(columns)
  const down = Math.floor(rows)
  if (!Number.isFinite(across) || !Number.isFinite(down)) return undefined
  const width = Math.min(across - 2, TV_MAX_WIDTH)
  const panel = width >= 60 ? 5 : 4
  const usagi = character === 'usagi'
  // Rows besides the glass's text: Clawd 14 (3 + 9 + 2, the glass's two round rows among them), Usagi 13 (4 + 8 + 1).
  const around = usagi ? 13 : 14
  const screen = Math.min(TV_MAX_SCREEN, down - 1 - around)
  if (screen < TV_MIN_SCREEN) return undefined
  const arm = usagi ? 3 : width >= 60 ? 4 : 3
  const margin = usagi ? 3 : 2
  const body: Box = { x: arm, y: usagi ? 4 : 3, w: width - 2 * arm, h: screen + (usagi ? 8 : 9) }
  const glassW = body.w - 2 * margin - 2 * panel - 2
  const content = glassW - 2
  if (content < TV_MIN_CONTENT) return undefined
  const tvTop = body.y + (usagi ? 2 : 1)
  const glass: Box = { x: body.x + margin + panel + 1, y: tvTop, w: glassW, h: screen + 2 }
  const tv: Box = { x: body.x + margin, y: tvTop, w: glassW + 2 * panel + 2, h: screen + 2 }
  const height = screen + around

  return {
    character,
    left: Math.floor((across - width) / 2),
    top: Math.floor((down - height) / 2),
    width,
    height,
    body,
    tv,
    glass,
    channel: { x: tv.x, y: tvTop, w: panel, h: glass.h },
    scroll: { x: glass.x + glassW + 1, y: tvTop, w: panel, h: glass.h },
    close: { x: body.x + body.w - (usagi ? 5 : 4), y: body.y + (usagi ? 1 : 0) },
    content,
    screen,
  }
}

// --- what the glass shows ----------------------------------------------------------

/** A run of text on the glass, in the pane's styles (a theme key or a raw colour). */
export type TvSpan = { text: string; color?: string; bold?: true; dim?: true; italic?: true; strike?: true }

/** A press on the glass: a tab, a model's line, an agent's `▸`; `primary` draws `[ label ]`; `cover` the cells it takes, when not its label's. */
export type TvPress = { press: string; label: string; primary?: true; dim?: true; cover?: number }

export type TvCell = TvSpan | TvPress

/** One row on the glass. */
export type TvRow = { key: string; cells: TvCell[] }

export const isPress = (cell: TvCell): cell is TvPress => 'press' in cell

/** A press's cells as the terminal draws a Button: `[ label ]` primary, the label alone plain. */
export const pressText = (press: TvPress): string => (press.primary === true ? `[ ${press.label} ]` : press.label)

/** A cell's text and cells across. */
export const cellText = (cell: TvCell): string => (isPress(cell) ? pressText(cell) : cell.text)

/**
 * The pane's rows of text as the glass's: each span's look kept, each Button
 * a press under its key, with what pressing it runs; `cover` keeps a model
 * line's press to its glyph and name.
 */
export const tvRowsOf = (rows: readonly TextRow[]): { rows: TvRow[]; presses: Map<string, () => void> } => {
  const presses = new Map<string, () => void>()
  const tvRows = rows.map((row): TvRow => ({
    key: row.key,
    cells: row.cells.map((cell): TvCell => {
      if ('button' in cell) {
        presses.set(cell.button.key, cell.button.onPress)

        return {
          press: cell.button.key,
          label: cell.button.label,
          ...(cell.button.primary === true ? { primary: true as const } : {}),
          ...(cell.button.dimColor === true ? { dim: true as const } : {}),
        }
      }

      return {
        text: cell.text,
        ...(cell.color === undefined ? {} : { color: cell.color }),
        ...(cell.bold === true ? { bold: true as const } : {}),
        ...(cell.dimColor === true ? { dim: true as const } : {}),
        ...(cell.italic === true ? { italic: true as const } : {}),
        ...(cell.strikethrough === true ? { strike: true as const } : {}),
      }
    }),
  }))

  return { rows: tvRows, presses }
}

/**
 * What the hooks hand the TV's surface module on each of their redraws: the
 * region, the layout, who is in the TV, the header and tab bar (pinned at the
 * glass's top) and the tab's rows (which scroll), the channels (tabs) and the
 * one shown, a `view` naming who and which tab (a new one starts the glass at
 * its top through a flicker of static), where the mascot stood when it was
 * pressed (its sprite's top-left in the region), the pane's scrolls while the
 * TV is up (a new `seq` scrolls the glass by `by`, `page` a glassful), and
 * whether the surface draws pixels.
 */
export type TvInputs = {
  columns: number
  rows: number
  layout: TvLayout
  who: Who
  head: TvRow[]
  body: TvRow[]
  tabs: string[]
  tab: string
  view: string
  from?: { x: number; y: number }
  wheel?: { seq: number; by: number; page?: true }
  svg?: true
}

/** The glass's rows for the tab's body: the text rows less the pinned head (one at least). */
export const roomOf = (inputs: Pick<TvInputs, 'layout' | 'head'>): number => Math.max(1, inputs.layout.screen - inputs.head.length)

/** How far the tab's rows scroll at most. */
export const maxScrollOf = (inputs: Pick<TvInputs, 'layout' | 'head' | 'body'>): number => Math.max(0, inputs.body.length - roomOf(inputs))

/** A scroll moved `by` rows, kept within the rows. */
export const scrolledBy = (inputs: Pick<TvInputs, 'layout' | 'head' | 'body'>, scroll: number, by: number): number =>
  Math.max(0, Math.min(maxScrollOf(inputs), Math.round(scroll + by)))

/** The rows on the glass at this scroll: the head, then the tab's rows from `scroll`. */
export const shownRows = (inputs: Pick<TvInputs, 'layout' | 'head' | 'body'>, scroll: number): TvRow[] => {
  const head = inputs.head.slice(0, inputs.layout.screen)

  return [...head, ...inputs.body.slice(scroll, scroll + Math.max(0, inputs.layout.screen - head.length))]
}

/** The scrollbar's thumb on the glass's text rows (from the first body row): its first row and its length; undefined when the rows fit. */
export const thumbOf = (inputs: Pick<TvInputs, 'layout' | 'head' | 'body'>, scroll: number): { from: number; length: number } | undefined => {
  const most = maxScrollOf(inputs)
  if (most === 0) return undefined
  const room = roomOf(inputs)
  const length = Math.max(1, Math.round((room * room) / inputs.body.length))

  return { from: Math.round(((room - length) * scroll) / most), length }
}

/** The channel `by` away from the one shown, round the tabs. */
export const channelOf = (inputs: Pick<TvInputs, 'tabs' | 'tab'>, by: number): string | undefined => {
  const count = inputs.tabs.length
  if (count === 0) return undefined
  const at = Math.max(0, inputs.tabs.indexOf(inputs.tab))

  return inputs.tabs[(((at + by) % count) + count) % count]
}

// --- the panels ----------------------------------------------------------------------

/**
 * A panel's rows, by the glass's text rows: the channel panel's knob (two
 * rows), its `CH` and its `◀ ▶`; the scroll panel's knob, its `▲` and its
 * `▼`; a grille under both.
 */
export type PanelPart = 'blank' | 'knob-top' | 'knob-bottom' | 'label' | 'arrows' | 'up' | 'down' | 'grille'

export const channelPanelOf = (screen: number): PanelPart[] => partsOf(screen, ['knob-top', 'knob-bottom', 'label', 'arrows'])
export const scrollPanelOf = (screen: number): PanelPart[] => partsOf(screen, ['knob-top', 'knob-bottom', 'up', 'down'])

const partsOf = (screen: number, controls: readonly PanelPart[]): PanelPart[] => {
  const lead: PanelPart[] = screen >= 7 ? ['blank'] : []
  const top = [...lead, ...controls]

  return Array.from({ length: screen }, (_, row) => top[row] ?? ((row - top.length) % 2 === 1 ? 'grille' : 'blank'))
}

// --- presses ---------------------------------------------------------------------------

/** What a press or a key on the TV does. */
export type TvHit =
  | { kind: 'outside' }
  | { kind: 'close' }
  | { kind: 'channel'; by: 1 | -1 }
  | { kind: 'scroll'; by: number }
  | { kind: 'page'; by: 1 | -1 }
  | { kind: 'press'; key: string }
  | { kind: 'inside' }

/** The press whose cells a column of a row falls on, its own cells or its `cover`. */
export const pressAt = (row: TvRow, column: number): string | undefined => {
  let at = 0
  for (const cell of row.cells) {
    const cells = displayWidth(cellText(cell))
    if (isPress(cell) && column >= at && column < at + (cell.cover ?? cells)) return cell.press
    at += cells
  }

  return undefined
}

/**
 * What a press at a cell of the region lands on: the ✕ (or the cell round
 * it); a panel's control; the scrollbar (a glassful up above its thumb, down
 * below it); a press on the glass's rows; the mascot (`inside`: its body, and
 * whatever `drawn` says is its: its arms, legs, ears and hat); else outside,
 * which closes the TV.
 */
export const tvHitAt = (inputs: TvInputs, scroll: number, x: number, y: number, drawn?: (fx: number, fy: number) => boolean): TvHit => {
  const { layout } = inputs
  const fx = x - layout.left
  const fy = y - layout.top
  if (fy >= layout.close.y - 1 && fy <= layout.close.y && fx >= layout.close.x - 1 && fx <= layout.close.x + 3) return { kind: 'close' }
  const row = fy - layout.glass.y - 1
  const onText = row >= 0 && row < layout.screen
  const within = (box: Box): boolean => fx >= box.x && fx < box.x + box.w
  if (onText && within(layout.channel)) {
    const part = channelPanelOf(layout.screen)[row]
    if (part === 'knob-top' || part === 'knob-bottom') return { kind: 'channel', by: 1 }
    if (part === 'arrows' || part === 'label') return { kind: 'channel', by: fx < layout.channel.x + layout.channel.w / 2 ? -1 : 1 }

    return { kind: 'inside' }
  }
  if (onText && within(layout.scroll)) {
    const part = scrollPanelOf(layout.screen)[row]
    if (part === 'up') return { kind: 'scroll', by: -1 }
    if (part === 'down') return { kind: 'scroll', by: 1 }
    if (part === 'knob-top') return { kind: 'page', by: -1 }
    if (part === 'knob-bottom') return { kind: 'page', by: 1 }

    return { kind: 'inside' }
  }
  if (onText && fx === layout.glass.x + layout.glass.w - 1) {
    const thumb = thumbOf(inputs, scroll)
    const at = row - Math.min(inputs.head.length, layout.screen)
    if (thumb !== undefined && at >= 0) {
      if (at < thumb.from) return { kind: 'page', by: -1 }
      if (at >= thumb.from + thumb.length) return { kind: 'page', by: 1 }
    }

    return { kind: 'inside' }
  }
  if (onText && fx > layout.glass.x && fx < layout.glass.x + layout.glass.w - 1) {
    const shown = shownRows(inputs, scroll)[row]
    const key = shown === undefined ? undefined : pressAt(shown, fx - layout.glass.x - 1)

    return key === undefined ? { kind: 'inside' } : { kind: 'press', key }
  }
  const body = layout.body
  if (fx >= body.x && fx < body.x + body.w && fy >= body.y && fy < body.y + body.h) return { kind: 'inside' }
  if (fx >= 0 && fx < layout.width && fy >= 0 && fy < layout.height && drawn?.(fx, fy) === true) return { kind: 'inside' }

  return { kind: 'outside' }
}

/** What a key does while the TV has the keyboard: the arrows as its panels, the page keys a glassful, Home and End, `q` or `x` to close. */
export const tvKeyOf = (key: string): TvHit | undefined => {
  switch (key) {
    case 'left':
      return { kind: 'channel', by: -1 }
    case 'right':
      return { kind: 'channel', by: 1 }
    case 'up':
      return { kind: 'scroll', by: -1 }
    case 'down':
      return { kind: 'scroll', by: 1 }
    case 'pageup':
      return { kind: 'page', by: -1 }
    case 'pagedown':
    case ' ':
      return { kind: 'page', by: 1 }
    case 'home':
      return { kind: 'scroll', by: -1_000_000 }
    case 'end':
      return { kind: 'scroll', by: 1_000_000 }
    case 'q':
    case 'x':
      return { kind: 'close' }
    default:
      return undefined
  }
}

// --- the animations ------------------------------------------------------------------------

/**
 * Where the TV is in its life: the mascot flying from its place to the
 * centre, growing into the giant, the glass switching on, on; then the glass
 * switching off, the giant shrinking back into the mascot, the mascot flying
 * home; gone (the hooks are told it closed).
 */
export type TvPhase = 'travel' | 'grow' | 'power-on' | 'on' | 'power-off' | 'shrink' | 'return' | 'gone'

/** Each phase's frames (the steady `on` none). */
export const TV_FRAMES: Readonly<Record<Exclude<TvPhase, 'on' | 'gone'>, number>> = {
  travel: 5,
  grow: 5,
  'power-on': 6,
  'power-off': 7,
  shrink: 5,
  return: 5,
}

/** What the glass shows: dark; a bright line across its middle (`width` of the way); the picture opening out of it (`height`); a dot; the picture; static. */
export type Glass =
  | { kind: 'off' }
  | { kind: 'line'; width: number }
  | { kind: 'open'; height: number }
  | { kind: 'dot'; fade: number }
  | { kind: 'on' }
  | { kind: 'static'; seed: number }

/**
 * One frame of the TV: the mascot as its sprite (flying, `travel` of the way
 * from its place to the centre, at `scale` from its own size to the giant's)
 * or as the giant with its glass; its eyes; the desktop's dim over the pane.
 */
export type TvLook =
  | { form: 'sprite'; travel: number; scale: number; eyes: Eyes; scrim: number }
  | { form: 'giant'; glass: Glass; eyes: Eyes; scrim: number }

/** Easing for a move: quick out, slow in. */
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t)

const ON: Glass = { kind: 'on' }

/**
 * The TV's look at a frame of a phase: `flicker`, frames of static left from
 * a channel change; `blink`, the eyes shut this frame.
 */
export const tvLookAt = (phase: TvPhase, frame: number, flicker = 0, blink = false): TvLook | undefined => {
  const step = (count: number): number => Math.min(1, (frame + 1) / count)
  switch (phase) {
    case 'travel':
      return { form: 'sprite', travel: easeOut(step(TV_FRAMES.travel)), scale: 0, eyes: 'wide', scrim: 0.3 * step(TV_FRAMES.travel) }
    case 'grow':
      return { form: 'sprite', travel: 1, scale: easeOut(step(TV_FRAMES.grow)), eyes: 'wide', scrim: 0.3 + 0.2 * step(TV_FRAMES.grow) }
    case 'power-on': {
      const glasses: readonly Glass[] = [{ kind: 'off' }, { kind: 'line', width: 0.3 }, { kind: 'line', width: 0.7 }, { kind: 'line', width: 1 }, { kind: 'open', height: 0.4 }, { kind: 'open', height: 0.75 }]

      return { form: 'giant', glass: glasses[Math.min(frame, glasses.length - 1)] ?? ON, eyes: frame < 2 ? 'wide' : 'open', scrim: 0.5 }
    }
    case 'on':
      return { form: 'giant', glass: flicker > 0 ? { kind: 'static', seed: flicker } : ON, eyes: blink ? 'shut' : 'open', scrim: 0.5 }
    case 'power-off': {
      const glasses: readonly Glass[] = [{ kind: 'open', height: 0.6 }, { kind: 'open', height: 0.25 }, { kind: 'line', width: 1 }, { kind: 'line', width: 0.5 }, { kind: 'line', width: 0.15 }, { kind: 'dot', fade: 1 }, { kind: 'dot', fade: 0.4 }]

      return { form: 'giant', glass: glasses[Math.min(frame, glasses.length - 1)] ?? { kind: 'off' }, eyes: 'wide', scrim: 0.5 }
    }
    case 'shrink':
      return { form: 'sprite', travel: 1, scale: 1 - easeOut(step(TV_FRAMES.shrink)), eyes: 'wide', scrim: 0.5 - 0.2 * step(TV_FRAMES.shrink) }
    case 'return':
      return { form: 'sprite', travel: 1 - easeOut(step(TV_FRAMES.return)), scale: 0, eyes: 'wide', scrim: 0.3 * (1 - step(TV_FRAMES.return)) }
    case 'gone':
      return undefined
  }
}
