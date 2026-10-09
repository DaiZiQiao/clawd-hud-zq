import { describe, expect, mock, test } from 'claude-code/testing'

import type { ImagesStrip } from '../types'
import {
  NEXT_SID,
  NOW,
  PNG_GRADIENT,
  PNG_HALF,
  REPORT,
  SAMPLE,
  SID,
  START,
  arrange,
  autocomplete,
  hintLine,
  imagesDirOf,
  mountBand,
  runFor,
} from './register.fixtures'

// The hooks against the engine beneath them: a paste found in the session's
// image folder and drawn as cells or pixels, the pixels check, what is
// attached and what is not, the band's other shapes, /mod-images, /clear.

const stripOf = (stateOf: (key: string) => unknown): ImagesStrip => (stateOf('strip') as ImagesStrip | undefined) ?? { sessionId: '', tiles: [] }

describe('the strip', () => {
  test('nothing is drawn while the draft holds no image, and /mod-images is registered to run at once', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { world } = arrange(on)
    await $.session.start(START)
    expect(world.registered.map(one => one.name)).toEqual(['mod-images'])
    expect(world.registered[0]?.immediate).toBe(true)
    const ui = await mountBand($)
    expect(await ui.find({ key: 'images:strip' })).toBeUndefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  })

  test('a band drawn before the session started redraws when an image is pasted', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste } = arrange(on, { kitState: true })
    // The engine draws the band once before `session.start` has run.
    const ui = await mountBand($)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    expect((await ui.find({ type: 'Raster', key: 'img:1' }))?.props).toMatchObject({ columns: 26, rows: 8 })
    await ui.unmount()
  })

  test('a pasted PNG shows as half-block cells over its number and size', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste, stateOf } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    expect(stripOf(stateOf).tiles).toMatchObject([{ id: 1, state: 'ready', format: 'png', width: 16, height: 10 }])
    const ui = await mountBand($)
    const raster = await ui.find({ type: 'Raster', key: 'img:1' })
    // 120 x 30: ten rows above the prompt, so eight-row thumbnails over a label row; 16:10 is 26 columns.
    expect(raster?.props).toMatchObject({ columns: 26, rows: 8 })
    expect((await ui.find({ key: 'images:label:1' }))?.text).toBe('#1 16x10')
    await ui.unmount()
  })

  test('kitty draws the picture as an Image in a box of its size, and keeps it once the terminal confirms pixels', async ($, on) => {
    mock.env(on, { TERM: 'xterm-kitty' })
    const { clock, paste, world } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    const ui = await mountBand($)
    const image = await ui.find({ type: 'Image', key: 'img:1' })
    expect(image?.props).toMatchObject({ columns: 26, rows: 8, alt: 'Image #1, PNG, 16 by 10' })
    expect((await ui.find({ key: 'images:box:1' }))?.props).toMatchObject({ width: 26, height: 8 })
    await runFor(clock, 1000)
    expect(world.blits.map(one => one.key)).toEqual(['img:1'])
    await ui.redraw()
    expect(await ui.find({ type: 'Image', key: 'img:1' })).toBeDefined()
    await ui.unmount()
  })

  test('a terminal that draws the alt instead switches the strip to half-blocks; one still being asked is asked again', async ($, on) => {
    mock.env(on, { TERM: 'xterm-kitty' })
    const { clock, paste, world } = arrange(on)
    const answers = [
      'the Image draws its alt here: the terminal draws no placeholder images (env: terminal=xterm-kitty, not asked yet)',
      'the Image draws its alt here: the terminal draws no placeholder images (probe: no reply to the graphics query)',
    ]
    world.blit = () => ({ deny: answers.shift() ?? 'unexpected' })
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    const ui = await mountBand($)
    expect(await ui.find({ type: 'Image', key: 'img:1' })).toBeDefined()
    await runFor(clock, 2000)
    expect(world.blits).toHaveLength(2)
    await ui.redraw()
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect((await ui.find({ type: 'Raster', key: 'img:1' }))?.props).toMatchObject({ columns: 26, rows: 8 })
    await ui.unmount()
    const lines = ((await $.command.run(REPORT)).text ?? '').split('\n')
    expect(lines.slice(1, 3)).toEqual([
      'Pictures: half-block cells in full colour (kitty: TERM=xterm-kitty).',
      '  Claude Code checked and this terminal draws no pictures (no reply to the graphics query).',
    ])
  })

  test('a placeholder waits 150 ms before it shows, so a quick decode never flashes one', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, world } = arrange(on)
    await $.session.start(START)
    // The chip is in, its file not yet written.
    world.draft = '[Image #1]'
    await autocomplete($, world.draft)
    await clock.advance(20)
    const early = await mountBand($)
    expect(await early.find({ key: 'images:note:1' })).toBeUndefined()
    await early.unmount()
    await runFor(clock, 300)
    const later = await mountBand($)
    expect((await later.find({ key: 'images:note:1' }))?.text).toBe('…')
    await later.unmount()
  })

  test('deleting a chip takes its tile away at the next look at the draft', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste, world, stateOf } = arrange(on)
    await $.session.start(START)
    paste(1)
    paste(2, PNG_HALF)
    await autocomplete($, world.draft)
    await runFor(clock, 600)
    expect(stripOf(stateOf).tiles.map(tile => tile.id)).toEqual([1, 2])
    world.draft = '[Image #2]'
    await runFor(clock, 400)
    expect(stripOf(stateOf).tiles.map(tile => tile.id)).toEqual([2])
  })

  test('the desktop surface is passed through: the desktop app shows pasted images itself', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    const ui = await mountBand($, 'desktop')
    expect(await ui.find({ key: 'images:strip' })).toBeUndefined()
    await ui.unmount()
  })

  test('under a survey the strip is one compact row', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    const ui = await mountBand($, 'terminal', { hasSurvey: true })
    expect(await ui.find({ key: 'images:strip' })).toBeUndefined()
    expect((await ui.find({ key: 'images:compact' }))?.text).toContain('#1')
    await ui.unmount()
  })

  test('pictures set to text draws one line naming the images', { options: { pictures: 'text' } }, async ($, on) => {
    mock.env(on, { TERM: 'xterm-kitty' })
    const { clock, paste } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    const ui = await mountBand($)
    expect((await ui.find({ key: 'images:text' }))?.text).toBe('Images attached: #1 PNG 16 by 10.')
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    await ui.unmount()
  })

  test('a file too big to read is a framed tile saying so', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, world, paste, stateOf } = arrange(on)
    await $.session.start(START)
    paste(1)
    const path = `${imagesDirOf()}/1.png`
    const file = world.files.get(path)
    if (file !== undefined) world.files.set(path, { ...file, size: 5_000_000 })
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    expect(stripOf(stateOf).tiles).toMatchObject([{ id: 1, state: 'failed', reason: 'too big' }])
    const ui = await mountBand($)
    expect((await ui.find({ key: 'images:note:1' }))?.text).toContain('too big')
    await ui.unmount()
  })
})

