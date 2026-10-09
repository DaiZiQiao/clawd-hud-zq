import { describe, expect, mock, test } from 'claude-code/testing'

import type { Shape } from './clawd-vector'
import { countColour, pngPixels } from './png.fixtures'
import { arrange, mount } from './scene-client.fixtures'
import { TYPIST } from './scene-world.fixtures'
import { EYE } from './smooth-art'
import { spriteOf } from './tv-figure'
import type { Who } from './tv-figure'
import { TV_FRAMES, TV_FRAME_MS, tvLayoutOf, tvLookAt } from './tv-model'
import type { TvInputs, TvRow } from './tv-model'
import { paintCells, paintSvg } from './tv-paint'
import { casingOf, giantPicture, giantShapes, spriteShapes } from './tv-smooth'
import { BLINK_EVERY_MS, createTv, startClose, tickTv, tvPostOf } from './tv-world'
import type { TvPost } from './tv-world'
import { USAGI } from './usagi-sprites'

// The TV drawn smooth (hooks/tv-smooth.ts): the giant and the figure flying
// in as the vector art draws them, on the desktop in its document, and in a
// terminal that shows pictures the giant a picture the hooks draw under the
// module's glass.

const CLAWD: Who = { character: 'clawd', colour: '#886CD4', crown: true }
const BUNNY: Who = { character: 'usagi', colour: USAGI.body, hat: 'fedora' }
const GHOSTTY = { TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' }

const HEAD: TvRow[] = [{ key: 'title', cells: [{ text: 'Explore', bold: true }] }]
const BODY: TvRow[] = Array.from({ length: 30 }, (_, index) => ({ key: `row${index}`, cells: [{ text: `row ${index}` }] }))

const inputsOf = (who: Who, extra: Partial<TvInputs> = {}): TvInputs => ({
  columns: 72,
  rows: 36,
  layout: tvLayoutOf(who.character, 72, 36)!,
  who,
  head: HEAD,
  body: BODY,
  tabs: ['task', 'trail'],
  tab: 'trail',
  view: 'a:trail',
  ...extra,
})

/** The shapes' bounds in the region's pixels, each through its own placement. */
const boundsOf = (shapes: readonly Shape[]): { left: number; top: number; right: number; bottom: number } => {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (const shape of shapes) {
    if ((shape.alpha ?? 1) < 0.05 || shape.kind === 'text') continue
    const m = shape.m ?? [1, 0, 0, 1, 0, 0]
    const corners: (readonly [number, number])[] = shape.kind === 'poly' || shape.kind === 'line' ? [...(shape.points ?? [])] : [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x, shape.y + shape.h], [shape.x + shape.w, shape.y + shape.h]]
    for (const [x, y] of corners) {
      const px = m[0] * x + m[2] * y + m[4]
      const py = m[1] * x + m[3] * y + m[5]
      bounds.left = Math.min(bounds.left, px)
      bounds.top = Math.min(bounds.top, py)
      bounds.right = Math.max(bounds.right, px)
      bounds.bottom = Math.max(bounds.bottom, py)
    }
  }

  return bounds
}

