import type { JsonValue } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { HudSelection } from '../types'
import { CROWN, HEADS, flipped } from './mascot-sprites'
import { arrange, headAt, mount, rowsOf } from './scene-client.fixtures'
import { NOW, entry } from './scene-model.fixtures'
import { SCENE_FRAME_MS } from './scene-phases'
import { svgRows } from './scene-svg.fixtures'
import type { SceneInputs } from './scene-types'
import { FRAME_MS } from './scene-world'
import { LAPTOP, TYPIST } from './scene-world.fixtures'
import { CELL_HEIGHT, CELL_WIDTH } from './svg-style'
import { svgsOf } from './text-svg.fixtures'
import { displayWidth } from './text-width'

// The mascot scene as a `Client`: tested through the engine (the pane's tree,
// its pointer, its posts) on the terminal and the desktop.

const SURFACES = ['terminal', 'desktop'] as const
const WIDE = HEADS.wide.slice(1, 8)

// Dizzy on its back: the head upside down, its eyes crossed or rolled apart.
const DIZZY = new RegExp([HEADS.spiral, HEADS.spin].map(row => flipped(row).slice(1, 8)).join('|'))

describe('the scene is a Client', () => {
  test('on terminal and desktop: its module, the scene\'s inputs as props, the spare rows as its region; drawn a row per row', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const client = await ui.find({ type: 'Client' })
      expect(client?.key).toBe('mascots')
      expect(client?.props.module).toBe('hooks/scene-client.tsx')
      expect(client?.props.width).toBe(72)
      const props = client?.props.props as SceneInputs
      expect(props.columns).toBe(72)
      expect(props.rows).toBe(client?.props.height)
      expect(props.rows).toBeGreaterThanOrEqual(4)
      expect(props.now).toBe(NOW)
      // Only what the scene reads of the board: no task, no answer.
      expect(props.agents).toEqual([{ id: 'a', type: 'general-purpose', startedAt: NOW - 60_000, lastActivityAt: NOW, status: 'running', currentTool: 'Edit' }])
      expect([props.wander, props.scenes, props.collisions, props.inspect]).toEqual([true, true, 'rare', true])
      // The terminal draws it as rows of text; the desktop, whose pane sets text in a proportional font, in pixels.
      expect(props.svg).toBe(surface === 'desktop' ? true : undefined)
      if (surface === 'terminal') expect(await ui.find({ type: 'Svg', in: 'mascots' })).toBe(undefined)
      const rows = await rowsOf(ui)
      expect(rows).toHaveLength(props.rows)
      expect(rows.join('\n')).toContain(CROWN.art)
      expect(rows.join('\n')).toContain(LAPTOP)
      for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(72)
      // No Box scene and no pick buttons in the hooks' own tree.
      expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('pick:') === true)).toHaveLength(0)
      await ui.unmount()
    }
    expect(held.has('sceneTick')).toBe(false)
  })

  test('vscode and mobile, which draw no Client, keep the Box scene on the hooks\' 250 ms clock', async ($, on) => {
    const { held, clock } = arrange(on, [TYPIST])
    for (const surface of ['vscode', 'mobile'] as const) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Client' })).toBe(undefined)
      const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('mascots:') === true)
      expect(rows.length).toBeGreaterThanOrEqual(4)
      expect(rows.map(row => row.text).join('\n')).toContain(CROWN.art)
      await clock.advance(4 * SCENE_FRAME_MS)
      expect(held.get('sceneTick')?.version ?? 0).toBeGreaterThan(0)
      await ui.unmount()
    }
  })

  test('with motion classic, terminal and desktop draw the hooks\' scene too, with its pick buttons: rows of text, and on the desktop one Svg', { options: { motion: 'classic' } }, async ($, on) => {
    arrange(on, [TYPIST])
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Client' })).toBe(undefined)
      expect((await ui.findAll({ type: 'Button' })).some(one => one.key === 'pick:a')).toBe(true)
      // The scene's own Svg (the desktop draws the pane's text rows in Svgs of their own too).
      const svg = svgsOf(await ui.find({ type: 'Box', key: 'mascots' }))[0]
      const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('mascots:') === true)
      if (surface === 'terminal') {
        expect(svg).toBe(undefined)
        expect(rows.map(row => row.text).join('\n')).toContain(CROWN.art)
      } else {
        // As many rows as the text scene would take, the region's columns wide; the pick laid over the cell between the feet.
        expect(rows).toEqual([])
        const source = String(svg?.props?.source)
        const drawn = svgRows(source)
        expect(drawn.join('\n')).toContain(CROWN.art)
        expect(drawn.join('\n')).toContain(LAPTOP)
        expect(svg?.props?.width).toBe(72 * CELL_WIDTH)
        expect(svg?.props?.height).toBe(drawn.length * CELL_HEIGHT)
        expect(svg?.props?.alt).toBe('2 mascots: session watching, general-purpose typing')
        const scene = await ui.find({ type: 'Box', key: 'mascots' })
        expect(scene?.props.flexGrow).toBe(1)
        const box = (scene?.children ?? [])[0] as { props: Record<string, unknown>; children: { type: string; props: Record<string, unknown>; children: { props: Record<string, unknown> }[] }[] }
        expect(box.props).toMatchObject({ height: drawn.length, width: 72 })
        const pick = box.children.find(child => child.type === 'Box')
        expect(pick?.props).toMatchObject({ position: 'absolute', width: 1, height: 1 })
        expect(pick?.children[0]?.props).toMatchObject({ key: 'pick:a', label: '▾' })
        const legs = drawn[Number(pick?.props.top)] ?? ''
        expect(legs.slice(Number(pick?.props.left) - 2, Number(pick?.props.left) + 3)).toBe('▘▘ ▝▝')
      }
      await ui.unmount()
    }
  })

  test('a pane with under four spare rows, or narrower than a slot, draws no scene at all', async ($, on) => {
    arrange(on, [TYPIST])
    for (const surface of SURFACES) {
      const short = await mount($, surface, 72, 6)
      expect(await short.find({ type: 'Client' })).toBe(undefined)
      await short.unmount()
    }
  })
})

