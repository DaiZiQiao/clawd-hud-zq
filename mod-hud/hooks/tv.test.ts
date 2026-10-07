import { describe, expect, test } from 'claude-code/testing'

import type { HudSelection } from '../types'
import { SHAKE_MS, SHAKE_STEP_MS, STARTLED_MS, startledLook } from './mascot-poses'
import { OVERLAYS } from './mascot-sprites'
import { arrange, mount } from './scene-client.fixtures'
import { idleHud } from './scene-model.fixtures'
import { mascotLines } from './scene-render'
import { sceneOf } from './scene-model'
import type { SceneInputs } from './scene-types'
import { TYPIST, inputs as sceneInputs } from './scene-world.fixtures'
import { FRAME_MS, createWorld, receive, tick } from './scene-world'
import { layoutAt } from './scene-view'
import { NOW } from './scene-model.fixtures'
import { displayWidth } from './text-width'
import { extentOf, giantOf, holesFilled, spriteOf, whoOfMain } from './tv-figure'
import type { Figure, Who } from './tv-figure'
import { TV_FRAMES, TV_FRAME_MS, channelOf, maxScrollOf, scrolledBy, shownRows, thumbOf, tvHitAt, tvKeyOf, tvLayoutOf, tvLookAt } from './tv-model'
import type { TvInputs, TvRow } from './tv-model'
import { paintCells, paintSvg, shapeOf, TV_COLOURS } from './tv-paint'
import type { TvOut } from './tv-paint'
import { FLICKER_FRAMES, REPEAT_DELAY_MS, REPEAT_MS, createTv, keyTv, lookOf, osdOf, pointerTv, receiveTv, tickTv, tvPostOf } from './tv-world'
import type { TvPost, TvWorld } from './tv-world'
import { STARTLED } from './usagi-sprites'
import { TV_ROWS_BUDGET, budgeted } from './tv-rows'
import { drawUsagi, dressOfAgent } from './usagi-glyphs'

// The TV a pressed mascot grows into (hooks/tv-model.ts, tv-figure.ts,
// tv-paint.ts, tv-world.ts, tv-client.tsx), and the scene around it: the
// mascot out of the scene while it is in the TV, shaken when it is back.

const CLAWD: Who = { character: 'clawd', colour: '#886CD4', accessory: 'cap', side: 'left' }
const USAGI: Who = { character: 'usagi', colour: '#F3DC8C', hat: 'fedora' }

const rowsOf = (count: number, prefix = 'row'): TvRow[] => Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, cells: [{ text: `${prefix} ${index}` }] }))

const HEAD: TvRow[] = [
  { key: 'title', cells: [{ text: '● ', color: '#886CD4' }, { text: 'Explore', bold: true }, { text: ' · sonnet-5-5', dim: true }] },
  { key: 'tabs', cells: [{ press: 'tab:task', label: 'Task', dim: true }, { text: '   ' }, { press: 'tab:trail', label: 'Trail', primary: true }, { text: '  ' }, { press: 'tab:said', label: 'Said', dim: true }, { text: '   ' }, { press: 'tab:agents', label: 'Agents', dim: true }] },
  { key: 'gap', cells: [] },
]

const inputsOf = (who: Who = CLAWD, extra: Partial<TvInputs> = {}): TvInputs => ({
  columns: 72,
  rows: 36,
  layout: tvLayoutOf(who.character, 72, 36)!,
  who,
  head: HEAD,
  body: rowsOf(30),
  tabs: ['task', 'trail', 'said', 'agents'],
  tab: 'trail',
  view: 'a:trail',
  ...extra,
})

/** Ticks until it is on, the posts heard on the way. */
const switchedOn = (tv: TvWorld, posts: TvPost[] = []): void => {
  for (let frame = 0; frame < 100 && tv.phase !== 'on'; frame += 1) tickTv(tv, post => posts.push(post))
}

/** A press: down, then up, at a cell of the region. */
const click = (tv: TvWorld, x: number, y: number, posts: TvPost[]): void => {
  pointerTv(tv, { type: 'down', x, y, button: 'left' }, post => posts.push(post))
  pointerTv(tv, { type: 'up', x, y, button: 'left' }, post => posts.push(post))
}

/** A frame's terminal cells as text rows. */
const textOf = (grid: readonly (readonly (TvOut | undefined)[])[]): string[] => grid.map(row => row.map(cell => (cell === undefined ? ' ' : 'tail' in cell ? '' : cell.ch)).join(''))

const quartersWith = (figure: Figure, key: string): { x: number; y: number }[] =>
  figure.bitmap.flatMap((row, y) => [...row].flatMap((one, x) => (one === key ? [{ x, y }] : [])))