describe('the giant, smooth', () => {
  test('inside its box, both mascots, whatever they wear: its body the casing round the TV, its eyes a row under it, a line as it blinks', () => {
    for (const who of [CLAWD, { ...CLAWD, crown: undefined, accessory: 'bow' as const, side: 'right' as const }, BUNNY, { ...BUNNY, hat: undefined, crown: true as const }]) {
      const { layout } = inputsOf(who)
      const box = { left: layout.left * 8, top: layout.top * 16, right: (layout.left + layout.width) * 8, bottom: (layout.top + layout.height) * 16 }
      const shapes = giantShapes(who, layout)
      const bounds = boundsOf(shapes)
      expect(bounds.left, who.character).toBeGreaterThanOrEqual(box.left - 0.5)
      expect(bounds.top, who.character).toBeGreaterThanOrEqual(box.top - 0.5)
      expect(bounds.right, who.character).toBeLessThanOrEqual(box.right + 0.5)
      expect(bounds.bottom, who.character).toBeLessThanOrEqual(box.bottom + 0.5)
      // The casing: a shape of its colour (Usagi's cream) covering the TV.
      const tv = { x: box.left + layout.tv.x * 8, y: box.top + layout.tv.y * 16, w: layout.tv.w * 8, h: layout.tv.h * 16 }
      expect(shapes.some(one => one.kind === 'rect' && one.fill === casingOf(who) && one.x <= tv.x && one.y <= tv.y && one.x + one.w >= tv.x + tv.w && one.y + one.h >= tv.y + tv.h)).toBe(true)
      // Its eyes: two, under the TV.
      const eye = who.character === 'usagi' ? USAGI.eye : EYE
      const eyes = (eyesOf: 'open' | 'shut') => giantShapes(who, layout, eyesOf).filter(one => one.fill === eye)
      expect(eyes('open')).toHaveLength(2)
      for (const one of eyes('open')) expect(one.y).toBeGreaterThanOrEqual(tv.y + tv.h)
      for (const one of eyes('shut')) expect(one.kind === 'text' ? 0 : one.h).toBeLessThanOrEqual(6)
    }
  })

  test('what it wears over its head, in the rows over its body (tucked behind the TV\'s top at most): Clawd\'s crown, Usagi\'s hat between its ears, in flight the propeller cap', () => {
    for (const who of [CLAWD, BUNNY, { ...CLAWD, crown: undefined, cap: true as const }, { ...BUNNY, cap: true as const }]) {
      const { layout } = inputsOf(who)
      const bare = giantShapes({ character: who.character, colour: who.colour }, layout)
      const worn = giantShapes(who, layout)
      expect(worn.length, JSON.stringify(who)).toBeGreaterThan(bare.length)
      const extra = boundsOf(worn.slice(bare.length))
      expect(extra.top).toBeLessThan((layout.top + layout.body.y) * 16 - 16)
      expect(extra.bottom).toBeLessThanOrEqual((layout.top + layout.tv.y + 1) * 16)
    }
  })

  test('a picture of its box: a PNG a cell 8 by 16 pixels, in its colours on a clear ground; its eyes shut, another', () => {
    const { layout } = inputsOf(CLAWD)
    const open = giantPicture(CLAWD, layout, 'open')
    const picture = pngPixels(open)
    expect([picture.width, picture.height]).toEqual([layout.width * 8, layout.height * 16])
    expect(countColour(picture, CLAWD.colour)).toBeGreaterThan(layout.body.w * layout.body.h * 32)
    expect(picture.pixels[3]).toBe(0)
    expect(giantPicture(CLAWD, layout, 'shut')).not.toBe(open)
  })
})

describe('flying in, smooth', () => {
  test('the scene\'s figure from where it stood (its middle over its body, its feet on its sprite\'s floor), at its scene size; at the last as big as the giant\'s box holds it, its proportions kept', () => {
    for (const who of [CLAWD, BUNNY]) {
      const inputs = inputsOf(who, { from: { x: 10, y: 20 } })
      const { layout } = inputs
      const start = boundsOf(spriteShapes(inputs, 0, 0, 'wide', 0))
      expect(Math.abs((start.left + start.right) / 2 - 14.5 * 8)).toBeLessThan(2)
      expect(Math.abs(start.bottom - (20 + (who.character === 'usagi' ? 5 : 4.5)) * 16)).toBeLessThan(2)
      expect(start.right - start.left).toBeLessThan(80)
      const grown = boundsOf(spriteShapes(inputs, 1, 1, 'wide', 0))
      const box = { left: layout.left * 8, top: layout.top * 16, right: (layout.left + layout.width) * 8, bottom: (layout.top + layout.height) * 16 }
      expect(grown.left).toBeGreaterThanOrEqual(box.left - 1)
      expect(grown.right).toBeLessThanOrEqual(box.right + 1)
      expect(grown.top).toBeGreaterThanOrEqual(box.top - 1)
      expect(grown.bottom).toBeLessThanOrEqual(box.bottom + 1)
      // As big as the box holds it, its proportions kept: as tall as the box, or as wide.
      expect(Math.max((grown.right - grown.left) / (box.right - box.left), (grown.bottom - grown.top) / (box.bottom - box.top))).toBeGreaterThan(0.9)
      const own = boundsOf(spriteShapes({ ...inputs, from: undefined }, 1, 0, 'wide', 0))
      expect(Math.abs((grown.right - grown.left) / (grown.bottom - grown.top) - (own.right - own.left) / (own.bottom - own.top))).toBeLessThan(0.05)
    }
  })
})

