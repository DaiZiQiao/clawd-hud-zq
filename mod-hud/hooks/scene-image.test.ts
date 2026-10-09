import type { JsonValue } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { HudSelection } from '../types'
import { rasterOf, scale } from './clawd-vector'
import { CROWN } from './mascot-sprites'
import { base64Of, deflate, pngOf } from './png'
import { bytesOf, countColour, inflate, pngPixels } from './png.fixtures'
import { glyphShapes, textWidth } from './raster-font'
import { arrange, mount } from './scene-client.fixtures'
import { IMAGE_FRAME_MS, STILL_EVERY, cellPixels, createStage, hitsOf, restage, stageFrame, stageHits, stageTick } from './scene-image'
import type { HitEvent } from './scene-image'
import type { SceneInputs } from './scene-types'
import { TYPIST, inputs, press } from './scene-world.fixtures'
import { USAGI } from './usagi-sprites'

// The vector scene as a terminal's picture: the PNG writer, the raster font,
// the stage the hooks run (hooks/scene-image.ts), and the pane and band
// drawing an Image the hooks swap frames into, a hit layer over it.

const CLAWD_BODY = '#D77757'

// The terminals the engine draws an Image in, as their environment says so.
const GHOSTTY = { TERM: 'xterm-ghostty', TERM_PROGRAM: 'ghostty' }
const KITTY = { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1' }

describe('the PNG writer', () => {
  test('what it deflates inflates back, runs and noise alike', () => {
    const noise = new Uint8Array(5000).map((_, index) => (index * 7919) % 251)
    const runs = new Uint8Array(70_000).map((_, index) => (index % 9000 < 4000 ? 0 : index % 3))
    for (const data of [new Uint8Array(0), new Uint8Array([42]), noise, runs]) expect([...inflate(deflate(data))]).toEqual([...data])
    // Long runs pack small: 70 kB of a few runs to a few hundred bytes.
    expect(deflate(runs).length).toBeLessThan(2000)
  })

  test('a PNG: its size, its RGBA pixels back exactly, clear rows and all; each chunk\'s CRC and the stream\'s check right', () => {
    const width = 23
    const height = 9
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 2; y < 6; y += 1) for (let x = 3; x < 19; x += 1) pixels.set([215, 119, 87, (x * 16) % 256], (y * width + x) * 4)
    const back = pngPixels(pngOf(pixels, width, height))
    expect([back.width, back.height]).toEqual([width, height])
    expect([...back.pixels]).toEqual([...pixels])
  })

  test('base64 as the standard alphabet writes it, padded', () => {
    expect(base64Of(new Uint8Array([]))).toBe('')
    expect(base64Of(new Uint8Array([77]))).toBe('TQ==')
    expect(base64Of(new Uint8Array([77, 97]))).toBe('TWE=')
    expect(base64Of(new Uint8Array([77, 97, 110]))).toBe('TWFu')
    const bytes = new Uint8Array(3000).map((_, index) => (index * 31) % 256)
    expect([...bytesOf(base64Of(bytes))]).toEqual([...bytes])
  })
})

describe('the rasterizer', () => {
  test('a polygon convex or not (an L, a stroke along an arc) is filled where it is and clear in its hollow', () => {
    const pixels = rasterOf([{ kind: 'poly', x: 0, y: 0, w: 0, h: 0, points: [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]], fill: '#FF0000' }], 24, 24, scale(8))
    const alphaAt = (x: number, y: number): number => pixels[(Math.floor(y * 8) * 24 + Math.floor(x * 8)) * 4 + 3] ?? 0
    expect(alphaAt(0.5, 2.5)).toBe(255)
    expect(alphaAt(2.5, 0.5)).toBe(255)
    expect(alphaAt(2, 2)).toBe(0)
  })
})

describe('the raster font', () => {
  test('a line as rectangles in its own frame: as wide as six font pixels a glyph less a gap, anchored at its middle, its capitals 0.7 of its size over the baseline', () => {
    const shapes = glyphShapes({ kind: 'text', x: 10, y: 20, w: 0, h: 0, text: 'HH', size: 10, fill: 'text' })
    const near = (value: number, want: number): boolean => Math.abs(value - want) < 0.5
    expect(near(textWidth('HH', 10), 11)).toBe(true)
    const left = Math.min(...shapes.map(one => one.x))
    const right = Math.max(...shapes.map(one => one.x + one.w))
    const top = Math.min(...shapes.map(one => one.y))
    const bottom = Math.max(...shapes.map(one => one.y + one.h))
    expect([near(left, 10 - 5.5), near(right, 10 + 5.5), near(top, 20 - 7), near(bottom, 20)]).toEqual([true, true, true, true])
    expect(shapes.every(one => one.kind === 'rect' && one.fill === 'text' && one.m === undefined)).toBe(true)
    // A descender goes under the baseline; a glyph the font lacks is a box.
    expect(Math.max(...glyphShapes({ kind: 'text', x: 0, y: 0, w: 0, h: 0, text: 'g', size: 10, fill: 'text' }).map(one => one.y + one.h))).toBeGreaterThan(1)
    expect(glyphShapes({ kind: 'text', x: 0, y: 0, w: 0, h: 0, text: '★', size: 10, fill: 'text' }).length).toBeGreaterThan(0)
  })
})

