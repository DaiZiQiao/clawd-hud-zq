import type { ClientKeyEvent, ClientPointerEvent, JsonValue } from 'claude-code'

import { figureCells, giantOf, spriteOf } from './tv-figure'
import type { Figure } from './tv-figure'
import { TV_FRAMES, TV_FRAME_MS, channelOf, roomOf, scrolledBy, tvHitAt, tvKeyOf, tvLookAt } from './tv-model'
import type { TvHit, TvInputs, TvLook, TvPhase } from './tv-model'
import { shapeOf } from './tv-paint'
import { giantCells } from './tv-smooth'

// The TV's life in its surface module (hooks/tv-client.tsx), kept apart from
// the engine so it runs in a test as it does on a surface: its phase and
// frame on its own clock, the glass's scroll, the static after a channel
// change and the channel's number on the glass a moment, a ▲ or ▼ held down
// repeating, the pane's scrolls passed on to it, and the presses and keys
// that change channel, press what the glass shows, or close it. Closing
// plays out (the glass switches off, the mascot shrinks and flies home)
// before the hooks hear `{ kind: 'tv', close: true }`. The hooks hear too
// when it becomes the giant and stops being it (`giant`): where pictures are
// drawn, they draw it under the glass (`TvInputs.pictured`).

/** Frames of static after a channel change. */
export const FLICKER_FRAMES = 3
/** How long the channel's number shows on the glass after it opens or changes. */
export const OSD_MS = 1500
/** A held ▲ or ▼: its first repeat after this long, then one every REPEAT_MS. */
export const REPEAT_DELAY_MS = 400
export const REPEAT_MS = 80
/** The giant blinks every BLINK_EVERY_MS, for BLINK_MS. */
export const BLINK_EVERY_MS = 4300
export const BLINK_MS = 120
/** Pressed in flight, its propeller cap's blade turns a frame every BLADE_MS. */
export const BLADE_MS = 100

/** What the module posts to the hooks. */
export type TvPost = { kind: 'tv'; close: true } | { kind: 'tv'; tab: string } | { kind: 'tv'; press: string } | { kind: 'tv'; giant: boolean }

export type TvWorld = {
  inputs: TvInputs
  /** The mascot as the scene draws it: what flies and grows. */
  sprite: Figure
  phase: TvPhase
  frame: number
  /** The module's own clock: a TV_FRAME_MS a tick. */
  ms: number
  scroll: number
  view: string
  flicker: number
  /** The channel's number shows on the glass until then. */
  osdUntil: number
  /** The last of the pane's scrolls taken. */
  wheel?: number
  /** Where a press went down, and a ▲ or ▼ held: when it next repeats. */
  down?: TvHit
  held?: { by: number; next: number }
  /** The close is posted (again on a press, should the hooks not have heard it). */
  closed: boolean
  /** The giant's drawn cells, for a press on its arms, legs, ears or hat: kept by who and the layout. */
  drawn?: { key: string; cells: Set<number> }
}

const sameWho = (a: TvInputs['who'], b: TvInputs['who']): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The TV as it is pressed: flying from where the mascot stood, or, where that is not known, growing where it will stand. */
export const createTv = (inputs: TvInputs): TvWorld => {
  const flies = inputs.from !== undefined

  return {
    inputs,
    sprite: spriteOf(inputs.who),
    phase: flies ? 'travel' : 'grow',
    frame: 0,
    ms: 0,
    scroll: 0,
    view: inputs.view,
    flicker: 0,
    osdUntil: (flies ? TV_FRAMES.travel : 0) * TV_FRAME_MS + (TV_FRAMES.grow + TV_FRAMES['power-on']) * TV_FRAME_MS + OSD_MS,
    ...(inputs.wheel === undefined ? {} : { wheel: inputs.wheel.seq }),
    closed: false,
  }
}

/** A glassful of the tab's rows, less one so a row stays in view. */
const pageOf = (inputs: TvInputs): number => Math.max(1, roomOf(inputs) - 1)

/**
 * The hooks' next props: the rows and the room; another who (another agent
 * from the Agents tab) or another tab starts the glass at its top through
 * static, the channel shown; a new scroll of the pane's moves the glass.
 */