describe('the layout', () => {
  test('centred, the casing as wide left of the TV as right of it, a panel the same width either side of the glass, the TV on the forehead; both mascots at 100, 72 and 48 columns', () => {
    for (const character of ['clawd', 'usagi'] as const) {
      for (const columns of [100, 72, 48]) {
        const layout = tvLayoutOf(character, columns, 36)
        expect(layout, `${character} @${columns}`).toBeDefined()
        if (layout === undefined) continue
        expect(layout.left).toBe(Math.floor((columns - layout.width) / 2))
        expect(layout.left + layout.width).toBeLessThanOrEqual(columns)
        expect(layout.top + layout.height).toBeLessThanOrEqual(36)
        // Equal borders: the body's casing either side of the TV.
        expect(layout.tv.x - layout.body.x).toBe(layout.body.x + layout.body.w - (layout.tv.x + layout.tv.w))
        expect(layout.channel.w).toBe(layout.scroll.w)
        expect(layout.glass.x).toBe(layout.channel.x + layout.channel.w + 1)
        expect(layout.scroll.x).toBe(layout.glass.x + layout.glass.w + 1)
        expect(layout.content).toBe(layout.glass.w - 2)
        expect(layout.screen).toBe(layout.glass.h - 2)
        // The TV at the body's top; the face under it, within the body.
        expect(layout.tv.y - layout.body.y).toBeLessThanOrEqual(2)
        expect(layout.tv.y + layout.tv.h + 3).toBeLessThanOrEqual(layout.body.y + layout.body.h)
        // The ✕ on the body's top right.
        expect(layout.close.x + 3).toBeLessThanOrEqual(layout.body.x + layout.body.w)
        expect(layout.close.y).toBeLessThan(layout.tv.y + 1)
      }
    }
  })

  test('the glass holds 5 to 14 rows and 22 columns at least; a pane too short or too narrow has no TV', () => {
    expect(tvLayoutOf('clawd', 72, 36)?.screen).toBe(14)
    expect(tvLayoutOf('clawd', 72, 20)?.screen).toBe(5)
    expect(tvLayoutOf('clawd', 72, 19)).toBe(undefined)
    expect(tvLayoutOf('usagi', 72, 19)?.screen).toBe(5)
    expect(tvLayoutOf('usagi', 72, 18)).toBe(undefined)
    expect(tvLayoutOf('clawd', 46, 36)?.content).toBe(22)
    expect(tvLayoutOf('clawd', 44, 36)).toBe(undefined)
    expect(tvLayoutOf('clawd', Number.NaN, 36)).toBe(undefined)
  })
})

describe('the giant', () => {
  test('Clawd: its eyes under the TV and none on it; its arms out of its torso, as long either side; its legs under it; its cap on its head, the session\'s crown centred', () => {
    const layout = tvLayoutOf('clawd', 72, 36)!
    const giant = giantOf(CLAWD, shapeOf(layout))
    const eyes = quartersWith(giant, 'K')
    expect(eyes.length).toBeGreaterThan(0)
    for (const eye of eyes) {
      expect(eye.y).toBeGreaterThanOrEqual((layout.tv.y + layout.tv.h) * 2)
      expect(eye.y).toBeLessThan((layout.body.y + layout.body.h) * 2)
    }
    // Two eyes, as far from the body's middle either side.
    const middle = (layout.body.x * 2 + layout.body.w)
    const lefts = eyes.filter(eye => eye.x < middle).length
    expect(lefts).toBe(eyes.length / 2)
    // The arms: drawn past the body on both sides, the same quarters.
    const row = giant.bitmap.find(line => line[0] === '#' || line[1] === '#') ?? ''
    expect(row.length).toBe(layout.width * 2)
    expect([...row].reverse().join('')).toBe(row)
    // Legs under the body: drawn on the box's last row, none beside the body.
    const last = giant.bitmap.at(-1) ?? ''
    expect(last.includes('#')).toBe(true)
    expect(last.slice(0, layout.body.x * 2).includes('#')).toBe(false)
    // The cap over the body's top, in its own colour.
    const above = giant.bitmap.slice(0, layout.body.y * 2).join('')
    expect([...above].some(key => key !== '.' && giant.palette[key] === '#38905A')).toBe(true)
    const crowned = giantOf(whoOfMain('clawd'), shapeOf(layout))
    const crown = quartersWith(crowned, Object.entries(crowned.palette).find(([, colour]) => colour === '#A6801F')?.[0] ?? '?')
    const centre = crown.reduce((sum, one) => sum + one.x, 0) / crown.length
    expect(Math.abs(centre - (layout.body.x * 2 + layout.body.w))).toBeLessThanOrEqual(1)
  })

  test('Usagi: its ears and hat over its head; under the TV its eyes, then its cheeks and mouth; shut, no eyes; scared, wider ones', () => {
    const layout = tvLayoutOf('usagi', 72, 36)!
    const giant = giantOf(USAGI, shapeOf(layout))
    const below = (layout.tv.y + layout.tv.h) * 2
    const keyOf = (colour: string): string => Object.entries(giant.palette).find(([, one]) => one === colour)?.[0] ?? '?'
    for (const colour of ['#2B211C', '#F2A0AE', '#6B2D2A']) {
      const found = quartersWith(giant, keyOf(colour))
      expect(found.length, colour).toBeGreaterThan(0)
      for (const one of found) expect(one.y, colour).toBeGreaterThanOrEqual(below)
    }
    const eyeRow = Math.min(...quartersWith(giant, keyOf('#2B211C')).map(one => one.y))
    const cheekRow = Math.min(...quartersWith(giant, keyOf('#F2A0AE')).map(one => one.y))
    expect(cheekRow).toBeGreaterThan(eyeRow)
    // The fedora's colours over the head's top.
    const hat = quartersWith(giant, keyOf('#9A6A3A'))
    expect(hat.length).toBeGreaterThan(0)
    for (const one of hat) expect(one.y).toBeLessThan(layout.body.y * 2 + 2)
    expect(quartersWith(giantOf(USAGI, shapeOf(layout), 'shut'), keyOf('#2B211C'))).toHaveLength(0)
    expect(quartersWith(giantOf(USAGI, shapeOf(layout), 'wide'), keyOf('#2B211C')).length).toBeGreaterThan(quartersWith(giant, keyOf('#2B211C')).length)
  })

  test('the sprite: the scene\'s mascot cut to what is drawn; its eye notches filled dark so the pane never shows through; the gaps between its legs left clear', () => {
    const sprite = spriteOf(CLAWD, 'open')
    const extent = extentOf(sprite)
    expect(extent).toEqual({ x: 0, y: 0, w: sprite.bitmap[0]?.length, h: sprite.bitmap.length })
    // Clawd's eyes: two quarters, now dark; under its body the legs' gaps still clear.
    expect(quartersWith(sprite, 'K')).toHaveLength(2)
    const legs = sprite.bitmap.at(-1) ?? ''
    expect(legs.includes('.')).toBe(true)
    expect(holesFilled({ bitmap: ['###', '#.#', '###'], palette: { '#': '#000000' } }).bitmap).toEqual(['###', '#K#', '###'])
    expect(holesFilled({ bitmap: ['###', '#.#', '#.#'], palette: { '#': '#000000' } }).bitmap).toEqual(['###', '#.#', '#.#'])
    // Usagi keeps its own eyes.
    expect(quartersWith(spriteOf(USAGI, 'open'), 'K').length).toBeGreaterThan(0)
  })
})