describe('what is attached', () => {
  test('a chip whose file was written long before the chip appeared is drawn as not attached', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste, stateOf } = arrange(on)
    await $.session.start(START)
    paste(4, PNG_GRADIENT, { mtimeMs: NOW - 60_000 })
    await autocomplete($, '[Image #4]')
    await runFor(clock, 600)
    expect(stripOf(stateOf).tiles).toMatchObject([{ id: 4, state: 'not-attached' }])
    const ui = await mountBand($)
    expect((await ui.find({ key: 'images:note:4' }))?.text).toContain('attached')
    await ui.unmount()
  })

  test("a sent prompt's images are not attached when the prompt is recalled", async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    mock.session(on)
    const { clock, paste, world, stateOf } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, world.draft)
    await runFor(clock, 600)
    expect(stripOf(stateOf).tiles).toMatchObject([{ id: 1, state: 'ready' }])
    await $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [
          { type: 'text', text: '[Image #1] what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_GRADIENT } },
        ],
      },
      door: 'prompt',
      origin: { kind: 'composer' },
      uuid: 'row-1',
    } as never)
    world.draft = ''
    await runFor(clock, 400)
    expect(stripOf(stateOf).tiles).toEqual([])
    // Up brings the prompt back as text: Claude Code does not attach its image again.
    // Only the hint line under the prompt tells of it.
    world.draft = '[Image #1] what is this?'
    await hintLine($, true)
    await runFor(clock, 300)
    expect(stripOf(stateOf).tiles).toMatchObject([{ id: 1, state: 'not-attached' }])
  })

  test('with Claude Code keeping no image folder, a chip reads no preview once its wait is over', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color', CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1' })
    const { clock, world, stateOf } = arrange(on)
    await $.session.start(START)
    world.draft = '[Image #1]'
    await autocomplete($, world.draft)
    await runFor(clock, 3600, 100)
    expect(stripOf(stateOf).tiles).toMatchObject([{ id: 1, state: 'failed', reason: 'no preview' }])
  })

  test("/clear starts over in the new session's folder", async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste, wipe, stateOf } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    await $.session.end({ reason: 'clear', sessionId: SID, resume: { id: SID } } as never)
    wipe()
    paste(2, PNG_HALF, { sid: NEXT_SID })
    await autocomplete($, '[Image #2]')
    await runFor(clock, 600)
    const strip = stripOf(stateOf)
    expect(strip.sessionId).toBe(NEXT_SID)
    expect(strip.tiles).toMatchObject([{ id: 2, state: 'ready', width: 4, height: 4 }])
  })

  test('a session nobody types in draws nothing and never looks at the draft', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock, paste, world } = arrange(on)
    await $.session.start({ cwd: START.cwd, surface: null, isInteractive: false })
    paste(1)
    await runFor(clock, 4000, 500)
    expect(world.writes).toEqual([])
    const ui = await mountBand($)
    expect(await ui.find({ key: 'images:strip' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('/mod-images', () => {
  test('it reports the terminal, the image folder and the last strip', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal' })
    const { clock, paste } = arrange(on)
    await $.session.start(START)
    paste(1)
    await autocomplete($, '[Image #1]')
    await runFor(clock, 600)
    const ui = await mountBand($)
    await ui.unmount()
    const ran = await $.command.run(REPORT)
    const lines = (ran.text ?? '').split('\n')
    expect(lines[0]).toBe('version 1.0.0 on Claude Code 2.1.295.')
    expect(lines[1]).toBe('Pictures: half-block cells in 256 colours (macOS Terminal, no COLORTERM).')
    expect(ran.text).toContain(`Image folder: ${imagesDirOf()} (found, 1 image this session).`)
    expect(ran.text).toContain('Last strip, 0 s ago: #1 PNG 16x10 shown.')
    expect(ran.text).toContain('Room: 10 rows above the prompt, 115 columns (120x30, fullscreen); thumbnails were 8 rows.')
    expect(ran.text).toContain('Paste: Ctrl+V or Cmd+V, or drag a file in.')
  })

  test('test draws a sample strip for ten seconds', async ($, on) => {
    mock.env(on, { TERM: 'xterm-256color' })
    const { clock } = arrange(on)
    await $.session.start(START)
    const ran = await $.command.run(SAMPLE)
    expect(ran.text).toBe('a sample strip shows above the prompt for 10 seconds.')
    const shown = await mountBand($)
    expect(await shown.find({ type: 'Raster', key: 'img:1' })).toBeDefined()
    expect(await shown.find({ type: 'Raster', key: 'img:3' })).toBeDefined()
    await shown.unmount()
    await runFor(clock, 10_200, 400)
    const after = await mountBand($)
    expect(await after.find({ key: 'images:strip' })).toBeUndefined()
    await after.unmount()
  })

  test('anything else gets the usage line', async ($, on) => {
    mock.env(on, {})
    arrange(on)
    await $.session.start(START)
    expect((await $.command.run({ ...REPORT, args: 'what' })).text).toBe('usage: /mod-images, or /mod-images test for a sample strip.')
  })
})
