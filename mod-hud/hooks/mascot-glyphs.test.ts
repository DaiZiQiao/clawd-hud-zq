import { describe, expect, test } from 'claude-code/testing'

import { boxed, cellOf, drawnAlone, figureIn, placementOf, spriteOf, windowOf } from './mascot-glyphs.fixtures'
import { spriteSheet } from './mascot-sheet.fixtures'
import type { SheetEntry } from './mascot-sheet.fixtures'
import { ACCESSORIES, ACCESSORY_NAMES, BLANKET, CROWN, HAT_X, HEADS, LAPTOP_COLOUR, ROLE_LETTERS, SLOT, SQUASHED, THOUGHTS, TORSOS } from './mascot-sprites'
import { CLASHES, PALETTE, accessoryOf, energyOf, roleOf, sceneOf, sideOf } from './scene-model'
import { KIT_COLOURS, NOW, SCENE_COLOURS, crowd, entry, idleHud, oneAgent, working } from './scene-model.fixtures'
import { SCENE_FRAME_MS } from './scene-phases'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { T0, room, run } from './scene-plan.fixtures'
import { mascotLines } from './scene-render.fixtures'
import type { Cell, MascotLayout, MascotScene } from './scene-types'

// A mascot drawn into cells: the figure whole and in its colour, its air
// row (the crown, the role letter, the accessory, the energy), and the
// laptop in its own cells.

describe('accessories and the crown', () => {
  test('the session always wears the crown, in its gold; no agent ever does', () => {
    const scenes: MascotScene[] = [
      { main: { mood: 'idle', sweating: false, idleMs: 0 }, agents: [] },
      { main: { mood: 'thinking', sweating: true }, agents: [working('a', 'typing')] },
      { main: { mood: 'watching', sweating: false, stretchMs: 0 }, agents: [working('b', 'thinking', { status: 'done', endedMs: 0 })] },
    ]
    for (const scene of scenes) {
      for (let tick = 0; tick < 12; tick += 1) {
        const placed = placedSprites(scene, room(72, 4, tick))!
        const crowned = placed.sprites.filter(one => one.cells.some(row => row.some(cell => cell?.colour === CROWN.colour)))
        expect(crowned.map(one => one.id)).toEqual(['main'])
        const crown = crowned[0]?.cells.flat().filter(cell => cell?.colour === CROWN.colour) ?? []
        expect(crown.map(cell => cell?.ch).join('')).toBe(CROWN.art)
        for (const cell of crown) expect(cell).toEqual(expect.objectContaining({ ink: 'k', colour: CROWN.colour }))
      }
    }
    for (const { name, frames } of spriteSheet()) {
      if (name.startsWith('main')) expect(frames.every(frame => frame.join('').includes(CROWN.art)), name).toBe(true)
      if (name.startsWith('agent') || name.startsWith('child') || name.startsWith('workflow')) expect(frames.some(frame => frame.join('').includes(CROWN.art)), name).toBe(false)
    }
  })

  test('an agent\'s role letter rides centred above its head in every frame, walking, hopping and flying; its thought rises beside it', () => {
    const { lines, plans } = run(() => oneAgent(working('agent-7', 'thinking', { role: 'worker' })), tick => room(100, 9, T0 + tick, { wander: true }), 300)
    const kinds = new Set<string>()
    lines.forEach((frame, index) => {
      const one = plans[index]!.placements.find(p => p.id === 'agent-7')!
      kinds.add(one.motion?.kind ?? 'none')
      // The letter over its head's centre (its box's column 6), the head right under it.
      const row = frame.findIndex(text => text[one.drawnX + 6] === 'w')
      expect(row, `${index}: ${one.motion?.kind}\n${frame.join('\n')}`).toBeGreaterThanOrEqual(0)
      expect(frame[row + 1]?.slice(one.drawnX + 3, one.drawnX + 10), `${index}: ${one.motion?.kind}\n${frame.join('\n')}`).toMatch(/^(▐.{5}▌|█▛███▜█)$/)
    })
    expect([...kinds]).toEqual(expect.arrayContaining(['walk', 'hop']))
    expect(lines.some(frame => frame.some(row => /·/.test(row)))).toBe(true)
  })
})

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

  return linear.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
}
const contrast = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

const fullEntries = (): SheetEntry[] => spriteSheet().filter(entry => !entry.name.startsWith('child'))