describe('presses and keys', () => {
  test('on the TV: the ✕ closes; the channel panel\'s knob and ▶ go on a channel, its ◀ back; the scroll panel\'s ▲ and ▼ a row, its knob a glassful; a tab on the glass presses it; the mascot itself is inside; anywhere else outside', () => {
    const inputs = inputsOf()
    const { layout } = inputs
    const at = (fx: number, fy: number) => tvHitAt(inputs, 0, layout.left + fx, layout.top + fy)
    const text = (row: number) => layout.glass.y + 1 + row
    expect(at(layout.close.x + 1, layout.close.y)).toEqual({ kind: 'close' })
    // The channel panel (screen 14: a blank, the knob, CH, ◀ ▶).
    expect(at(layout.channel.x + 1, text(1))).toEqual({ kind: 'channel', by: 1 })
    expect(at(layout.channel.x, text(4))).toEqual({ kind: 'channel', by: -1 })
    expect(at(layout.channel.x + layout.channel.w - 1, text(4))).toEqual({ kind: 'channel', by: 1 })
    // The scroll panel: its knob, then ▲ and ▼.
    expect(at(layout.scroll.x + 1, text(1))).toEqual({ kind: 'page', by: -1 })
    expect(at(layout.scroll.x + 1, text(2))).toEqual({ kind: 'page', by: 1 })
    expect(at(layout.scroll.x + 1, text(3))).toEqual({ kind: 'scroll', by: -1 })
    expect(at(layout.scroll.x + 1, text(4))).toEqual({ kind: 'scroll', by: 1 })
    // The tabs on the glass's second row: `Task   [ Trail ]  Said   Agents`.
    expect(at(layout.glass.x + 1, text(1))).toEqual({ kind: 'press', key: 'tab:task' })
    expect(at(layout.glass.x + 1 + 'Task   [ Trail ]  '.length, text(1))).toEqual({ kind: 'press', key: 'tab:said' })
    expect(at(layout.glass.x + 3, text(5))).toEqual({ kind: 'inside' })
    // The body, an arm (drawn), and the room beside it.
    expect(at(layout.body.x + 1, layout.body.y + layout.body.h - 1)).toEqual({ kind: 'inside' })
    const drawn = (fx: number, fy: number) => fx === 0 && fy === layout.body.y + layout.body.h - 2
    expect(tvHitAt(inputs, 0, layout.left, layout.top + layout.body.y + layout.body.h - 2, drawn)).toEqual({ kind: 'inside' })
    expect(tvHitAt(inputs, 0, layout.left, layout.top + layout.body.y, drawn)).toEqual({ kind: 'outside' })
    expect(tvHitAt(inputs, 0, 0, 0)).toEqual({ kind: 'outside' })
    expect(tvHitAt(inputs, 0, 71, 35)).toEqual({ kind: 'outside' })
  })

  test('keys: ← → change channel, ↑ ↓ a row, the page keys and space a glassful, Home and End all the way, q or x close; anything else nothing', () => {
    expect(tvKeyOf('left')).toEqual({ kind: 'channel', by: -1 })
    expect(tvKeyOf('right')).toEqual({ kind: 'channel', by: 1 })
    expect(tvKeyOf('up')).toEqual({ kind: 'scroll', by: -1 })
    expect(tvKeyOf('down')).toEqual({ kind: 'scroll', by: 1 })
    expect(tvKeyOf('pageup')).toEqual({ kind: 'page', by: -1 })
    expect(tvKeyOf('pagedown')).toEqual({ kind: 'page', by: 1 })
    expect(tvKeyOf(' ')).toEqual({ kind: 'page', by: 1 })
    expect(tvKeyOf('home')?.kind).toBe('scroll')
    expect(tvKeyOf('q')).toEqual({ kind: 'close' })
    expect(tvKeyOf('x')).toEqual({ kind: 'close' })
    expect(tvKeyOf('return')).toBe(undefined)
  })

  test('channels go round the tabs; the glass keeps its head pinned and scrolls the tab\'s rows within them, its thumb where they are', () => {
    const inputs = inputsOf()
    expect(channelOf(inputs, 1)).toBe('said')
    expect(channelOf({ ...inputs, tab: 'agents' }, 1)).toBe('task')
    expect(channelOf({ ...inputs, tab: 'task' }, -1)).toBe('agents')
    // 30 rows under a head of 3 on 14 rows of glass: 19 rows of scroll.
    expect(maxScrollOf(inputs)).toBe(19)
    expect(scrolledBy(inputs, 0, -5)).toBe(0)
    expect(scrolledBy(inputs, 18, 5)).toBe(19)
    const shown = shownRows(inputs, 4)
    expect(shown.slice(0, 3)).toEqual(HEAD)
    expect(shown[3]?.key).toBe('row4')
    expect(shown).toHaveLength(14)
    expect(thumbOf(inputs, 0)?.from).toBe(0)
    const thumb = thumbOf(inputs, 19)
    expect((thumb?.from ?? 0) + (thumb?.length ?? 0)).toBe(11)
    expect(thumbOf({ ...inputs, body: rowsOf(5) }, 0)).toBe(undefined)
  })
})