export const receiveTv = (tv: TvWorld, inputs: TvInputs): void => {
  const was = tv.inputs
  tv.inputs = inputs
  if (!sameWho(was.who, inputs.who)) tv.sprite = spriteOf(inputs.who)
  if (inputs.view !== tv.view) {
    tv.view = inputs.view
    tv.scroll = 0
    if (tv.phase === 'on') {
      tv.flicker = FLICKER_FRAMES
      tv.osdUntil = tv.ms + OSD_MS
    }
  }
  if (inputs.wheel !== undefined && inputs.wheel.seq !== tv.wheel) {
    if (tv.wheel !== undefined && tv.phase === 'on') tv.scroll = scrolledBy(inputs, tv.scroll, inputs.wheel.page === true ? Math.sign(inputs.wheel.by) * pageOf(inputs) : inputs.wheel.by)
    tv.wheel = inputs.wheel.seq
  }
  tv.scroll = scrolledBy(inputs, tv.scroll, 0)
}

/** The eyes shut this frame: a blink now and then while it is on. */
const blinking = (tv: TvWorld): boolean => tv.phase === 'on' && tv.ms % BLINK_EVERY_MS < BLINK_MS

/** The propeller's blade, wearing its cap: `+` or `x` this frame. */
const spinOf = (tv: TvWorld): number => (tv.inputs.who.cap === true ? Math.floor(tv.ms / BLADE_MS) % 2 : 0)

/** The frame's look. */
export const lookOf = (tv: TvWorld): TvLook | undefined => {
  const look = tvLookAt(tv.phase, tv.frame, tv.flicker, blinking(tv))

  return look?.form === 'giant' && tv.inputs.who.cap === true ? { ...look, spin: spinOf(tv) } : look
}

/** The channel's number on the glass, a moment after it opens or changes: `CH 2`. */
export const osdOf = (tv: TvWorld): string | undefined => (tv.phase === 'on' && tv.ms < tv.osdUntil ? `CH ${Math.max(0, tv.inputs.tabs.indexOf(tv.inputs.tab)) + 1}` : undefined)

const NEXT: Readonly<Partial<Record<TvPhase, TvPhase>>> = { travel: 'grow', grow: 'power-on', 'power-on': 'on', 'power-off': 'shrink', shrink: 'return', return: 'gone' }

/**
 * A tick of the module's clock: the animations step, a held ▲ or ▼ repeats,
 * the static runs out, the channel's number goes, the giant blinks, a
 * propeller's blade turns. Grown into the giant (switching on), and shrinking
 * out of it, the hooks are told; gone, that it closed. Whether the drawing
 * changes.
 */
export const tickTv = (tv: TvWorld, post: (data: TvPost) => void): boolean => {
  const before = { blink: blinking(tv), osd: osdOf(tv), spin: spinOf(tv) }
  tv.ms += TV_FRAME_MS
  let changed = false
  if (tv.phase !== 'on' && tv.phase !== 'gone') {
    tv.frame += 1
    changed = true
    const frames = TV_FRAMES[tv.phase]
    if (tv.frame >= frames) {
      // Home with no place to fly to: gone where it shrank.
      const next = tv.phase === 'shrink' && tv.inputs.from === undefined ? 'gone' : NEXT[tv.phase] ?? 'gone'
      if (next === 'power-on') post({ kind: 'tv', giant: true })
      if (tv.phase === 'power-off') post({ kind: 'tv', giant: false })
      tv.phase = next
      tv.frame = 0
      if (next === 'gone' && !tv.closed) {
        tv.closed = true
        post({ kind: 'tv', close: true })
      }
    }
  }
  if (tv.flicker > 0) {
    tv.flicker -= 1
    changed = true
  }
  if (tv.held !== undefined && tv.phase === 'on' && tv.ms >= tv.held.next) {
    tv.held.next += REPEAT_MS
    const scroll = scrolledBy(tv.inputs, tv.scroll, tv.held.by)
    if (scroll !== tv.scroll) {
      tv.scroll = scroll
      changed = true
    }
  }

  return changed || blinking(tv) !== before.blink || osdOf(tv) !== before.osd || (tv.phase === 'on' && spinOf(tv) !== before.spin)
}

/**
 * Closing: from on (or switching on), the glass switches off; growing, it
 * shrinks back from where it got to; flying in, it turns home. Whether the
 * drawing changes.
 */
export const startClose = (tv: TvWorld): boolean => {
  switch (tv.phase) {
    case 'power-on':
    case 'on':
      tv.phase = 'power-off'
      tv.frame = 0
      break
    case 'grow':
      tv.phase = 'shrink'
      tv.frame = Math.max(0, TV_FRAMES.shrink - 1 - tv.frame)
      break
    case 'travel':
      tv.phase = 'return'
      tv.frame = Math.max(0, TV_FRAMES.return - 1 - tv.frame)
      break
    default:
      return false
  }
  tv.held = undefined
  tv.down = undefined

  return true
}