describe('the TV with the vector art', () => {
  test('on the desktop the mascot smooth, as it flies and as the giant; the blocks\' quarters without it', () => {
    const smooth = inputsOf(CLAWD, { svg: true, art: 'vector', from: { x: 10, y: 20 } })
    const blocks = inputsOf(CLAWD, { svg: true, from: { x: 10, y: 20 } })
    const runs = (source: string): number => source.split(`fill='${CLAWD.colour}'`).length - 1
    for (const look of [tvLookAt('travel', 2), tvLookAt('on', 0)]) {
      const drawn = paintSvg(smooth, look, 0, spriteOf(CLAWD), undefined, 400).source
      const quartered = paintSvg(blocks, look, 0, spriteOf(CLAWD)).source
      expect(drawn).toContain(`shape-rendering='geometricPrecision'`)
      expect(quartered).not.toContain(`shape-rendering='geometricPrecision'`)
      expect(runs(drawn)).toBeLessThan(runs(quartered))
    }
    expect(paintSvg(smooth, tvLookAt('on', 0), 0, spriteOf(CLAWD)).source).toContain('Explore')
  })

  test('pictured, the module draws no giant: its glass, panel and ✕ alone; the figure on its way as ever', () => {
    const plain = inputsOf(CLAWD)
    const pictured = inputsOf(CLAWD, { pictured: true })
    const { layout } = plain
    const text = (grid: ReturnType<typeof paintCells>): string => grid.map(row => row.map(cell => (cell === undefined ? ' ' : 'tail' in cell ? '' : cell.ch)).join('')).join('\n')
    const on = tvLookAt('on', 0)
    const drawn = paintCells(plain, on, 0, spriteOf(CLAWD))
    const bare = paintCells(pictured, on, 0, spriteOf(CLAWD))
    // Its legs' row: drawn, and not.
    const legs = layout.top + layout.height - 1
    expect(drawn[legs]?.some(cell => cell !== undefined)).toBe(true)
    expect(bare[legs]?.every(cell => cell === undefined)).toBe(true)
    expect(text(bare)).toContain('Explore')
    expect(text(bare)).toContain('✕')
    // The glass's round rows sit on the picture's casing: Usagi's cream, not its cells' yellow.
    const bunny = inputsOf(BUNNY, { pictured: true })
    const round = paintCells(bunny, on, 0, spriteOf(BUNNY))[bunny.layout.top + bunny.layout.glass.y]?.[bunny.layout.left + bunny.layout.glass.x]
    expect(round !== undefined && !('tail' in round) ? round.bg : undefined).toBe(USAGI.cream)
    const flying = tvLookAt('travel', 2)
    expect(text(paintCells(pictured, flying, 0, spriteOf(CLAWD)))).toBe(text(paintCells(plain, flying, 0, spriteOf(CLAWD))))
  })

  test('the module tells the hooks it grew into the giant as it switches on, and that it is shrinking out of it as it closes; nothing else posts it', () => {
    const tv = createTv(inputsOf(CLAWD, { from: { x: 10, y: 20 } }))
    const posts: TvPost[] = []
    const phases: string[] = []
    for (let frame = 0; frame < 40 && tv.phase !== 'on'; frame += 1) {
      tickTv(tv, post => {
        posts.push(post)
        phases.push(tv.phase)
      })
    }
    expect(posts).toEqual([{ kind: 'tv', giant: true }])
    expect(tv.phase).toBe('on')
    startClose(tv)
    for (let frame = 0; frame < 40 && tv.phase !== 'gone'; frame += 1) tickTv(tv, post => posts.push(post))
    expect(posts).toEqual([{ kind: 'tv', giant: true }, { kind: 'tv', giant: false }, { kind: 'tv', close: true }])
    // Closed as it grows, never the giant: nothing of it.
    const early = createTv(inputsOf(CLAWD))
    const heard: TvPost[] = []
    tickTv(early, post => heard.push(post))
    startClose(early)
    for (let frame = 0; frame < 40 && early.phase !== 'gone'; frame += 1) tickTv(early, post => heard.push(post))
    expect(heard).toEqual([{ kind: 'tv', close: true }])
    expect(tvPostOf({ kind: 'tv', giant: true })).toEqual({ kind: 'tv', giant: true })
    expect(tvPostOf({ kind: 'tv', giant: false })).toEqual({ kind: 'tv', giant: false })
    expect(tvPostOf({ kind: 'tv', giant: 'yes' })).toBe(undefined)
  })
})