describe('the stage', () => {
  test('a frame is a PNG of the region: its cells 8 by 16 pixels, twice that for a small region; the mascots in their colours on a clear ground', () => {
    expect(cellPixels(72, 12)).toEqual({ width: 8, height: 16 })
    expect(cellPixels(28, 5)).toEqual({ width: 16, height: 32 })
    const stage = createStage(inputs([TYPIST], { columns: 60, rows: 10, art: 'vector' }))
    const picture = pngPixels(stageFrame(stage, 'dark'))
    expect([picture.width, picture.height]).toEqual([60 * 8, 10 * 16])
    expect(countColour(picture, CLAWD_BODY)).toBeGreaterThan(200)
    expect(countColour(picture, CROWN.colour)).toBeGreaterThan(5)
    // Mostly clear: the pane shows through.
    let clear = 0
    for (let at = 3; at < picture.pixels.length; at += 4) if (picture.pixels[at] === 0) clear += 1
    expect(clear).toBeGreaterThan(picture.width * picture.height * 0.7)
    // Whose mascot owns each cell, kept for the pointer.
    expect(stage.world.owners?.some(row => row.includes('a'))).toBe(true)
  })

  test('Usagi\'s frame in its own colours: cream, its thin dark line', () => {
    const stage = createStage(inputs([TYPIST], { columns: 60, rows: 10, art: 'vector', character: 'usagi' }))
    const picture = pngPixels(stageFrame(stage, 'dark'))
    expect(countColour(picture, USAGI.cream)).toBeGreaterThan(200)
    expect(countColour(picture, USAGI.line)).toBeGreaterThan(40)
    expect(countColour(picture, CLAWD_BODY)).toBeLessThan(40)
  })

  test('the timer\'s frame: the world on by a step, the picture every frame while anything moves, every third while all stand still, nothing when unchanged or paused', () => {
    const stage = createStage(inputs([TYPIST], { columns: 60, rows: 10, art: 'vector' }))
    stage.png = stageFrame(stage, 'dark')
    const before = stage.world.ms
    const drawn: (string | undefined)[] = []
    for (let index = 0; index < 3 * STILL_EVERY; index += 1) drawn.push(stageTick(stage, IMAGE_FRAME_MS, 'dark'))
    expect(stage.world.ms).toBe(before + 3 * STILL_EVERY * IMAGE_FRAME_MS)
    // At work and breathing: still, so a frame every third.
    expect(stage.still).toBe(true)
    expect(drawn.filter(one => one !== undefined).length).toBeLessThanOrEqual(3)
    expect(drawn.filter(one => one !== undefined).length).toBeGreaterThanOrEqual(1)
    restage(stage, { ...stage.world.props, paused: true })
    expect(stageTick(stage, IMAGE_FRAME_MS, 'dark')).toBe(undefined)
  })

  test('the hit layer\'s posts: read back oldest first, anything else none; each event taken once; a layer mounted afresh counts again', () => {
    expect(hitsOf('nope')).toBe(undefined)
    expect(hitsOf({ hits: [] })).toBe(undefined)
    expect(hitsOf({ layer: 'x', hits: [{ seq: 2, type: 'up', x: 1, y: 1 }, { seq: 1, type: 'down', x: 1, y: 1 }, { seq: 3, type: 'jump', x: 1, y: 1 }, 'z'] })?.hits.map(one => one.seq)).toEqual([1, 2])
    const stage = createStage(inputs([TYPIST], { columns: 100, rows: 16, art: 'vector' }))
    stageFrame(stage, 'dark')
    const at = press(stage.world, 'a')
    const asks: JsonValue[] = []
    const click: HitEvent[] = [{ seq: 1, type: 'down', ...at, button: 'left' }, { seq: 2, type: 'up', ...at, button: 'left' }]
    expect(stageHits(stage, { layer: 'one', hits: click }, data => asks.push(data))).toBe(true)
    expect(asks).toHaveLength(1)
    expect((asks[0] as { kind: string; id: string }).id).toBe('a')
    // The same events posted again are not taken twice.
    expect(stageHits(stage, { layer: 'one', hits: click }, data => asks.push(data))).toBe(false)
    expect(asks).toHaveLength(1)
    // A new layer's events, numbered from 1 again, are.
    expect(stageHits(stage, { layer: 'two', hits: click }, data => asks.push(data))).toBe(true)
    expect(asks).toHaveLength(2)
  })
})

/** The engine's blits beneath the plugin: each one's site, key and picture; answered `deny` while set. */
const blits = (on: Parameters<typeof arrange>[0]) => {
  const sent: { requestId: string; key: string; png: string }[] = []
  const state = { deny: undefined as string | undefined }
  on('ui.blit', (_$, e) => {
    const args = e as unknown as { requestId: string; key: string; source: { png?: string } }
    sent.push({ requestId: args.requestId, key: args.key, png: args.source.png ?? '' })

    return { value: state.deny === undefined ? {} : { deny: state.deny } }
  })

  return { sent, state }
}

