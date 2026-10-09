import { describe, expect, mock, test } from 'claude-code/testing'

import { chain, scale } from './clawd-vector'
import type { Shape } from './clawd-vector'
import { countColour, pngPixels } from './png.fixtures'
import { arrange, mount } from './scene-client.fixtures'
import { NOW, entry } from './scene-model.fixtures'
import { smoothFrame } from './scene-smooth'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { createWorld, pointer } from './scene-world'
import { TYPIST, frameLines, inputs as sceneInputs, press, ticks } from './scene-world.fixtures'
import { createSmoother } from './smooth-pose'
import { EYE } from './smooth-art'
import { spriteOf } from './tv-figure'
import type { Who } from './tv-figure'
import { TV_FRAMES, TV_FRAME_MS, tvLayoutOf, tvLookAt } from './tv-model'
import type { TvInputs, TvRow } from './tv-model'
import { paintCells, paintSvg } from './tv-paint'
import { casingOf, giantCells, giantPicture, giantShapes, spriteShapes } from './tv-smooth'
import { BLINK_EVERY_MS, createTv, pointerTv, startClose, tickTv, tvPostOf } from './tv-world'
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
    const accessories = ['beanie', 'cap', 'tophat', 'flower', 'bow', 'halo', 'note', 'propeller'] as const
    const hats = ['hardhat', 'fedora', 'mortarboard', 'helmet', 'tophat', 'beret'] as const
    const wearing: Who[] = [
      CLAWD,
      { ...CLAWD, crown: undefined, cap: true },
      ...accessories.flatMap(accessory => (['left', 'right'] as const).map((side): Who => ({ ...CLAWD, crown: undefined, accessory, side }))),
      ...hats.map((hat): Who => ({ ...BUNNY, hat })),
      { ...BUNNY, hat: undefined, crown: true },
      { ...BUNNY, hat: undefined, cap: true },
    ]
    for (const [columns, rows] of [[72, 36], [80, 44], [96, 32], [130, 40]] as const) for (const who of wearing) {
      const layout = tvLayoutOf(who.character, columns, rows)!
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

  test('drawn smooth, a press lands on what its shapes cover: on its arm the TV stays on; in its box beside its head, it switches off', () => {
    for (const who of [CLAWD, BUNNY]) {
      for (const drawn of [{ svg: true as const }, { pictured: true as const }]) {
        const inputs = inputsOf(who, { art: 'vector', ...drawn })
        const { layout } = inputs
        const cells = giantCells(who, layout)
        const tv = createTv(inputs)
        for (let frame = 0; frame < 100 && tv.phase !== 'on'; frame += 1) tickTv(tv, () => {})
        expect(tv.phase).toBe('on')
        const press = (fx: number, fy: number): void => {
          for (const type of ['down', 'up'] as const) pointerTv(tv, { type, x: layout.left + fx, y: layout.top + fy, button: 'left' }, () => {})
        }
        // Its arm, at its box's left edge on the arms' row.
        const arm = Array.from({ length: layout.height }, (_, fy) => fy).find(fy => cells.has(fy * layout.width))
        expect(arm, who.character).toBeDefined()
        press(0, arm!)
        expect(tv.phase, who.character).toBe('on')
        // Its box's top left corner, beside its head: nothing drawn there.
        expect(cells.has(0)).toBe(false)
        press(0, 0)
        expect(tv.phase, who.character).toBe('power-off')
      }
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
      expect(Math.abs(start.bottom - (20 + (who.character === 'usagi' ? 4 : 3.5)) * 16)).toBeLessThan(2)
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

describe('flying from the scene', () => {
  test('it starts where the scene drew the mascot pressed: its body\'s middle and its foot as the scene\'s, a child\'s mini at its own size', () => {
    for (const character of ['clawd', 'usagi'] as const) {
      const world = createWorld(sceneInputs([entry('parent', { currentTool: 'Edit', startedAt: NOW - 120_000 }), entry('kid', { parentId: 'parent', currentTool: 'Grep', startedAt: NOW - 60_000 })], { art: 'vector', svg: true, ...(character === 'usagi' ? { character } : {}) }))
      ticks(world, 4)
      // A cell of a mascot as drawn now: a full one's head's middle; a mini's first cell found.
      const cellOf = (id: string): { x: number; y: number } => {
        if (id === 'parent') return press(world, id)
        frameLines(world)
        for (const [y, row] of (world.owners ?? []).entries()) for (const [x, owner] of row.entries()) if (owner === id) return { x, y }
        throw new Error(`no ${id} drawn`)
      }
      for (const id of ['parent', 'kid']) {
        const at = cellOf(id)
        const posts: unknown[] = []
        for (const type of ['down', 'up'] as const) pointer(world, { type, ...at, button: 'left' }, data => posts.push(data))
        const ask = posts.find(one => (one as { kind?: string }).kind === 'inspect') as { at: { x: number; y: number; mini?: true } } | undefined
        expect(ask?.at.mini === true, id).toBe(id === 'kid')
        // The scene's figure under the press, its body (Clawd's in its colour, Usagi's cream head) in the region's pixels.
        const plan = world.cur!
        const frame = smoothFrame(sceneAt(world, world.sceneNow), layoutAt(world, plan.tick), plan, viewOf(world).sprites, createSmoother(), world.sceneNow)!
        const colour = character === 'usagi' ? USAGI.cream : sceneAt(world, world.sceneNow).agents.find(one => one.id === id)!.colour
        const bodyOf = (shapes: readonly Shape[]): { left: number; top: number; right: number; bottom: number } | undefined => {
          const bodies = shapes.filter(one => one.fill === colour && (one.kind === 'rect' || one.kind === 'ellipse'))
          const body = bodies.reduce<Shape | undefined>((best, one) => (best === undefined || one.w * one.h > best.w * best.h ? one : best), undefined)

          return body === undefined ? undefined : boundsOf([body])
        }
        const inPixels = (shapes: readonly Shape[]): Shape[] => shapes.map(one => ({ ...one, m: chain(scale(4), one.m ?? [1, 0, 0, 1, 0, 0]) }))
        const figures = frame.wholes.map(([from, to]) => inPixels(frame.shapes.slice(from, to)))
        // The body nearest the press.
        const away = (body: { left: number; top: number; right: number; bottom: number }): number => Math.hypot((body.left + body.right) / 2 - (at.x * 8 + 4), (body.top + body.bottom) / 2 - (at.y * 16 + 8))
        const drawn = figures.map(bodyOf).reduce<ReturnType<typeof bodyOf>>((best, body) => (body !== undefined && (best === undefined || away(body) < away(best)) ? body : best), undefined)
        expect(drawn, `${character} ${id}`).toBeDefined()
        expect(away(drawn!), `${character} ${id}`).toBeLessThan(40)
        const flying = bodyOf(spriteShapes({ ...inputsOf({ character, colour }), from: ask!.at }, 0, 0, 'open', world.sceneNow))!
        expect(Math.abs((flying.left + flying.right) / 2 - (drawn!.left + drawn!.right) / 2), `${character} ${id}`).toBeLessThan(3)
        expect(Math.abs(flying.bottom - drawn!.bottom), `${character} ${id}`).toBeLessThan(3)
        expect(Math.abs((flying.right - flying.left) / (drawn!.right - drawn!.left) - 1), `${character} ${id}`).toBeLessThan(0.05)
      }
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
    // Told as its growing ends, the glass about to switch on: not while it flies.
    expect(phases).toEqual(['grow'])
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
    // The casing's colour as the picture has it, raw, for the glass's edge rows over it.
    expect(inputs.casing).toMatch(/^#[0-9A-Fa-f]{6}$/)
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

  test('pressed in flight, the giant\'s propeller turns in its picture too: its blade\'s two frames swapped in turn', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = arrange(on, [TYPIST])
    mock.env(on, GHOSTTY)
    const sent: string[] = []
    on('ui.blit', (_$, e) => {
      const args = e as unknown as { key: string; source: { png?: string } }
      if (args.key === 'tv:giant') sent.push(args.source.png ?? '')

      return { value: {} }
    })
    const ui = await mount($, 'terminal', 72, 36)
    await ui.post({ kind: 'inspect', id: 'a', at: { x: 10, y: 1 }, cap: true }, { in: 'mascots' })
    await ui.redraw()
    await ui.advance((TV_FRAMES.travel + TV_FRAMES.grow + 1) * TV_FRAME_MS)
    await ui.redraw()
    expect((await ui.findAll({ type: 'Image' })).some(one => one.key === 'tv:giant')).toBe(true)
    // Two blade frames a second, each the whole giant.
    await clock.advance(1600)
    expect(new Set(sent).size).toBe(2)
    expect(sent.length).toBeGreaterThanOrEqual(3)
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
