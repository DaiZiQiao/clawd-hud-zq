import { describe, expect, test } from 'claude-code/testing'

import { settingsOf } from './hud-options'
import { agentLook, miniLook } from './mascot-poses'
import type { Look } from './mascot-poses'
import { spriteSheet } from './mascot-sheet'
import { ACCESSORIES, OVERLAYS, ROLE_LETTERS, SKY, THOUGHTS } from './mascot-sprites'
import { PALETTE, SCENE_COLOURS, sceneFromInputs, sceneInputsOf, sceneOf } from './scene-model'
import { NOW, hotHud, trio, working } from './scene-model.fixtures'
import { placedSprites } from './scene-placement'
import { room } from './scene-plan.fixtures'
import { renderMascots } from './scene-render'
import { textsIn } from './scene-render.fixtures'
import { QUADRANTS, layerSvg } from './scene-svg'
import type { Cell, Grid, MascotRole, MascotScene } from './scene-types'
import { dressOfAgent, dressOfMain, drawUsagi, drawUsagiMini, usagiFigure } from './usagi-glyphs'
import type { Dress } from './usagi-glyphs'
import { HATS, ROLE_HATS, SIDE_CROWN, USAGI, USAGI_COLOURS, USAGI_THOUGHTS, cellsOf, clashesOf } from './usagi-sprites'

// Usagi, the `character` option's other mascot: the option and its way to
// the scene, its figure's cells (two colours only in a whole cell), what it
// wears (its role's hat, the session's crown), what it says, and how the
// terminal and the desktop draw a cell of two colours.

const STAND: Look = { head: 'open', arms: 'rest', legs: 'stand', pose: 'stand', overlays: [], lift: 0 }
const ROLES = Object.keys(ROLE_HATS) as MascotRole[]
const MAIN = { mood: 'idle', sweating: false, idleMs: 0 } as const

/** The cells of a grid, with where they are. */
const cellsIn = (grid: Grid): { cell: Cell; row: number; column: number }[] =>
  grid.flatMap((line, row) => line.flatMap((cell, column) => (cell === undefined ? [] : [{ cell, row, column }])))

/** A cell drawn in a colour, as its glyph's or as its background. */
const paints = (cell: Cell, colour: string): boolean => cell.colour === colour || cell.bg === colour

const rowText = (grid: Grid, row: number): string => (grid[row] ?? []).map(cell => cell?.ch ?? ' ').join('')

describe('the character option', () => {
  test('Clawd unless the option says usagi', () => {
    expect(settingsOf({}).character).toBe('clawd')
    expect(settingsOf({ character: 'usagi' }).character).toBe('usagi')
    expect(settingsOf({ character: 'Usagi' }).character).toBe('clawd')
    expect(settingsOf({ character: true }).character).toBe('clawd')
  })

  test('the scene carries it: on the hooks\' path, and through the smooth scene\'s props', () => {
    expect(sceneOf(trio, hotHud, NOW).character).toBe(undefined)
    expect(sceneOf(trio, hotHud, NOW, { character: 'clawd' }).character).toBe(undefined)
    expect(sceneOf(trio, hotHud, NOW, { character: 'usagi' }).character).toBe('usagi')
    const room = { now: NOW, columns: 100, rows: 20, main: {}, events: [], stalledMs: 240_000, wander: true, scenes: true, collisions: 'rare' as const, inspect: true }
    expect(sceneFromInputs(sceneInputsOf(trio, [], hotHud, room), NOW).character).toBe(undefined)
    expect(sceneFromInputs(sceneInputsOf(trio, [], hotHud, { ...room, character: 'usagi' }), NOW).character).toBe('usagi')
  })
})