describe('in a terminal that shows pictures', () => {
  test('the pane\'s scene is an Image the region\'s size, the hit layer over it; the hooks swap a frame in on their clock', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = arrange(on, [TYPIST])
    mock.env(on, GHOSTTY)
    const { sent } = blits(on)
    const ui = await mount($, 'terminal')
    const image = await ui.find({ type: 'Image' })
    expect(image?.key).toBe('mascots:picture')
    const hit = await ui.find({ type: 'Client' })
    expect(hit?.key).toBe('mascots')
    expect(hit?.props.module).toBe('hooks/scene-hit.tsx')
    expect([image?.props.columns, image?.props.rows]).toEqual([hit?.props.width, hit?.props.height])
    const first = pngPixels(String((image?.props.source as { png: string }).png))
    expect(first.width).toBe(Number(image?.props.columns) * 8)
    expect(countColour(first, CLAWD_BODY)).toBeGreaterThan(100)
    // No scene module in the terminal: the hooks run its world.
    expect((await ui.findAll({ type: 'Client' })).map(one => one.props.module)).toEqual(['hooks/scene-hit.tsx'])
    await clock.advance(IMAGE_FRAME_MS * STILL_EVERY * 4)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every(one => one.requestId === 'hud' && one.key === 'mascots:picture')).toBe(true)
    expect(pngPixels(sent[sent.length - 1]!.png).width).toBe(first.width)
    await ui.unmount()
  })

  test('a click through the hit layer on a mascot inspects it, as on the scene\'s own Client', { options: { inspectView: 'pane' }, timeoutMs: 20_000 }, async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    mock.env(on, GHOSTTY)
    blits(on)
    const ui = await mount($, 'terminal')
    const hit = await ui.find({ type: 'Client' })
    const columns = Number(hit?.props.width)
    const rows = Number(hit?.props.height)
    // Down and up on each cell in turn till one lands on a mascot.
    let found = false
    for (let y = rows - 1; y >= 0 && !found; y -= 1) {
      for (let x = 0; x < columns && !found; x += 1) {
        await ui.pointer({ type: 'down', x, y, button: 'left' })
        await ui.pointer({ type: 'up', x, y, button: 'left' })
        found = held.get('selected')?.value !== undefined && held.get('selected')?.value !== null
      }
    }
    expect(found).toBe(true)
    expect(['a', 'main']).toContain((held.get('selected')?.value as HudSelection).id)
    await ui.unmount()
  })

  test('a terminal that draws the Image\'s alt refuses the swap: its scene\'s own Client and blocks from then on', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock } = arrange(on, [TYPIST])
    mock.env(on, KITTY)
    const { state } = blits(on)
    state.deny = 'the Image draws its alt there: no placeholder images'
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Image' })).toBeDefined()
    await clock.advance(IMAGE_FRAME_MS * STILL_EVERY * 2)
    await ui.redraw()
    expect(await ui.find({ type: 'Image' })).toBe(undefined)
    const client = await ui.find({ type: 'Client' })
    expect(client?.props.module).toBe('hooks/scene-client.tsx')
    expect((client?.props.props as SceneInputs).art).toBe('vector')
    await ui.unmount()
  })

  test('the band\'s yard too: the session\'s mascot an Image, the hit layer under the band\'s key', { timeoutMs: 20_000 }, async ($, on) => {
    arrange(on, [])
    mock.env(on, GHOSTTY)
    blits(on)
    const ui = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }, requestId: 'band', viewport: { columns: 160, rows: 40, isFullscreen: true } })
    const image = await ui.find({ type: 'Image' })
    expect(image?.key).toBe('session:picture')
    expect((await ui.find({ type: 'Client' }))?.key).toBe('session')
    const picture = pngPixels(String((image?.props.source as { png: string }).png))
    expect(picture.width).toBe(Number(image?.props.columns) * 16)
    expect(countColour(picture, CROWN.colour)).toBeGreaterThan(5)
    await ui.unmount()
  })

  test('with mascotArt blocks, the terminal keeps the scene\'s own Client', { options: { mascotArt: 'blocks' }, timeoutMs: 20_000 }, async ($, on) => {
    arrange(on, [TYPIST])
    mock.env(on, GHOSTTY)
    blits(on)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Image' })).toBe(undefined)
    expect((await ui.find({ type: 'Client' }))?.props.module).toBe('hooks/scene-client.tsx')
    await ui.unmount()
  })

  test('a terminal that is neither kitty nor Ghostty, or either under tmux, is never handed a picture: the scene\'s own Client from the start', { timeoutMs: 20_000 }, async ($, on) => {
    arrange(on, [TYPIST])
    mock.env(on, { ...GHOSTTY, TMUX: '/tmp/tmux-501/default,1,0' })
    const { sent } = blits(on)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Image' })).toBe(undefined)
    expect((await ui.find({ type: 'Client' }))?.props.module).toBe('hooks/scene-client.tsx')
    expect(sent).toHaveLength(0)
    await ui.unmount()
  })
})