describe('its life', () => {
  test('opening: it flies from where the mascot stood, grows, and the glass switches on, a line widening into the picture; the channel\'s number shows a moment', () => {
    const tv = createTv(inputsOf(CLAWD, { from: { x: 20, y: 30 } }))
    expect(tv.phase).toBe('travel')
    const looks = []
    for (let frame = 0; frame < 30 && tv.phase !== 'on'; frame += 1) {
      looks.push(lookOf(tv))
      tickTv(tv, () => {})
    }
    expect(looks).toHaveLength(TV_FRAMES.travel + TV_FRAMES.grow + TV_FRAMES['power-on'])
    expect(looks[0]?.form).toBe('sprite')
    expect(looks.filter(look => look?.form === 'giant' && look.glass.kind === 'line').length).toBeGreaterThan(0)
    expect(looks.filter(look => look?.form === 'giant' && look.glass.kind === 'open').length).toBeGreaterThan(0)
    expect(lookOf(tv)).toMatchObject({ form: 'giant', glass: { kind: 'on' } })
    expect(osdOf(tv)).toBe('CH 2')
    for (let frame = 0; frame < 40; frame += 1) tickTv(tv, () => {})
    expect(osdOf(tv)).toBe(undefined)
    // Where it is not known, it grows where it stands, no flight.
    expect(createTv(inputsOf()).phase).toBe('grow')
  })

  test('closing: a press outside switches the glass off, a line then a dot; it shrinks and flies home; then the close is posted, once; presses while it closes do nothing; gone, a press posts it again', () => {
    const tv = createTv(inputsOf(CLAWD, { from: { x: 20, y: 30 } }))
    const posts: TvPost[] = []
    switchedOn(tv, posts)
    click(tv, 0, 0, posts)
    expect(tv.phase).toBe('power-off')
    const glasses: string[] = []
    let frames = 0
    while (tv.phase !== 'gone' && frames < 60) {
      const look = lookOf(tv)
      if (look?.form === 'giant') glasses.push(look.glass.kind)
      click(tv, 0, 0, posts)
      tickTv(tv, post => posts.push(post))
      frames += 1
    }
    expect(glasses).toContain('line')
    expect(glasses).toContain('dot')
    expect(frames).toBe(TV_FRAMES['power-off'] + TV_FRAMES.shrink + TV_FRAMES.return)
    expect(posts).toEqual([{ kind: 'tv', close: true }])
    pointerTv(tv, { type: 'down', x: 3, y: 3, button: 'left' }, post => posts.push(post))
    expect(posts).toHaveLength(2)
  })

  test('the ✕, and q or x, close it as a press outside does; closing as it opens turns it home from where it got to', () => {
    const inputs = inputsOf(CLAWD, { from: { x: 20, y: 30 } })
    const tv = createTv(inputs)
    switchedOn(tv)
    const { layout } = inputs
    click(tv, layout.left + layout.close.x + 1, layout.top + layout.close.y, [])
    expect(tv.phase).toBe('power-off')
    const keyed = createTv(inputs)
    switchedOn(keyed)
    expect(keyTv(keyed, { key: 'q' }, () => {})).toBe(true)
    expect(keyed.phase).toBe('power-off')
    const early = createTv(inputs)
    tickTv(early, () => {})
    tickTv(early, () => {})
    click(early, 0, 0, [])
    expect(early.phase).toBe('return')
    const growing = createTv(inputs)
    for (let frame = 0; frame < TV_FRAMES.travel + 1; frame += 1) tickTv(growing, () => {})
    click(growing, 0, 0, [])
    expect(growing.phase).toBe('shrink')
  })

  test('a channel from its panel or the arrow keys is posted for the hooks, round the tabs; a tab or any press on the glass too; nothing while it opens', () => {
    const inputs = inputsOf()
    const { layout } = inputs
    const tv = createTv(inputs)
    const posts: TvPost[] = []
    click(tv, layout.left + layout.channel.x + 1, layout.top + layout.glass.y + 2, posts)
    expect(posts).toEqual([])
    switchedOn(tv)
    click(tv, layout.left + layout.channel.x + 1, layout.top + layout.glass.y + 2, posts)
    keyTv(tv, { key: 'left' }, post => posts.push(post))
    click(tv, layout.left + layout.glass.x + 1, layout.top + layout.glass.y + 2, posts)
    expect(posts).toEqual([{ kind: 'tv', tab: 'said' }, { kind: 'tv', tab: 'task' }, { kind: 'tv', press: 'tab:task' }])
    // A press let go elsewhere than it went down: nothing.
    pointerTv(tv, { type: 'down', x: layout.left + layout.glass.x + 1, y: layout.top + layout.glass.y + 2, button: 'left' }, post => posts.push(post))
    pointerTv(tv, { type: 'up', x: layout.left + layout.glass.x + 3, y: layout.top + layout.glass.y + 8, button: 'left' }, post => posts.push(post))
    expect(posts).toHaveLength(3)
  })

  test('▲ and ▼ scroll a row as they go down and repeat while held; the knob and the page keys a glassful; Home and End all the way', () => {
    const inputs = inputsOf()
    const { layout } = inputs
    const tv = createTv(inputs)
    switchedOn(tv)
    const down = { x: layout.left + layout.scroll.x + 1, y: layout.top + layout.glass.y + 1 + 4 }
    pointerTv(tv, { type: 'down', ...down, button: 'left' }, () => {})
    expect(tv.scroll).toBe(1)
    for (let ms = 0; ms < REPEAT_DELAY_MS + 2 * REPEAT_MS; ms += TV_FRAME_MS) tickTv(tv, () => {})
    expect(tv.scroll).toBeGreaterThanOrEqual(3)
    pointerTv(tv, { type: 'up', ...down, button: 'left' }, () => {})
    const held = tv.scroll
    for (let frame = 0; frame < 20; frame += 1) tickTv(tv, () => {})
    expect(tv.scroll).toBe(held)
    keyTv(tv, { key: 'home' }, () => {})
    expect(tv.scroll).toBe(0)
    keyTv(tv, { key: 'pagedown' }, () => {})
    expect(tv.scroll).toBe(10)
    keyTv(tv, { key: 'end' }, () => {})
    expect(tv.scroll).toBe(19)
    keyTv(tv, { key: 'up' }, () => {})
    expect(tv.scroll).toBe(18)
  })

  test('the hooks\' next props: another tab or agent starts the glass at its top through static and shows its channel; a new scroll of the pane\'s moves the glass; an old one does not', () => {
    const tv = createTv(inputsOf(CLAWD, { wheel: { seq: 4, by: 1 } }))
    switchedOn(tv)
    receiveTv(tv, inputsOf(CLAWD, { wheel: { seq: 4, by: 1 } }))
    expect(tv.scroll).toBe(0)
    receiveTv(tv, inputsOf(CLAWD, { wheel: { seq: 5, by: 3 } }))
    expect(tv.scroll).toBe(3)
    receiveTv(tv, inputsOf(CLAWD, { wheel: { seq: 6, by: 1, page: true } }))
    expect(tv.scroll).toBe(13)
    receiveTv(tv, inputsOf(CLAWD, { tab: 'said', view: 'a:said', wheel: { seq: 6, by: 1, page: true } }))
    expect(tv.scroll).toBe(0)
    expect(tv.flicker).toBe(FLICKER_FRAMES)
    expect(lookOf(tv)).toMatchObject({ glass: { kind: 'static' } })
    expect(osdOf(tv)).toBe('CH 3')
    for (let frame = 0; frame < FLICKER_FRAMES; frame += 1) tickTv(tv, () => {})
    expect(lookOf(tv)).toMatchObject({ glass: { kind: 'on' } })
    // Fewer rows: the scroll kept within them.
    tv.scroll = 19
    receiveTv(tv, inputsOf(CLAWD, { tab: 'said', view: 'a:said', body: rowsOf(12) }))
    expect(tv.scroll).toBe(1)
  })

  test('its posts read back plain; anything else is none of its', () => {
    expect(tvPostOf({ kind: 'tv', close: true })).toEqual({ kind: 'tv', close: true })
    expect(tvPostOf({ kind: 'tv', tab: 'said' })).toEqual({ kind: 'tv', tab: 'said' })
    expect(tvPostOf({ kind: 'tv', press: 'cost:opus-5-5' })).toEqual({ kind: 'tv', press: 'cost:opus-5-5' })
    for (const data of [null, 'tv', { kind: 'inspect', id: 'a' }, { kind: 'tv' }, { kind: 'tv', tab: '' }, { kind: 'tv', press: 'x'.repeat(301) }, { kind: 'tv', close: 'yes' }]) expect(tvPostOf(data)).toBe(undefined)
  })
})