describe('its figure', () => {
  // Every look in every dress: some seconds' work, given room to finish on a loaded machine.
  test('no cell asked for more than it can draw: two colours only where all four quarters are drawn, in every look and dress', { timeoutMs: 20_000 }, () => {
    const dresses: Dress[] = [{ energy: 0 }, { crown: true, energy: 0 }, ...ROLES.map(role => dressOfAgent(working('a', 'thinking', { role })))]
    const extras: Partial<Look>[] = [{}, { armsUp: true }, { lean: 1 }, { lean: -1 }, { cap: 0 }, { hatOff: true }, { overlays: OVERLAYS.cross }, { overlays: [OVERLAYS.cigarette[0]!, OVERLAYS.smoke[0]!] }, { breath: 1 }]
    const clashing: string[] = []
    for (const head of ['open', 'left', 'right', 'up', 'shut', 'spiral', 'spin', 'down', 'wide'] as const) {
      for (const arms of ['rest', 'up', 'raised', 'point'] as const) {
        for (const legs of ['stand', 'shuffleLeft', 'shuffleRight'] as const) {
          for (const pose of ['stand', 'sit', 'crouch', 'squash', 'flat', 'blanket'] as const) {
            for (const dress of dresses) {
              for (const extra of extras) {
                const { bitmap, palette } = usagiFigure({ ...STAND, head, arms, legs, pose, ...extra }, dress)
                const clashes = clashesOf(bitmap, palette)
                if (clashes.length > 0) clashing.push(`${pose} ${head} ${arms} ${legs} ${JSON.stringify(dress)} ${Object.keys(extra).join(',')}: ${clashes.join(' ')}`)
              }
            }
          }
        }
      }
    }
    expect(clashing.slice(0, 5)).toEqual([])
  })

  test('a cell of two colours: a quarter glyph over a background, both its own colours', () => {
    expect(cellsOf(['#K', '##'], { '#': USAGI.body, K: USAGI.eye })).toEqual([[{ ch: '▝', ink: 'k', colour: USAGI.eye, bg: USAGI.body }]])
    expect(cellsOf(['#.', '##'], { '#': USAGI.body })).toEqual([[{ ch: '▙', ink: 'b', colour: USAGI.body }]])
    let twoColour = 0
    for (const { name, cells } of spriteSheet('usagi')) {
      for (const frame of cells) {
        for (const cell of frame.flat()) {
          if (cell?.bg === undefined) continue
          twoColour += 1
          expect(QUADRANTS[cell.ch], name).toBeDefined()
          expect(cell.ch, name).not.toBe('█')
          expect(cell.ink, name).toBe('k')
          expect(USAGI_COLOURS, name).toContain(cell.bg)
          expect(USAGI_COLOURS, name).toContain(cell.colour)
        }
      }
    }
    expect(twoColour).toBeGreaterThan(100)
  })

  test('every Usagi the same pale yellow, whatever its agent\'s colour', () => {
    const scene: MascotScene = {
      main: MAIN,
      agents: [working('a', 'typing', { colour: PALETTE[1] }), working('b', 'thinking', { colour: PALETTE[3], role: 'reviewer' })],
      character: 'usagi',
    }
    for (let tick = 0; tick < 8; tick += 1) {
      for (const sprite of placedSprites(scene, room(72, 6, tick))?.sprites ?? []) {
        for (const { cell } of cellsIn(sprite.cells)) {
          if (cell.ink === 'b') expect(cell.colour).toBe(USAGI.body)
          expect([PALETTE[1], PALETTE[3]]).not.toContain(cell.colour)
        }
      }
    }
  })

  test('Clawd is the default: a scene without the option draws no Usagi', () => {
    const scene: MascotScene = { main: MAIN, agents: [working('a', 'typing')] }
    for (const sprite of placedSprites(scene, room(72, 6, 0))?.sprites ?? []) {
      expect(cellsIn(sprite.cells).some(({ cell }) => cell.colour === USAGI.body || cell.bg !== undefined)).toBe(false)
    }
  })
})

describe('what it wears', () => {
  test('an agent\'s role is its hat over its head, ears through the brim: no letter, no accessory', () => {
    for (const role of ROLES) {
      const grid = drawUsagi(STAND, dressOfAgent(working('a', 'thinking', { role, accessory: 'note' })))
      const hat = HATS[ROLE_HATS[role]]
      const worn = cellsIn(grid).filter(({ cell }) => paints(cell, hat.colour))
      expect(worn.length, role).toBeGreaterThan(2)
      for (const { row } of worn) expect([SKY, SKY + 1], role).toContain(row)
      // Its ears stand out of the hat: the body's colour on the air row.
      expect(cellsIn(grid).some(({ cell, row }) => row === SKY && paints(cell, USAGI.body)), role).toBe(true)
      expect(cellsIn(grid).some(({ cell }) => cell.ch === ROLE_LETTERS[role] || cell.colour === ACCESSORIES.note.colour), role).toBe(false)
    }
    const bare = drawUsagi(STAND, dressOfAgent(working('a', 'thinking', { role: undefined })))
    for (const hat of Object.values(HATS)) expect(cellsIn(bare).some(({ cell }) => paints(cell, hat.colour))).toBe(false)
  })

  test('each role\'s hat in its own colour', () => {
    const colours = ROLES.map(role => HATS[ROLE_HATS[role]].colour)
    expect(new Set(colours).size).toBe(ROLES.length)
    for (const colour of colours) expect(SCENE_COLOURS).toContain(colour)
  })

  test('the session wears the crown, small, tilted on the left of its head, in front of its ear; knocked down, it lies beside it', () => {
    const gold = SIDE_CROWN.palette.G
    const crowned = cellsIn(drawUsagi(STAND, dressOfMain(MAIN))).filter(({ cell }) => paints(cell, gold))
    expect(crowned.map(({ row }) => row)).toEqual([SKY + 1, SKY + 1, SKY + 1])
    expect(crowned.map(({ column }) => column)).toEqual([3, 4, 5])
    const down = drawUsagi({ ...STAND, pose: 'flat', hatOff: true }, dressOfMain(MAIN))
    expect(rowText(down, SKY + 3).slice(12, 15)).toBe(SIDE_CROWN.floor)
    expect(cellsIn(drawUsagi(STAND, dressOfAgent(working('a', 'thinking')))).some(({ cell }) => paints(cell, gold))).toBe(false)
  })

  test('a child wears its role\'s hat as one cell between its ears', () => {
    for (const role of ROLES) {
      const child = working('c', 'thinking', { role })
      const grid = drawUsagiMini(miniLook(child, { kind: 'stalled' }, 2), child)
      const hat = cellsIn(grid).filter(({ cell }) => paints(cell, HATS[ROLE_HATS[role]].colour))
      expect(hat.map(({ row, column }) => `${row}:${column}`), role).toEqual([`${SKY + 1}:2`])
    }
  })
})