describe('the figure', () => {
  test('every frame of every full mascot shows the figure whole: head, torso and legs from the body tables, every cell in its colour, nothing foreign on it', () => {
    for (const { name, frames, cells } of fullEntries()) {
      frames.forEach((frame, index) => {
        const label = `${name} #${index}\n${frame.join('\n')}`
        const at = figureIn(frame)
        expect(at, label).toBeDefined()
        if (at === undefined) return
        const grid = cells[index]!
        // The session's frames hold two figures in one entry; the colour is the figure's own.
        const own = grid[at.head]?.[at.x + 1]?.colour
        for (let x = at.x + 1; x <= at.x + 7; x += 1) expect(grid[at.head]?.[x], `${label}: head`).toEqual(expect.objectContaining({ ink: 'b', colour: own }))
        for (const x of [at.x, at.x + 8]) expect([undefined, 'b'], `${label}: beside the head`).toContain(grid[at.head]?.[x]?.ink)
        for (const { row, x } of at.rows) {
          for (let column = x; column < x + 9; column += 1) {
            const cell = grid[row]?.[column]
            if (cell === undefined) continue
            const blanket = cell.ink === 'k' && cell.colour === BLANKET.colour
            expect(cell.ink === 'b' && cell.colour === own ? true : blanket, `${label}: row ${row} col ${column}`).toBe(true)
          }
        }
      })
    }
  })

  test('the foreground draws only the role letter, centred above the head, and the phrase of a thought', () => {
    for (const { name, frames, cells } of spriteSheet()) {
      frames.forEach((frame, index) => {
        const at = figureIn(frame)
        cells[index]!.forEach((row, y) => row.forEach((cell, x) => {
          if (cell?.ink !== 'f') return
          const letter = at !== undefined && !at.flat && y === at.head - 1 && x === at.x + 4 && /^[rdpwfe]$/.test(cell.ch)
          expect(letter || THOUGHTS.some(phrase => phrase.includes(cell.ch)) || cell.ch === '…', `${name} #${index} (${y}, ${x}) "${cell.ch}"`).toBe(true)
          if (letter) expect(y, name).toBe(at!.head - 1)
        }))
      })
    }
  })

  test('only a hop\'s take-off and landing squash it, and then its eyes stay', () => {
    const squashed = spriteSheet().flatMap(({ name, frames }) => frames.filter(frame => frame.some(row => row.includes(SQUASHED[1]))).map(() => name))
    expect(new Set(squashed.map(name => name.split(' (')[0]))).toEqual(new Set(['agent · hop', 'agent · flying under the propeller cap']))
    expect([...SQUASHED[0]].filter(glyph => /[▛▜]/.test(glyph))).toHaveLength(2)
  })

  test('the laptop stands in its own cells right of the figure, its deck reaching back under the near hand, and never on the figure', () => {
    let seen = 0
    for (const { name, frames, cells } of fullEntries()) {
      frames.forEach((frame, index) => {
        const grid = cells[index]!
        const laptop = grid.flatMap((row, y) => row.flatMap((cell, x) => (cell?.ink === 'k' && cell.colour === LAPTOP_COLOUR ? [{ x, y }] : [])))
        if (laptop.length === 0) return
        seen += 1
        const at = figureIn(frame)!
        expect(at.x + 8, `${name}: the figure ends at column 10`).toBeLessThanOrEqual(10)
        expect(Math.min(...laptop.map(one => one.x)), name).toBeGreaterThanOrEqual(11)
        for (const { row, x } of [{ row: at.head, x: at.x }, ...at.rows]) {
          for (let column = x; column < x + 9; column += 1) expect(laptop.some(one => one.y === row && one.x === column), name).toBe(false)
        }
        // The near hand on the keys, in its colour, on the torso row at column 11, every other frame.
        const hand = grid[at.head + 1]?.[11]
        if (hand !== undefined) expect([['▖', 'b'], ['⇢', 'b']], name).toContainEqual([hand.ch, hand.ink])
      })
    }
    expect(seen).toBeGreaterThan(5)
    const desk = drawnAlone(oneAgent(working('a', 'typing')), 'a', 0)
    expect(desk.slice(1).map(row => row.slice(11))).toEqual([' ▗▄▄▄▖', '▖▐▒▒▒▌', '▀▀▀▀▀▀'])
  })

  test('the air row: the session\'s crown centred, or an agent\'s letter centred with its hat at one end; never both', () => {
    for (const { name, frames } of fullEntries()) {
      frames.forEach((frame, index) => {
        const at = figureIn(frame)
        if (at === undefined || at.flat) return
        const air = windowOf(frame, at.head - 1, at.x)
        const crowned = air.slice(3, 6) === CROWN.art
        const lettered = /^[rdpwfe]$/.test(air[4] ?? '')
        expect(crowned && lettered, `${name} #${index}: "${air}"`).toBe(false)
        if (name.startsWith('main')) expect(crowned, `${name} #${index}: "${air}"`).toBe(true)
        // No thought ever sits on the air row over the head.
        expect(/[·∘○(]/.test(air), `${name} #${index}: "${air}"`).toBe(false)
      })
    }
  })

  test('the crown is the session\'s alone, in its fixed gold, never covered: a message bubble goes over it, or waits', () => {
    for (const background of ['#282a36', '#eff1f5']) expect(contrast(CROWN.colour, background)).toBeGreaterThanOrEqual(3)
    for (const { name, frames, cells } of spriteSheet()) {
      if (name.startsWith('main')) for (const frame of frames) expect(frame.join('\n'), name).toContain(CROWN.art)
      // The crown only ever on a figure in the accent: the session's.
      frames.forEach((frame, index) => {
        const at = figureIn(frame)
        const crowned = frame.join('').includes(CROWN.art)
        if (at !== undefined) expect(crowned, `${name} #${index}`).toBe(cells[index]![at.head]![at.x + 1]?.colour === 'claude')
      })
    }
    const crown = spriteOf(oneAgent(working('a', 'thinking')), 'main').cells[1]!.slice(5, 8)
    expect(crown.map(cell => [cell?.ch, cell?.ink, cell?.colour, cell?.hat])).toEqual([...CROWN.art].map(ch => [ch, 'k', CROWN.colour, true]))
    const board: MascotScene = { main: { mood: 'watching', sweating: false }, agents: [working('a', 'thinking')], events: [{ kind: 'message', from: 'a', to: 'main', tick: 0 }] }
    for (const rows of [4, 5]) {
      for (let tick = 0; tick < 24; tick += 1) {
        const room = { columns: 40, rows, tick, scenes: true }
        const plan = mascotPlan(board, room)!
        const lines = mascotLines(board, room, plan) ?? []
        // The session at the front: its box the frame's last four rows.
        const sky = lines.length - 4
        expect(lines[sky]?.slice(5, 8), `${rows} rows @${tick}`).toBe(CROWN.art)
        const bubble = plan.marks.find(mark => mark.ch === '○')
        // Over the crown with no sky, it waits; with a sky row, it passes above.
        if (bubble !== undefined && bubble.x >= 5 && bubble.x <= 7) expect(lines.join('').includes('○'), `${rows} rows @${tick}`).toBe(rows === 5)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// What an agent wears: its accessory, its letter, its energy.
// ---------------------------------------------------------------------------

describe('accessories', () => {
  test('eight, each 1 to 3 cells (2 on a mini) in a colour of its own with 3:1 on both backgrounds; the kit too', () => {
    expect(ACCESSORY_NAMES).toEqual(['beanie', 'cap', 'tophat', 'flower', 'bow', 'halo', 'note', 'propeller'])
    expect(new Set(Object.values(ACCESSORIES).map(one => one.colour)).size).toBe(8)
    for (const colour of KIT_COLOURS) {
      expect(colour).toMatch(/^#[0-9A-F]{6}$/)
      for (const background of ['#282a36', '#eff1f5']) expect(contrast(colour, background), `${colour} on ${background}`).toBeGreaterThanOrEqual(3)
    }
    for (const colour of KIT_COLOURS) expect(SCENE_COLOURS).toContain(colour)
  })

  test('never one close in hue to the body; first not worn before it in spawn order; a repeat only when all are worn', () => {
    expect(Object.keys(CLASHES).sort()).toEqual([...PALETTE].sort())
    const ids = Array.from({ length: 120 }, (_, index) => `agent-${index * 37}`)
    for (const colour of PALETTE) {
      const allowed = ACCESSORY_NAMES.filter(name => !CLASHES[colour]!.includes(name))
      for (const id of ids) {
        const first = accessoryOf(id, colour)
        expect(CLASHES[colour], `${id} in ${colour}`).not.toContain(first)
        expect(accessoryOf(id, colour)).toBe(first)
        // Worn before it: the next of its own order.
        const second = accessoryOf(id, colour, new Set([first]))
        expect(second).not.toBe(first)
        expect(allowed).toContain(second)
        // All worn: a repeat, its first again.
        expect(accessoryOf(id, colour, new Set(ACCESSORY_NAMES))).toBe(first)
      }
      // The order is per id: every allowed one comes first for some id.
      expect(new Set(ids.map(id => accessoryOf(id, colour)))).toEqual(new Set(allowed))
    }
    // Copper wears no beanie, bow or halo; olive any.
    expect(CLASHES['#B26C4B']).toEqual(['beanie', 'bow', 'halo'])
    expect(CLASHES['#6D8632']).toEqual([])
  })

  test('in the scene: in spawn order, no two alike while there are enough, each at an end of its own; held while it stays', () => {
    const scene = sceneOf(crowd(6), idleHud, NOW)
    const worn = scene.agents.map(one => one.accessory)
    expect(worn.every(one => one !== undefined)).toBe(true)
    expect(new Set(worn).size).toBe(6)
    for (const one of scene.agents) {
      expect(CLASHES[one.colour]).not.toContain(one.accessory)
      expect(one.side).toBe(sideOf(one.id))
    }
    expect(new Set(Array.from({ length: 40 }, (_, index) => sideOf(`id-${index}`)))).toEqual(new Set(['left', 'right']))
    // An agent spawned beside an earlier one keeps its accessory after that one has long gone.
    const first = entry('first', { startedAt: NOW - 120_000 })
    const later = entry('later', { startedAt: NOW - 60_000 })
    const before = sceneOf([first, later], idleHud, NOW).agents.find(one => one.id === 'later')?.accessory
    const after = sceneOf([{ ...first, status: 'done', endedAt: NOW - 50_000 }, later], idleHud, NOW).agents.find(one => one.id === 'later')?.accessory
    expect(after).toBe(before)
    // Drawn on its corner of the head, in its colour; the letter centred; a mini wears its two cells over its head.
    for (const side of ['left', 'right'] as const) {
      const sprite = spriteOf(oneAgent(working('a', 'thinking', { accessory: 'tophat', side, role: 'worker', idleMs: 2 * SCENE_FRAME_MS })), 'a')
      const air = sprite.cells[1]!
      const from = HAT_X[side]
      expect(air.slice(from, from + 3).map(cell => cell?.ch).join('')).toBe(ACCESSORIES.tophat.art)
      expect(air.slice(from, from + 3).every(cell => cell?.ink === 'k' && cell.colour === ACCESSORIES.tophat.colour && cell.hat === true)).toBe(true)
      expect(air[6]).toEqual(expect.objectContaining({ ch: 'w', ink: 'f', hat: true }))
    }
    const child: MascotScene = { main: { mood: 'watching', sweating: false }, agents: [working('p', 'thinking'), working('c', 'typing', { parentId: 'p', accessory: 'beanie' })] }
    const mini = spriteOf(child, 'c', 0, 4, 60)
    expect(mini.cells[2]!.slice(2, 4).map(cell => [cell?.ch, cell?.colour])).toEqual([['▗', ACCESSORIES.beanie.colour], ['▖', ACCESSORIES.beanie.colour]])
  })
})

describe('energy', () => {
  test('by effort: none for low, medium or unknown; one for high; two for xhigh and max; numbers by thresholds', () => {
    for (const effort of [undefined, '', 'low', 'medium', 'minimal', 'something-new']) expect(energyOf(effort), String(effort)).toBe(0)
    expect(energyOf('high')).toBe(1)
    for (const effort of ['xhigh', 'max', 'maximum-effort', 'ultra', 'XHigh']) expect(energyOf(effort), effort).toBe(2)
    expect(['1024', '16383', '16384', '32767', '32768'].map(energyOf)).toEqual([0, 0, 1, 1, 2])
  })

  test('an agent\'s energy tracks its effort, the session\'s the session\'s; every body the same figure', () => {
    const at = (effort?: string) => sceneOf([entry('a', { currentTool: 'Edit', ...(effort === undefined ? {} : { effort }) })], { ...idleHud, session: { ...idleHud.session, effort: effort ?? '' } }, NOW)
    expect(at().agents[0]?.energy).toBe(undefined)
    expect(at().main.energy).toBe(undefined)
    for (const [effort, energy] of [['low', undefined], ['medium', undefined], ['high', 1], ['xhigh', 2], ['max', 2]] as const) {
      const scene = at(effort)
      expect(scene.agents[0]?.energy, effort).toBe(energy)
      expect(scene.main.energy, effort).toBe(energy)
      const one = placementOf(scene, layout(72, 4), 'a')!
      expect(one.width, effort).toBe(SLOT)
      // At its laptop, the same figure whatever the effort.
      expect(cellOf(mascotLines(scene, layout(72, 4)) ?? [], one, 72)[2], effort).toBe(boxed(TORSOS.point, '▖▐▒▒▒▌'))
    }
    const shadowed = sceneOf([], idleHud, NOW, { shadows: [{ id: 'wf', firstSeen: NOW - 60_000, lastSeen: NOW, steps: 2, toolCalls: 1, status: 'running', effort: 'xhigh' }] })
    expect(shadowed.agents[0]?.energy).toBe(2)
  })

  test('drawn at the end of the air row its hat leaves: ✦ for high, ✦✦ for xhigh, in the warning colour', () => {
    const air = (extra: Parameters<typeof working>[2]) => spriteOf(oneAgent(working('a', 'thinking', { idleMs: 2 * SCENE_FRAME_MS, ...extra })), 'a').cells[1]!
    const text = (cells: readonly (Cell | undefined)[]) => cells.map(cell => cell?.ch ?? ' ').join('')
    // The hat on the head's corner, flush with its side; the energy at the air row's other end.
    expect(text(air({ accessory: 'beanie', side: 'left' })).trimEnd()).toBe('   ▗▄▖')
    expect(text(air({ accessory: 'beanie', side: 'left', energy: 1 })).slice(2, 11)).toBe(' ▗▄▖   ✦ ')
    expect(text(air({ accessory: 'beanie', side: 'left', energy: 2 })).slice(2, 11)).toBe(' ▗▄▖   ✦✦')
    expect(text(air({ accessory: 'beanie', side: 'right', energy: 1 })).slice(2, 11)).toBe(' ✦   ▗▄▖ ')
    expect(text(air({ accessory: 'beanie', side: 'right', energy: 2 })).slice(2, 11)).toBe('✦✦   ▗▄▖ ')
    expect(air({ energy: 2 })[9]).toEqual(expect.objectContaining({ ch: '✦', ink: 'y' }))
    const session = spriteOf({ main: { mood: 'watching', sweating: false, energy: 2 }, agents: [] }, 'main').cells[1]!
    expect(text(session).slice(2, 11)).toBe(`   ${CROWN.art} ✦✦`)
  })
})

describe('role letters', () => {
  test('types map to roles; one letter centred above the head in the foreground, the head itself untouched; none for any other type', () => {
    expect(['reviewer', 'mod-review-gates:reviewer', 'debugger', 'Plan', 'worker', 'frontend', 'Explore', 'researcher', 'general-purpose'].map(roleOf))
      .toEqual(['reviewer', 'reviewer', 'debugger', 'planner', 'worker', 'frontend', 'explorer', 'explorer', undefined])
    for (const [role, letter] of Object.entries(ROLE_LETTERS)) {
      for (const activity of ['thinking', 'typing'] as const) {
        const cell = drawnAlone(oneAgent(working('a', activity, { role: role as keyof typeof ROLE_LETTERS })), 'a')
        expect(cell[0]?.trimEnd(), `${role} ${activity}`).toBe(`      ${letter}`)
        expect(cell[1]?.slice(2, 11), role).toBe(activity === 'typing' ? HEADS.right : HEADS.up)
      }
      const sprite = spriteOf(oneAgent(working('a', 'typing', { role: role as keyof typeof ROLE_LETTERS })), 'a')
      expect(sprite.cells[1]?.[6], role).toEqual(expect.objectContaining({ ch: letter, ink: 'f' }))
      expect(sprite.cells[2]?.slice(3, 10).every(cell => cell?.ink === 'b')).toBe(true)
    }
    expect(drawnAlone(oneAgent(working('a', 'typing')), 'a')[0]?.trim()).toBe('')
  })
})