describe('its rows', () => {
  test('kept within the budget the props allow: the oldest dropped first, one kept whatever its size', () => {
    const big = (index: number): TvRow => ({ key: `r${index}`, cells: [{ text: `${index} `.padEnd(400, 'x') }] })
    const body = Array.from({ length: 400 }, (_, index) => big(index))
    const kept = budgeted(HEAD, body)
    expect(kept.length).toBeLessThan(body.length)
    expect(kept.at(-1)).toBe(body.at(-1))
    expect(JSON.stringify([HEAD, kept]).length).toBeLessThanOrEqual(TV_ROWS_BUDGET + 10)
    expect(budgeted(HEAD, rowsOf(30))).toEqual(rowsOf(30))
    expect(budgeted(HEAD, [{ key: 'one', cells: [{ text: 'x'.repeat(TV_ROWS_BUDGET * 2) }] }])).toHaveLength(1)
  })
})

describe('drawn', () => {
  test('on the terminal: once on, only the figure\'s box drawn, the pane showing through the rest; the glass dark with its rows; the ✕ white on red; every row within the region', () => {
    for (const who of [CLAWD, USAGI]) {
      const inputs = inputsOf(who)
      const { layout } = inputs
      const tv = createTv(inputs)
      switchedOn(tv)
      const grid = paintCells(inputs, lookOf(tv), 0, tv.sprite, undefined)
      expect(grid).toHaveLength(36)
      grid.forEach((row, y) => {
        expect(row).toHaveLength(72)
        row.forEach((cell, x) => {
          if (cell === undefined) return
          expect(x >= layout.left && x < layout.left + layout.width && y >= layout.top && y < layout.top + layout.height, `${who.character} ${x},${y}`).toBe(true)
        })
      })
      const lines = textOf(grid)
      expect(lines[layout.top + layout.glass.y + 1]).toContain('Explore')
      expect(lines[layout.top + layout.glass.y + 2]).toContain('[ Trail ]')
      expect(lines[layout.top + layout.glass.y + 4]).toContain('row 0')
      const glass = grid[layout.top + layout.glass.y + 6]?.[layout.left + layout.glass.x + layout.glass.w - 3]
      expect(glass !== undefined && !('tail' in glass) ? glass.bg : undefined).toBe(TV_COLOURS.glass)
      const close = grid[layout.top + layout.close.y]?.[layout.left + layout.close.x + 1]
      expect(close).toEqual({ ch: '✕', color: '#FFFFFF', bg: TV_COLOURS.close, bold: true })
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(72)
    }
  })

  test('its glass switching off: a bright line across its middle, then a dot; static after a channel change', () => {
    const inputs = inputsOf()
    const { layout } = inputs
    const middle = layout.top + layout.glass.y + 1 + Math.floor((layout.screen - 1) / 2)
    const line = textOf(paintCells(inputs, tvLookAt('power-off', 2), 0, spriteOf(CLAWD)))[middle] ?? ''
    expect(line).toContain('━'.repeat(layout.content - 2))
    const dot = textOf(paintCells(inputs, tvLookAt('power-off', 5), 0, spriteOf(CLAWD)))[middle] ?? ''
    expect(dot).toContain('●')
    const noise = textOf(paintCells(inputs, tvLookAt('on', 0, 2), 0, spriteOf(CLAWD))).join('')
    expect(/[░▒▓]/.test(noise)).toBe(true)
  })

  test('on the desktop: one document the region\'s size, the pane dimmed under it; as it flies, the sprite alone', () => {
    const inputs = inputsOf(USAGI, { svg: true, from: { x: 20, y: 30 } })
    const tv = createTv(inputs)
    const flying = paintSvg(inputs, lookOf(tv), 0, tv.sprite)
    expect([flying.width, flying.height]).toEqual([72 * 8, 36 * 16])
    expect(flying.source.startsWith('<svg ')).toBe(true)
    expect(flying.source).not.toContain(TV_COLOURS.glass)
    switchedOn(tv)
    const on = paintSvg(inputs, lookOf(tv), 0, tv.sprite)
    expect(on.source).toContain(`fill='#000000' opacity='0.5'`)
    expect(on.source).toContain(TV_COLOURS.glass)
    expect(on.source).toContain('Explore')
    expect(on.source.match(/<svg /g)?.length).toBeGreaterThan(1)
  })
})