describe('in a terminal that shows pictures', () => {
  test('grown into the giant, the hooks draw it a picture over its box under the module\'s glass, the module told so; it blinks; shrinking, the picture goes', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = arrange(on, [TYPIST])
    mock.env(on, GHOSTTY)
    const sent: { key: string; png: string }[] = []
    on('ui.blit', (_$, e) => {
      const args = e as unknown as { key: string; source: { png?: string } }
      sent.push({ key: args.key, png: args.source.png ?? '' })

      return { value: {} }
    })
    const ui = await mount($, 'terminal', 72, 36)
    const giantOf = async () => (await ui.findAll({ type: 'Image' })).find(one => one.key === 'tv:giant')
    const tvOf = async () => (await ui.findAll({ type: 'Client' })).find(one => one.key === 'tv')
    await ui.post({ kind: 'inspect', id: 'a', at: { x: 10, y: 1 } }, { in: 'mascots' })
    await ui.redraw()
    // Flying in: the module's own drawing.
    expect((await tvOf())?.props.module).toBe('hooks/tv-client.tsx')
    expect(await giantOf()).toBe(undefined)
    expect(((await tvOf())?.props.props as TvInputs).pictured).toBe(undefined)
    // Grown, switching on: the giant a picture of its box.
    await ui.advance((TV_FRAMES.travel + TV_FRAMES.grow + 1) * TV_FRAME_MS)
    await ui.redraw()
    const inputs = (await tvOf())?.props.props as TvInputs
    expect(inputs.pictured).toBe(true)
    const image = await giantOf()
    expect(image).toBeDefined()
    expect([image?.props.columns, image?.props.rows]).toEqual([inputs.layout.width, inputs.layout.height])
    const picture = pngPixels(String((image?.props.source as { png: string }).png))
    expect([picture.width, picture.height]).toEqual([inputs.layout.width * 8, inputs.layout.height * 16])
    expect(countColour(picture, inputs.who.colour)).toBeGreaterThan(1000)
    // It blinks: its eyes swapped shut a moment, then open again.
    await clock.advance(BLINK_EVERY_MS + 200)
    const blinks = sent.filter(one => one.key === 'tv:giant')
    expect(blinks.length).toBeGreaterThanOrEqual(2)
    expect(new Set(blinks.map(one => one.png)).size).toBe(2)
    // Closed: the glass switches off, it shrinks out of the giant, the picture gone.
    await ui.key({ key: 'q', in: 'tv' })
    await ui.advance((TV_FRAMES['power-off'] + 1) * TV_FRAME_MS)
    await ui.redraw()
    expect(await giantOf()).toBe(undefined)
    await ui.unmount()
  })

  test('on the desktop no picture: the module draws the giant smooth in its own document', { timeoutMs: 20_000 }, async ($, on) => {
    arrange(on, [TYPIST])
    const ui = await mount($, 'desktop', 72, 36)
    await ui.post({ kind: 'inspect', id: 'a', at: { x: 10, y: 1 } }, { in: 'mascots' })
    await ui.advance((TV_FRAMES.travel + TV_FRAMES.grow + TV_FRAMES['power-on'] + 1) * TV_FRAME_MS)
    await ui.redraw()
    const tv = (await ui.findAll({ type: 'Client' })).find(one => one.key === 'tv')
    expect((tv?.props.props as TvInputs).art).toBe('vector')
    expect((tv?.props.props as TvInputs).pictured).toBe(undefined)
    expect(await ui.find({ type: 'Image' })).toBe(undefined)
    expect(String((await ui.find({ type: 'Svg', in: 'tv' }))?.props.source)).toContain(`shape-rendering='geometricPrecision'`)
    await ui.unmount()
  })

  test('with mascotArt blocks, the TV keeps its quarters everywhere', { options: { mascotArt: 'blocks' }, timeoutMs: 20_000 }, async ($, on) => {
    arrange(on, [TYPIST])
    mock.env(on, GHOSTTY)
    const ui = await mount($, 'terminal', 72, 36)
    await ui.post({ kind: 'inspect', id: 'a', at: { x: 10, y: 1 } }, { in: 'mascots' })
    await ui.advance((TV_FRAMES.travel + TV_FRAMES.grow + TV_FRAMES['power-on'] + 1) * TV_FRAME_MS)
    await ui.redraw()
    const tv = (await ui.findAll({ type: 'Client' })).find(one => one.key === 'tv')
    expect((tv?.props.props as TvInputs).art).toBe(undefined)
    expect((tv?.props.props as TvInputs).pictured).toBe(undefined)
    expect((await ui.findAll({ type: 'Image' })).some(one => one.key === 'tv:giant')).toBe(false)
    await ui.unmount()
  })
})