describe('the pointer', () => {
  test('a press lifts a mascot: it dangles, its laptop gone; it follows the pointer; let go, it flies on and comes down on the floor', async ($, on) => {
    const { world } = arrange(on, [TYPIST])
    for (const surface of SURFACES) {
      // A pane where its head is seven rows down or more: room to carry it five rows up and throw it higher.
      let ui = await mount($, surface)
      let rows = await rowsOf(ui)
      let at = headAt(rows, `${HEADS.right.trim()}  ${LAPTOP}`)!
      for (let body = 26; at.y < 7 && body <= 48; body += 2) {
        await ui.unmount()
        ui = await mount($, surface, 72, body)
        rows = await rowsOf(ui)
        at = headAt(rows, `${HEADS.right.trim()}  ${LAPTOP}`)!
      }
      expect(at.y).toBeGreaterThanOrEqual(7)
      // Its floor: its legs' row, two under its head, at its depth in the field.
      const floor = at.y + 2
      const before = world.writes.length
      await ui.pointer({ type: 'down', x: at.x, y: at.y, button: 'left' })
      await ui.pointer({ type: 'move', x: at.x + 1, y: at.y - 2, button: 'left' })
      await ui.advance(FRAME_MS)
      const held = await rowsOf(ui)
      // Dangling: eyes wide, arms up, legs kicking; the laptop popped away.
      expect(held.join('\n')).toContain(WIDE)
      expect(held.join('\n')).not.toContain(LAPTOP)
      const grabbed = headAt(held, WIDE)!
      expect(grabbed.y).toBe(at.y - 2)
      // Dragged up and right, frame by frame, then let go.
      for (let step = 1; step <= 3; step += 1) {
        await ui.pointer({ type: 'move', x: at.x + 1 + 2 * step, y: at.y - 2 - step, button: 'left' })
        await ui.advance(FRAME_MS)
      }
      expect(headAt(await rowsOf(ui), WIDE)?.y).toBe(at.y - 5)
      await ui.pointer({ type: 'up', x: at.x + 7, y: at.y - 5, button: 'left' })
      // The arc: up first, then down, row by row, moving right.
      const path: { x: number; y: number }[] = []
      for (let frame = 0; frame < 60; frame += 1) {
        await ui.advance(FRAME_MS)
        const where = headAt(await rowsOf(ui), WIDE)
        if (where === undefined) break
        path.push(where)
      }
      const top = Math.min(...path.map(one => one.y))
      expect(top).toBeLessThan(at.y - 5)
      const peak = path.findIndex(one => one.y === top)
      for (let index = 1; index <= peak; index += 1) expect(path[index]!.y).toBeLessThanOrEqual(path[index - 1]!.y)
      for (let index = peak + 1; index < path.length; index += 1) expect(path[index]!.y).toBeGreaterThanOrEqual(path[index - 1]!.y)
      expect(path.at(-1)!.x).toBeGreaterThan(at.x + 7)
      // Down from that height it is knocked out: flat, then dizzy, on its own floor (a throw keeps its depth).
      let dizzy = false
      for (let frame = 0; frame < 40 && !dizzy; frame += 1) {
        await ui.advance(FRAME_MS)
        const now = await rowsOf(ui)
        const y = now.findIndex(row => DIZZY.test(row))
        if (y >= 0) {
          dizzy = true
          expect(y).toBe(floor)
        }
      }
      expect(dizzy).toBe(true)
      // Nothing of it was written: the motion is the surface's.
      expect(world.writes.length).toBe(before)
      await ui.unmount()
    }
  })

  test('let go gently it is set down where it is, then walks back to its place and its laptop comes back', async ($, on) => {
    arrange(on, [TYPIST])
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const rows = await rowsOf(ui)
      const at = headAt(rows, `${HEADS.right.trim()}  ${LAPTOP}`)!
      await ui.pointer({ type: 'down', x: at.x, y: at.y, button: 'left' })
      // Ten cells right and a row up, then held still long enough to throw nothing.
      await ui.pointer({ type: 'move', x: at.x + 10, y: at.y - 1, button: 'left' })
      await ui.advance(4 * FRAME_MS)
      await ui.pointer({ type: 'up', x: at.x + 10, y: at.y - 1, button: 'left' })
      await ui.advance(12 * FRAME_MS)
      const landed = await rowsOf(ui)
      expect(landed.join('\n')).not.toContain(WIDE)
      expect(landed.some(row => DIZZY.test(row))).toBe(false)
      // Walking home without its laptop, then at its laptop in its place again.
      let away = false
      let home = false
      for (let frame = 0; frame < 120 && !home; frame += 1) {
        await ui.advance(FRAME_MS)
        const now = await rowsOf(ui)
        if (!now.join('\n').includes(LAPTOP)) away = true
        home = away && headAt(now, `${HEADS.right.trim()}  ${LAPTOP}`)?.x === at.x
      }
      expect(away).toBe(true)
      expect(home).toBe(true)
      await ui.unmount()
    }
  })

  test('a click (up within 300 ms, under a cell away) on an agent inspects it: the hooks select it, its detail view takes the scene\'s place; on the crowned one it asks for `main`', { options: { inspectView: 'pane' } }, async ($, on) => {
    const { held, world } = arrange(on, [TYPIST])
    for (const surface of SURFACES) {
      held.set('selected', { value: null, version: (held.get('selected')?.version ?? 0) + 1 })
      const ui = await mount($, surface)
      const rows = await rowsOf(ui)
      // The session's mascot, under its crown: a click asks the hooks to inspect `main`, the session's own.
      const crowned = rows.findIndex(row => row.includes(CROWN.art))
      const crown = { x: rows[crowned]!.indexOf(CROWN.art) + 1, y: crowned + 1 }
      await ui.pointer({ type: 'down', x: crown.x, y: crown.y, button: 'left' })
      await ui.pointer({ type: 'up', x: crown.x, y: crown.y, button: 'left' })
      expect(held.get('selected')?.value).toEqual({ id: 'main', kind: 'main' })
      // Whatever the hooks make of it, the scene is back for the rest.
      held.set('selected', { value: null, version: (held.get('selected')?.version ?? 0) + 1 })
      await ui.redraw()
      const at = headAt(rows, `${HEADS.right.trim()}  ${LAPTOP}`)!
      // Held too long: no click.
      await ui.pointer({ type: 'down', x: at.x, y: at.y, button: 'left' })
      await ui.advance(400)
      await ui.pointer({ type: 'up', x: at.x, y: at.y, button: 'left' })
      expect(held.get('selected')?.value ?? null).toBe(null)
      await ui.advance(2000)
      const settled = await rowsOf(ui)
      const again = headAt(settled, `${HEADS.right.trim()}  ${LAPTOP}`)!
      const writes = world.writes.length
      await ui.pointer({ type: 'down', x: again.x, y: again.y, button: 'left' })
      await ui.advance(FRAME_MS)
      await ui.pointer({ type: 'up', x: again.x, y: again.y, button: 'left' })
      expect(held.get('selected')?.value as HudSelection).toEqual({ id: 'a', kind: 'agent' })
      expect(world.writes.slice(writes)).toContain('selected')
      await ui.redraw()
      expect(await ui.find({ key: 'detail:back' })).toBeDefined()
      // Inspect keeps the same keyed Client, paused in a zero-height region.
      const paused = await ui.find({ type: 'Client' })
      expect(paused?.key).toBe('mascots')
      expect(paused?.props.height).toBe(0)
      expect((paused?.props.props as SceneInputs & { paused?: boolean }).paused).toBe(true)
      await ui.advance(2000)
      expect(await rowsOf(ui)).toEqual([])
      await ui.press({ key: 'detail:back' })
      await ui.redraw()
      expect(await ui.find({ type: 'Client' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a post the hooks do not know, or naming no agent, selects nothing', async ($, on) => {
    const { held } = arrange(on, [TYPIST])
    const ui = await mount($, 'terminal')
    const posts: JsonValue[] = ['inspect', { kind: 'inspect' }, { kind: 'inspect', id: 'nobody' }, { kind: 'throw', id: 'a' }, null]
    for (const data of posts) await ui.post(data)
    expect(held.get('selected')?.value ?? null).toBe(null)
    await ui.post({ kind: 'inspect', id: 'a' })
    expect(held.get('selected')?.value).toEqual({ id: 'a', kind: 'agent' })
    await ui.unmount()
  })

  test('with inspect off a click posts nothing', { options: { inspect: false } }, async ($, on) => {
    const { held, world } = arrange(on, [TYPIST])
    const ui = await mount($, 'terminal')
    const at = headAt(await rowsOf(ui), `${HEADS.right.trim()}  ${LAPTOP}`)!
    await ui.pointer({ type: 'down', x: at.x, y: at.y, button: 'left' })
    await ui.pointer({ type: 'up', x: at.x, y: at.y, button: 'left' })
    expect(held.has('selected')).toBe(false)
    expect(world.writes).not.toContain('selected')
    await ui.unmount()
  })
})

describe('its own clock', () => {
  test('a smooth redraw leaves another surface classic clock and plan alive', async ($, on) => {
    const { held, clock } = arrange(on, [TYPIST])
    const classic = await mount($, 'vscode')
    await clock.advance(250)
    await classic.redraw()
    const smooth = await mount($, 'terminal')
    const before = held.get('sceneTick')?.version ?? 0
    await smooth.redraw()
    await clock.advance(250)
    expect(held.get('sceneTick')?.version ?? 0).toBeGreaterThan(before)
    await classic.redraw()
    await classic.unmount()
    await clock.advance(2500)
    const stopped = held.get('sceneTick')?.version ?? 0
    await smooth.redraw()
    await clock.advance(500)
    expect(held.get('sceneTick')?.version ?? 0).toBe(stopped)
    await smooth.unmount()
  })

  test('no state is written while it runs: the hooks are not ticking the scene; its clock runs only while it is drawn', async ($, on) => {
    const { world, clock } = arrange(on, [TYPIST, entry('w', { startedAt: NOW - 30_000 }), entry('e', { type: 'Explore', startedAt: NOW - 20_000, currentTool: 'Read' })])
    for (const surface of SURFACES) {
      const ui = await mount($, surface, 100, 30)
      const first = await rowsOf(ui)
      const before = world.writes.length
      await ui.advance(10_000)
      expect(world.writes.length).toBe(before)
      // It moved: frames differ.
      expect(await rowsOf(ui)).not.toEqual(first)
      // The hooks' own second redraws hand it new props; no write of the scene's follows.
      await clock.advance(3000)
      await ui.redraw()
      expect(world.writes.filter(key => key === 'sceneTick')).toHaveLength(0)
      await ui.unmount()
      await expect(ui.advance(FRAME_MS)).rejects.toBeDefined()
    }
  })
})