describe('back from the TV', () => {
  test('shaken for three seconds: it shakes its head, looking left then right, then stands wide-eyed, arms down; a sweat drop and a `!?` all along', () => {
    const heads = Array.from({ length: Math.floor(SHAKE_MS / SHAKE_STEP_MS) }, (_, turn) => startledLook(turn * SHAKE_STEP_MS).head)
    expect(new Set(heads)).toEqual(new Set(['left', 'right']))
    expect(heads[0]).not.toBe(heads[1])
    expect(startledLook(0).nudge).toBeDefined()
    expect(startledLook(SHAKE_MS).head).toBe('wide')
    expect(startledLook(SHAKE_MS).arms).toBe('low')
    expect(startledLook(SHAKE_MS).nudge).toBe(undefined)
    for (const ms of [0, SHAKE_MS, STARTLED_MS - 1]) expect(startledLook(ms).overlays).toContain(OVERLAYS.startle[0])
  })

  test('the smooth scene counts the three seconds on its own clock, from when it hears the mascot is back; out of the choreography meanwhile', () => {
    const world = createWorld(sceneInputs([TYPIST]))
    expect(layoutAt(world, 0).startled).toBe(undefined)
    // The hooks' clock says long ago; the scene counts from now all the same.
    receive(world, { ...world.props, now: NOW, startled: { id: 'a', at: NOW - 60_000 } })
    expect(layoutAt(world, 0).startled).toEqual({ id: 'a', ms: 0 })
    expect(layoutAt(world, 0).held).toContain('a')
    for (let ms = 0; ms < 1000; ms += FRAME_MS) tick(world)
    expect(layoutAt(world, 0).startled?.ms).toBe(1000)
    for (let ms = 0; ms < STARTLED_MS; ms += FRAME_MS) tick(world)
    expect(layoutAt(world, 0).startled).toBe(undefined)
    expect(layoutAt(world, 0).held).not.toContain('a')
    // In the TV: out of it, held, not drawn.
    receive(world, { ...world.props, away: 'a', startled: undefined })
    expect(layoutAt(world, 0)).toMatchObject({ away: 'a', held: ['a'] })
  })

  test('in the scene: the mascot in the TV is not drawn; back, it is shaken till three seconds are up; Usagi shouts HUHHH?!', () => {
    const scene = sceneOf([TYPIST], idleHud, idleHud.now ?? 0)
    const layout = { columns: 40, rows: 6, tick: 0 }
    const drawn = (extra: object) => (mascotLines(scene, { ...layout, ...extra }) ?? []).join('\n')
    const typist = drawn({})
    expect(drawn({ away: 'a', held: ['a'] })).not.toBe(typist)
    expect(drawn({ startled: { id: 'a', ms: 100 } })).toContain('!?')
    expect(drawn({ startled: { id: 'a', ms: STARTLED_MS } })).not.toContain('!?')
    // Usagi: its shout for Clawd's `!?`.
    const usagi = drawUsagi(startledLook(SHAKE_MS), dressOfAgent(scene.agents[0]!))
    expect(usagi.map(row => row.map(cell => cell?.ch ?? ' ').join('')).join('\n')).toContain(String(STARTLED.art.join('').trim()))
  })
})