describe('what it says', () => {
  test('its thoughts are its shouts, one a spell as Clawd\'s phrases', () => {
    const said = new Set<string>()
    for (let spell = 0; spell < 8; spell += 1) {
      const agent = working('a', 'thinking')
      const sky = rowText(drawUsagi(agentLook(agent, { kind: 'work' }, spell * 8 + 4), dressOfAgent(agent), 8), 0)
      const phrase = /\((.+)\)/.exec(sky)?.[1] ?? ''
      expect(USAGI_THOUGHTS as readonly string[]).toContain(phrase)
      expect(THOUGHTS as readonly string[]).not.toContain(phrase)
      said.add(phrase)
    }
    expect(said.size).toBeGreaterThan(1)
    for (const line of ['HUHHH?', 'UNA!']) expect(USAGI_THOUGHTS as readonly string[]).toContain(line)
  })

  test('its cross and its shout over its head, or beside its ears with no sky row free', () => {
    const slumped: Look = { ...STAND, head: 'shut', arms: 'low', pose: 'sit', overlays: OVERLAYS.cross }
    const dress = dressOfAgent(working('a', 'thinking', { role: 'worker' }))
    expect(rowText(drawUsagi(slumped, dress, 1), 0).indexOf('✗')).toBe(6)
    expect(rowText(drawUsagi(slumped, dress, 0), SKY).indexOf('✗')).toBe(11)
    expect(rowText(drawUsagi(slumped, dress, 0), 0).includes('✗')).toBe(false)
    const puff: Look = { ...STAND, head: 'shut', overlays: [OVERLAYS.cigarette[0]!, OVERLAYS.smoke[0]!] }
    expect(rowText(drawUsagi(puff, dress, 1), 0).indexOf('Ura!')).toBe(11)
    expect(rowText(drawUsagi(puff, dress, 0), SKY).indexOf('Ura!')).toBe(11)
  })

  test('no cigarette: on each puff, hands up and mouth wide, it shouts in turn Ura!, HUHHH?, UNA!, then a breath', () => {
    const entry = spriteSheet('usagi').find(one => one.name.startsWith('idle · a shout'))
    const said = (entry?.frames ?? []).map(frame => ['Ura!', 'HUHHH?', 'UNA!'].filter(line => frame.join('\n').includes(line)))
    expect(said).toEqual([['Ura!'], ['HUHHH?'], ['UNA!'], []])
    for (const frame of entry?.frames ?? []) expect(frame.join('\n').includes('╼')).toBe(false)
  })

  test('getting up after a fall, dazed: HUHHH?', () => {
    const entry = spriteSheet('usagi').find(one => one.name.startsWith('agent · knocked over'))
    const dazed = (entry?.frames ?? []).map(frame => frame.join('\n').includes('HUHHH?'))
    expect(dazed).toEqual([false, false, false, false, false, false, false, false, false, false, true, false])
  })
})

const SCENE = 'usagi-under-test'
const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
const PANE_PROPS = { title: 'HUD', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

describe('drawn', () => {
  test('the terminal: a background only under a cell of two colours, in Usagi\'s colours', async ($, on) => {
    const scene = sceneOf(trio, hotHud, NOW, { character: 'usagi' })
    on('ui.render', { component: 'Pane', requestId: SCENE }, ($$, e) => {
      const table = $$.ui.resolve(e)

      return renderMascots(table, scene, { columns: e.props.bodyColumns, rows: 8, tick: 0 }) ?? table.Box({})
    })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', props: PANE_PROPS, requestId: SCENE, viewport: VIEWPORT })
      const texts = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('mascots:') === true).flatMap(row => textsIn(row))
      const grounds = texts.flatMap(text => (text.props?.backgroundColor === undefined ? [] : [String(text.props.backgroundColor)]))
      expect(grounds.length, surface).toBeGreaterThan(0)
      for (const ground of grounds) expect(USAGI_COLOURS, surface).toContain(ground)
      for (const text of texts) if (text.props?.color !== undefined) expect(SCENE_COLOURS, surface).toContain(text.props.color)
      await ui.unmount()
    }
  })

  test('the desktop: a cell\'s background, the whole cell, under its glyph', () => {
    const cells = cellsOf(['#K', '##'], { '#': USAGI.body, K: USAGI.eye })
    const source = layerSvg({ x: 0, y: 0, cells })
    const ground = source.indexOf(`<g fill='${USAGI.body}'><rect x='0' y='0' width='8' height='16'/></g>`)
    const eye = source.indexOf(`<g fill='${USAGI.eye}'><rect x='4' y='0' width='4' height='8'/></g>`)
    expect(ground).toBeGreaterThanOrEqual(0)
    expect(eye).toBeGreaterThan(ground)
  })
})