/** What a hit does once pressed (the press let go on it, or its key): close, change channel, scroll, or press on the glass. Whether the drawing changes. */
const act = (tv: TvWorld, hit: TvHit, post: (data: TvPost) => void): boolean => {
  switch (hit.kind) {
    case 'outside':
    case 'close':
      return startClose(tv)
    case 'channel': {
      if (tv.phase !== 'on') return false
      const tab = channelOf(tv.inputs, hit.by)
      if (tab !== undefined && tab !== tv.inputs.tab) post({ kind: 'tv', tab })

      return false
    }
    case 'scroll':
    case 'page': {
      if (tv.phase !== 'on') return false
      const scroll = scrolledBy(tv.inputs, tv.scroll, hit.kind === 'page' ? hit.by * pageOf(tv.inputs) : hit.by)
      const moved = scroll !== tv.scroll
      tv.scroll = scroll

      return moved
    }
    case 'press':
      if (tv.phase === 'on') post({ kind: 'tv', press: hit.key })

      return false
    case 'inside':
      return false
  }
}

/** The giant's cells drawn (as its quarters, or `smooth` as its shapes), by `y * width + x` in its box: what of the mascot round the TV a press lands on. */
const drawnOf = (tv: TvWorld, smooth: boolean): Set<number> => {
  const { layout, who } = tv.inputs
  const key = JSON.stringify([smooth, who, layout.left, layout.top, layout.width, layout.height, layout.body, layout.tv])
  if (tv.drawn?.key === key) return tv.drawn.cells
  const cells = smooth ? giantCells(who, layout) : new Set<number>()
  if (!smooth) {
    figureCells(giantOf(who, shapeOf(layout))).forEach((row, y) => row.forEach((cell, x) => {
      if (cell !== undefined) cells.add(y * layout.width + x)
    }))
  }
  tv.drawn = { key, cells }

  return cells
}

const sameHit = (a: TvHit, b: TvHit): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * A press on the region: a ▲ or ▼ scrolls as it goes down and repeats while
 * held; anything else acts as it is let go on what it went down on. While it
 * closes, nothing; gone, a press posts the close again. Whether the drawing
 * changes.
 */
export const pointerTv = (tv: TvWorld, event: ClientPointerEvent, post: (data: TvPost) => void): boolean => {
  if (event.type !== 'down' && event.type !== 'up') return false
  if (event.button !== undefined && event.button !== 'left') return false
  if (tv.phase === 'gone') {
    if (event.type === 'down') post({ kind: 'tv', close: true })

    return false
  }
  if (tv.phase === 'power-off' || tv.phase === 'shrink' || tv.phase === 'return') return false
  const { layout } = tv.inputs
  // Drawn smooth (on the desktop, or the hooks' picture), its shapes are what shows, not its quarters.
  const smooth = tv.inputs.art === 'vector' && (tv.inputs.svg === true || tv.inputs.pictured === true)
  const hit = tvHitAt(tv.inputs, tv.scroll, event.x, event.y, (fx, fy) => drawnOf(tv, smooth).has(fy * layout.width + fx))
  if (event.type === 'down') {
    tv.down = hit
    if (hit.kind === 'scroll' && tv.phase === 'on') {
      tv.held = { by: hit.by, next: tv.ms + REPEAT_DELAY_MS }

      return act(tv, hit, post)
    }

    return false
  }
  const down = tv.down
  tv.down = undefined
  tv.held = undefined
  if (down === undefined || !sameHit(down, hit) || hit.kind === 'scroll') return false

  return act(tv, hit, post)
}

/** A key while the TV has the keyboard (a click on it gives it): the arrows as its panels, the page keys, Home and End, `q` or `x` to close. */
export const keyTv = (tv: TvWorld, event: ClientKeyEvent, post: (data: TvPost) => void): boolean => {
  const hit = tvKeyOf(event.key)

  return hit === undefined ? false : act(tv, hit, post)
}

/** Whether a post from the module is one the hooks act on: a close, a channel, a press, or the giant up or down, each plain and short. */
export const tvPostOf = (data: JsonValue | unknown): TvPost | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const { kind, close, tab, press, giant } = data as { kind?: unknown; close?: unknown; tab?: unknown; press?: unknown; giant?: unknown }
  if (kind !== 'tv') return undefined
  if (close === true) return { kind: 'tv', close: true }
  if (typeof giant === 'boolean') return { kind: 'tv', giant }
  if (typeof tab === 'string' && tab !== '' && tab.length <= 40) return { kind: 'tv', tab }
  if (typeof press === 'string' && press !== '' && press.length <= 300) return { kind: 'tv', press }

  return undefined
}