describe('in the pane', () => {
  type Clients = { redraw: () => Promise<void>; findAll: (query: { type: string }) => Promise<{ key?: string; props: Record<string, unknown> }[]> }
  const clientsOf = async (ui: Clients): Promise<Record<string, { key?: string; props: Record<string, unknown> } | undefined>> => {
    await ui.redraw()

    return Object.fromEntries((await ui.findAll({ type: 'Client' })).map(one => [one.key ?? '', one]))
  }

  test('a click on a mascot grows it into its TV over the pane: the HUD, lists and scene stay under it, the mascot out of the scene; terminal and desktop', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    for (const surface of ['terminal', 'desktop'] as const) {
      held.set('selected', { value: null, version: (held.get('selected')?.version ?? 0) + 1 })
      const ui = await mount($, surface, 72, 36)
      await ui.post({ kind: 'inspect', id: 'a', at: { x: 10, y: 1 } }, { in: 'mascots' })
      expect(held.get('selected')?.value as HudSelection).toEqual({ id: 'a', kind: 'agent' })
      const clients = await clientsOf(ui)
      const tv = clients.tv
      expect(tv?.props.module).toBe('hooks/tv-client.tsx')
      expect([tv?.props.width, tv?.props.height]).toEqual([72, 36])
      const inputs = tv?.props.props as TvInputs
      expect(inputs.layout).toEqual(tvLayoutOf('clawd', 72, 36))
      expect(inputs.tabs).toEqual(['task', 'trail', 'said', 'agents'])
      expect(inputs.tab).toBe('task')
      expect(inputs.view).toBe('a:task')
      expect(inputs.head[1]?.cells.some(cell => 'press' in cell && cell.press === 'tab:task' && cell.primary === true)).toBe(true)
      expect(inputs.who.character).toBe('clawd')
      expect(inputs.svg).toBe(surface === 'desktop' ? true : undefined)
      // It flies from where the mascot stood: the scene's region starts where the pane's rows leave it.
      const scene = clients.mascots
      expect(inputs.from?.x).toBe(10)
      expect(inputs.from?.y).toBe(36 - Number(scene?.props.height) + 1)
      // The scene runs on under it, the mascot out of it.
      expect((scene?.props.props as SceneInputs).away).toBe('a')
      expect((scene?.props.props as SceneInputs & { paused?: boolean }).paused).toBe(undefined)
      expect(await ui.find({ key: 'agents' })).toBeDefined()
      expect(await ui.find({ key: 'detail:back' })).toBe(undefined)
      // Its drawing: on after the opening, the task's title on its glass.
      await ui.advance((TV_FRAMES.travel + TV_FRAMES.grow + TV_FRAMES['power-on'] + 1) * TV_FRAME_MS)
      if (surface === 'desktop') expect(String((await ui.find({ type: 'Svg', in: 'tv' }))?.props.source)).toContain('Task a')
      else expect((await ui.findAll({ type: 'Box', in: 'tv' })).map(box => box.text).join('\n')).toContain('Task a')
      await ui.unmount()
    }
  })

  test('its posts: a channel, a press on its glass, and the close, after which the mascot is back in the scene, shaken', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    const ui = await mount($, 'terminal', 72, 36)
    await ui.post({ kind: 'inspect', id: 'a' }, { in: 'mascots' })
    await ui.redraw()
    await ui.post({ kind: 'tv', tab: 'trail' }, { in: 'tv' })
    expect((held.get('selected')?.value as HudSelection).tab).toBe('trail')
    await ui.redraw()
    await ui.post({ kind: 'tv', press: 'tab:said' }, { in: 'tv' })
    expect((held.get('selected')?.value as HudSelection).tab).toBe('said')
    await ui.redraw()
    await ui.post({ kind: 'tv', tab: 'nonsense' }, { in: 'tv' })
    expect((held.get('selected')?.value as HudSelection).tab).toBe('said')
    await ui.post({ kind: 'tv', close: true }, { in: 'tv' })
    expect(held.get('selected')?.value).toBe(null)
    const clients = await clientsOf(ui)
    expect(clients.tv).toBe(undefined)
    const scene = clients.mascots?.props.props as SceneInputs
    expect(scene.away).toBe(undefined)
    expect(scene.startled?.id).toBe('a')
    await ui.unmount()
  })

  test('the Agents channel: the lists on its glass, a press of an agent\'s ▸ there keeping that channel', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    const ui = await mount($, 'terminal', 72, 36)
    await ui.post({ kind: 'inspect', id: 'a' }, { in: 'mascots' })
    await ui.redraw()
    await ui.post({ kind: 'tv', tab: 'agents' }, { in: 'tv' })
    const inputs = (await clientsOf(ui)).tv?.props.props as TvInputs
    expect(inputs.body.some(row => row.cells.some(cell => 'press' in cell && cell.press === 'inspect:a'))).toBe(true)
    await ui.post({ kind: 'tv', press: 'inspect:main' }, { in: 'tv' })
    expect(held.get('selected')?.value).toEqual({ id: 'main', kind: 'main', tab: 'agents' })
    await ui.unmount()
  })

  test('the session\'s crowned mascot opens its Overview channel; Usagi\'s TV is Usagi', { options: { character: 'usagi' } }, async ($, on) => {
    arrange(on, [TYPIST])
    const ui = await mount($, 'desktop', 72, 36)
    await ui.post({ kind: 'inspect', id: 'main' }, { in: 'mascots' })
    const inputs = (await clientsOf(ui)).tv?.props.props as TvInputs
    expect(inputs.tabs).toEqual(['overview', 'cost', 'agents'])
    expect(inputs.who).toEqual({ character: 'usagi', colour: '#F3DC8C', crown: true })
    expect(inputs.layout).toEqual(tvLayoutOf('usagi', 72, 36))
    await ui.unmount()
  })

  test('with inspectView pane, in a pane too short for it, and on VS Code and mobile, the inspect view under the HUD', { options: { inspectView: 'pane' } }, async ($, on) => {
    arrange(on, [TYPIST])
    const ui = await mount($, 'terminal', 72, 36)
    await ui.post({ kind: 'inspect', id: 'a' }, { in: 'mascots' })
    expect((await clientsOf(ui)).tv).toBe(undefined)
    expect(await ui.find({ key: 'detail:back' })).toBeDefined()
    await ui.unmount()
  })

  test('a pane too short for the TV, and VS Code and mobile, draw the inspect view under the HUD', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    held.set('selected', { value: { id: 'a', kind: 'agent' }, version: 1 })
    const short = await mount($, 'terminal', 72, 16)
    await short.redraw()
    expect((await short.findAll({ type: 'Client' })).some(one => one.key === 'tv')).toBe(false)
    expect(await short.find({ key: 'detail:back' })).toBeDefined()
    await short.unmount()
    for (const surface of ['vscode', 'mobile'] as const) {
      const ui = await mount($, surface, 72, 36)
      await ui.redraw()
      expect(await ui.find({ key: 'detail:back' })).toBeDefined()
      await ui.unmount()
    }
  })
})
