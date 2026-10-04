import { describe, expect, test } from 'claude-code/testing'

import { boxed, drawnAlone, figureIn, rowsOf, spriteOf, windowOf } from './mascot-glyphs.fixtures'
import { spriteSheet } from './mascot-sheet'
import type { SheetEntry } from './mascot-sheet'
import { ACCESSORIES, BLANKET, CROUCHED, CROWN, HAT_X, HEADS, LEANING, LEGS, OVERLAYS, SLOT, SQUASHED, THOUGHTS, TORSOS, WALK_LEGS, flipped, thoughtBubble } from './mascot-sprites'
import { sceneOf } from './scene-model'
import { DONE_HOLD, NOW, entry, family, idleHud, oneAgent, working } from './scene-model.fixtures'
import { BLANKET_AFTER_MS, CHEER_TICKS, IDLE_SLOT_MS, LONG_IDLE_MS, SCENE_FRAME_MS, idleBitOf } from './scene-phases'
import { placedSprites } from './scene-placement'
import { mascotPlan } from './scene-plan'
import { T0, room, run } from './scene-plan.fixtures'
import { mascotLines } from './scene-render'
import type { MascotAgent, MascotLayout, MascotPlan, MascotScene } from './scene-types'
import { displayWidth } from './text-width'

// A mascot's looks frame by frame: at work, thinking, stalled, idle, asleep,
// the walk, the hop, flying, knocked over, the cheer; and the laptop's
// routine.

describe('the laptop routine', () => {
  const cellOf = (agent: MascotAgent, tick = 0): string[] => {
    const scene = oneAgent(agent)
    const layout = room(40, 4, tick)
    const one = mascotPlan(scene, layout)!.placements.find(p => p.id === agent.id)!

    return (mascotLines(scene, layout) ?? []).map(row => row.padEnd(40).slice(one.drawnX, one.drawnX + one.width))
  }

  // The laptop's frames while a tool runs: "looks", "at work".
  test('thinking, no laptop: eyes up, its thought beside it', () => {
    // Thinking, eyes up, its thought beside it (a row lower: this line has no sky).
    const thinking = cellOf(working('a', 'thinking'), 0)
    expect(thinking[1]).toBe(boxed(HEADS.up))
    expect(thinking[2]).toBe(boxed(TORSOS.rest, '·'))
  })

  test('the laptop only at work: stalled and asking show none', () => {
    for (const agent of [working('a', 'thinking', { status: 'stalled' }), working('a', 'asking')]) {
      expect(cellOf(agent).join('')).not.toMatch(/▀▀▀▀▀▀|▗▄▄▄▖|▐▒▒▒▌/)
    }
  })

  test('the laptop pops in when a tool starts and out when it ends: no frames in between', () => {
    const sceneAt = (tick: number) => oneAgent(working('a', tick % 6 < 3 ? 'typing' : 'thinking'))
    const { lines, plans } = run(sceneAt, tick => room(40, 4, T0 + tick), 12)
    const a = plans[0]!.placements.find(one => one.id === 'a')!
    lines.forEach((frame, index) => {
      const cell = frame.map(row => row.padEnd(40).slice(a.drawnX, a.drawnX + a.width))
      expect(cell[3]?.endsWith('▀▀▀▀▀▀'), `frame ${index}`).toBe(index % 6 < 3)
    })
  })
})

const layout = (columns: number, rows = 8, tick = 0): MascotLayout => ({ columns, rows, tick })

/** One look of the sheet, by the start of its name. */
const sheetOf = (prefix: string): SheetEntry => {
  const one = spriteSheet().find(entry => entry.name.startsWith(prefix))
  if (one === undefined) throw new Error(`no sheet entry ${prefix}`)

  return one
}

describe('looks', () => {
  test('thinking phrases stay fixed within an eight-frame spell and change for the next spell, for agents and the session', () => {
    for (const id of ['a', 'main']) {
      const scene: MascotScene = { main: { mood: 'thinking', sweating: false }, agents: [working('a', 'thinking')] }
      let before: string | undefined
      for (let spell = 0; spell < 30; spell += 1) {
        const bubbles = [4, 5, 6, 7].map(frame => rowsOf(spriteOf(scene, id, spell * 8 + frame, 5))[0]?.trim())
        expect(new Set(bubbles).size).toBe(1)
        expect(bubbles[0]).toMatch(/^\(.+\)$/)
        expect(THOUGHTS.map(phrase => thoughtBubble(phrase))).toContain(bubbles[0]!)
        expect(displayWidth(bubbles[0]!)).toBeLessThanOrEqual(14)
        if (before !== undefined) expect(bubbles[0]).not.toBe(before)
        before = bubbles[0]
      }
    }
  })
  test('at work: the same laptop for every tool, the agent facing it and still, the near hand on the keys every other frame', () => {
    for (const activity of ['typing', 'reading', 'searching', 'lifting', 'fetching'] as const) {
      for (const tick of [0, 1, 2, 3]) {
        expect(drawnAlone(oneAgent(working('a', activity)), 'a', tick).slice(1), `${activity} at ${tick}`).toEqual([
          boxed(HEADS.right, ' ▗▄▄▄▖'),
          tick % 2 === 0 ? boxed(TORSOS.point, '▖▐▒▒▒▌') : boxed(TORSOS.rest, ' ▐▒▒▒▌'),
          boxed(LEGS.stand, '▀▀▀▀▀▀'),
        ])
      }
    }
  })

  test('thinking: eyes up at a thought growing beside the head, ·, then ∘, then (hmm) held; a row lower with no sky row', () => {
    expect(OVERLAYS.thought).toHaveLength(8)
    const bubbles = OVERLAYS.thought.map(frame => frame.art.join('').replace(/ /g, ''))
    expect(bubbles).toEqual(['·', '·', '∘·', '∘·', '(hmm)∘·', '(hmm)∘·', '(hmm)∘·', '(hmm)∘·'])
    const sky = (tick: number) => rowsOf(spriteOf(oneAgent(working('a', 'thinking')), 'a', tick, 5))
    expect(sky(0).slice(0, 3)).toEqual(['', '', `  ${HEADS.up}·`])
    expect(sky(2).slice(0, 3)).toEqual(['', '            ∘', `  ${HEADS.up}·`])
    const bubble = sky(4)[0]!.trim()
    const phrase = bubble.slice(1, -1)
    expect(THOUGHTS).toContain(phrase)
    expect(sky(4).slice(0, 3)).toEqual([bubble.padStart(Math.min(11, SLOT - bubble.length) + bubble.length), '            ∘', `  ${HEADS.up}·`])
    const thought = spriteOf(oneAgent(working('a', 'thinking')), 'a', 4, 5).cells[0]!.filter(cell => cell !== undefined && cell.ch !== ' ')
    expect(thought.map(cell => cell?.ink)).toEqual(['d', ...Array.from({ length: phrase.replace(/ /g, '').length }, () => 'f'), 'd'])
    // With no spare row, keep the badge/crown clear and truncate into the side strip.
    const lowBubble = thoughtBubble(phrase, SLOT - 11)
    expect(drawnAlone(oneAgent(working('a', 'thinking')), 'a', 4).map(row => row.trimEnd())).toEqual([`           ${lowBubble}`, `  ${HEADS.up} ∘`, `  ${TORSOS.rest}·`, `  ${LEGS.stand}`.trimEnd()])
    expect(drawnAlone(oneAgent(working('a', 'thinking')), 'a', 4)[1]?.slice(2, 11)).toBe(HEADS.up)
  })

  test('stalled: its idle bits and a turning clock beside its head; asking raises a hand', () => {
    const stalled = oneAgent(working('a', 'thinking', { status: 'stalled' }))
    expect([0, 2, 4, 6].map(tick => drawnAlone(stalled, 'a', tick)[0]?.[11])).toEqual(['◴', '◷', '◶', '◵'])
    // A stall is past 90 s quiet, so asleep under its blanket: the clock still turns, on the floor beside it, clear of its z z Z.
    const asleep = oneAgent(working('a', 'thinking', { status: 'stalled', idleMs: 240_000 }))
    for (const [tick, glyph] of [[0, '◴'], [2, '◷'], [4, '◶'], [6, '◵']] as const) {
      const rows = drawnAlone(asleep, 'a', tick)
      expect(rows[2]?.slice(2, 11), `@${tick}`).toBe(BLANKET.quilt[Math.floor(tick / 4) % 2])
      expect(rows[3]?.slice(2, 12), `@${tick}`).toBe(`${BLANKET.hem}${glyph}`)
      expect(rows.join('\n'), `@${tick}`).toMatch(/z/)
    }
    // Asking, the right hand up beside the head, on from its shoulder.
    expect(drawnAlone(oneAgent(working('a', 'asking')), 'a').map(row => row.trimEnd())).toEqual(['           ?', `  ${HEADS.open.trimEnd()}▌`, `  ${TORSOS.raised}`.trimEnd(), `  ${LEGS.stand}`.trimEnd()])
  })

  test('idle bits: the first slot looks around, each later slot a new bit by a hash of id and slot; from 90 s the blanket', () => {
    expect(IDLE_SLOT_MS).toBe(6000)
    expect(BLANKET_AFTER_MS).toBe(90_000)
    const ids = Array.from({ length: 60 }, (_, index) => `idler-${index}`)
    const seen = new Set<string>()
    for (const id of ids) {
      expect(idleBitOf(id, 0)).toBe('look')
      expect(idleBitOf(id, IDLE_SLOT_MS - 1)).toBe('look')
      let before = idleBitOf(id, 0)
      for (let slot = 1; slot < 15; slot += 1) {
        const bit = idleBitOf(id, slot * IDLE_SLOT_MS)
        expect(bit, `${id} slot ${slot}`).not.toBe(before)
        // The same bit the whole slot.
        expect(idleBitOf(id, slot * IDLE_SLOT_MS + IDLE_SLOT_MS - 1)).toBe(bit)
        seen.add(bit)
        before = bit
      }
      expect(idleBitOf(id, BLANKET_AFTER_MS)).toBe('blanket')
      expect(idleBitOf(id, LONG_IDLE_MS)).toBe('blanket')
    }
    expect(seen).toEqual(new Set(['look', 'stretch', 'sit', 'puff']))
  })

  test('idle frames: look around, stretch (once, then rest), sit (a blink), a puff of smoke, the blanket and its z z Z, the moon', () => {
    const frames = (prefix: string) => sheetOf(prefix).frames
    const heads = (prefix: string) => frames(prefix).map(frame => HEADS_BY_INNER.get(windowOf(frame, figureIn(frame)!.head, figureIn(frame)!.x).slice(1, 8)))
    // Eyes up look as open eyes do: the head's top is its outline.
    expect(heads('idle · look around')).toEqual(['left', 'left', 'open', 'open', 'right', 'right', 'open', 'open'])
    expect(heads('idle · stretch')).toEqual(['shut', 'shut', 'shut', 'shut', 'shut', 'shut', 'open', 'open'])
    expect(frames('idle · stretch').slice(0, 4).every(frame => armsUp(frame))).toBe(true)
    expect(heads('idle · sit').map((head, index) => [index, head]).filter(([, head]) => head === 'shut').map(([index]) => index)).toEqual([12, 13])
    expect(frames('idle · sit').every(frame => figureIn(frame)!.head + 1 === frame.length - 1 && frame[figureIn(frame)!.head + 1]?.includes(TORSOS.low))).toBe(true)
    expect(frames('idle · a puff').map(frame => frame.join('').replace(/[^╼·∘○]/g, ''))).toEqual(['·╼', '∘╼', '○╼', '╼'])
    const blanket = frames('idle · asleep under the blanket')
    expect(blanket.map(frame => frame.join('').replace(/[^zZ]/g, ''))).toEqual(['z', 'z', 'zz', 'zz', 'Zzz', 'Zzz', 'Zzz', 'Zzz'])
    expect(blanket.map(frame => frame.find(row => row.includes(BLANKET.quilt[0])) === undefined ? 'b' : 'a')).toEqual(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'])
    expect(blanket.every(frame => frame.some(row => row.includes(BLANKET.hem.trim())))).toBe(true)
    expect(frames('idle · asleep, idle 10 minutes').every(frame => frame.join('').includes('☾'))).toBe(true)
    expect(blanket.every(frame => !frame.join('').includes('☾'))).toBe(true)
  })

  test('an agent idle 90 s and still listed sleeps under its blanket; one idle less does its bits; neither wanders', () => {
    const at = (quiet: number) => sceneOf([entry('a', { lastActivityAt: NOW - quiet })], idleHud, NOW)
    expect(mascotLines(at(91_000), layout(40, 4))?.join('\n')).toContain(BLANKET.hem)
    expect(mascotLines(at(30_000), layout(40, 4))?.join('\n')).not.toContain(BLANKET.hem)
    for (const quiet of [30_000, 91_000]) {
      const scene = at(quiet)
      const xs = new Set<number>()
      let previous: MascotPlan | undefined
      for (let tick = 0; tick < 120; tick += 1) {
        previous = mascotPlan(scene, { columns: 100, rows: 8, tick, wander: true }, previous)
        xs.add(previous!.placements.find(one => one.id === 'a')!.drawnX)
      }
      expect(xs.size, `${quiet}`).toBe(1)
    }
  })

  test('the session mascot: idle bits, then its blanket and the moon; thinks; watches; sweats; stretches after a compaction', () => {
    const draw = (main: MascotScene['main'], tick = 4) => rowsOf(spriteOf({ main, agents: [] }, 'main', tick, 5, 20))
    expect(draw({ mood: 'idle', sweating: false, idleMs: 0 }, 0)[2]).toBe(`  ${HEADS.left}`.trimEnd())
    expect(draw({ mood: 'idle', sweating: false, idleMs: BLANKET_AFTER_MS }).slice(2).join('\n')).toContain(BLANKET.quilt[1])
    expect(draw({ mood: 'idle', sweating: false, idleMs: LONG_IDLE_MS })[1]?.startsWith('☾')).toBe(true)
    const thought = draw({ mood: 'thinking', sweating: false })
    expect(THOUGHTS).toContain(thought[0]!.trim().slice(1, -1))
    expect(thought.slice(1, 3)).toEqual([`     ${CROWN.art}    ∘`, `  ${HEADS.up}·`])
    expect(draw({ mood: 'watching', sweating: false })[2]).toBe(`  ${HEADS.right}`.trimEnd())
    expect(draw({ mood: 'watching', sweating: true }, 0)[2]?.[1]).toBe("'")
    expect(draw({ mood: 'idle', sweating: false, stretchMs: 0 }).slice(1, 4)).toEqual([`     ${CROWN.art}`, `  ▐${HEADS.shut.slice(1, 8)}▌`, `  ${TORSOS.up}`.trimEnd()])
  })

  test('a parent points at the child beside it, which stands smaller', () => {
    const scene = sceneOf(family, idleHud, NOW)
    const room = layout(72, 4)
    const lines = mascotLines(scene, room) ?? []
    const plan = mascotPlan(scene, room)
    // The session's slot is 17 cells, as is the parent's; then the minis.
    expect(plan?.placements.map(one => [one.id, one.kind, one.x])).toEqual([
      ['main', 'main', 0], ['parent', 'full', 18], ['child', 'mini', 36], ['grandchild', 'mini', 42],
    ])
    // Its arm out, the pointer after its slot, the child at its laptop.
    expect(lines[2]?.slice(18, 29)).toBe(`  ${TORSOS.point}`)
    expect(lines[2]?.[35]).toBe('▸')
    // Plan's letter above the parent's head.
    expect(lines[0]?.[24]).toBe('p')
  })

  test('a parent walking off leaves no pointer behind; parents naming each other still both stand', () => {
    const leaving: MascotScene = {
      main: { mood: 'watching', sweating: false },
      agents: [working('p', 'thinking', { status: 'done', endedMs: DONE_HOLD * SCENE_FRAME_MS }), working('c', 'thinking', { parentId: 'p' })],
    }
    expect(mascotLines(leaving, layout(72, 4))?.[2]).not.toContain('▸')
    const loop: MascotScene = {
      main: { mood: 'watching', sweating: false },
      agents: [working('x', 'thinking', { parentId: 'y' }), working('y', 'thinking', { parentId: 'x' })],
    }
    expect(mascotPlan(loop, layout(72, 4))?.placements.map(one => one.id).sort()).toEqual(['main', 'x', 'y'])
  })
})

// A head row's name: the first that draws it (eyes up draw as open), upside down too (flat on its back).
const HEADS_BY_INNER = new Map<string, string>()
for (const [name, row] of Object.entries(HEADS)) for (const one of [row, flipped(row)]) if (!HEADS_BY_INNER.has(one.slice(1, 8))) HEADS_BY_INNER.set(one.slice(1, 8), name)

/** Both arms up: a stub on from each shoulder beside the head. */
const armsUp = (frame: readonly string[]): boolean => {
  const at = figureIn(frame)
  const row = [...(frame[at?.head ?? -1] ?? '')]

  return at !== undefined && row[at.x] === '▐' && row[at.x + 8] === '▌'
}

describe('motion frames', () => {
  test('the walk: four frames, the feet passing; on 1 and 3 a bob a row up and the torso half a cell the way it goes; eyes that way', () => {
    for (const [prefix, facing, lean] of [['agent · walking right', 'right', 1], ['agent · walking left', 'left', -1]] as const) {
      const frames = sheetOf(prefix).frames
      expect(frames).toHaveLength(4)
      const found = frames.map(frame => figureIn(frame)!)
      const ground = found[0]!.head
      found.forEach((at, index) => {
        const lifted = index % 2 === 1
        expect(at.head, `${prefix} #${index}`).toBe(lifted ? ground - 1 : ground)
        expect(windowOf(frames[index]!, at.rows[0]!.row, at.rows[0]!.x), `${prefix} #${index}: lean`).toBe(lifted ? LEANING[lean === 1 ? 'right' : 'left'] : TORSOS.rest)
        expect(windowOf(frames[index]!, at.rows[1]!.row, at.x), `${prefix} #${index}: legs`).toBe(LEGS[WALK_LEGS[index]!])
        expect(HEADS_BY_INNER.get(windowOf(frames[index]!, at.head, at.x).slice(1, 8))).toBe(facing)
      })
    }
    expect(WALK_LEGS.map(legs => LEGS[legs].trim())).toEqual(['▘▘ ▝▝', '▝▝ ▘▘', '▘▝ ▘▝', '▝▘ ▝▘'])
    // Live: the bob needs a row free above; without one it walks on the floor.
    const walking = (rows: number, tick: number): number => {
      const scene = oneAgent(working('w', 'thinking'))
      const room = layout(72, rows, tick)
      const plan = mascotPlan(scene, room)!
      plan.placements.find(one => one.id === 'w')!.motion = { kind: 'walk' }

      return placedSprites(scene, room, plan)!.sprites.find(one => one.id === 'w')!.top
    }
    expect([0, 1, 2, 3].map(tick => walking(4, tick))).toEqual([-1, -1, -1, -1])
    expect([0, 1, 2, 3].map(tick => walking(8, tick))).toEqual([-1, -2, -1, -2])
  })

  test('the hop: six frames, lifts 0 2 4 4 2 0, squash, stretch (arms up, legs long), apex (legs tucked) twice, air, squash', () => {
    const frames = sheetOf('agent · hop').frames
    expect(frames).toHaveLength(6)
    const squashed = (frame: readonly string[]) => windowOf(frame, figureIn(frame)!.head + 1, figureIn(frame)!.x) === SQUASHED[1]
    expect(frames.map(frame => (squashed(frame) ? 'squash' : windowOf(frame, figureIn(frame)!.head + 2, figureIn(frame)!.x)))).toEqual(['squash', LEGS.stretch, LEGS.tuck, LEGS.tuck, LEGS.stand, 'squash'])
    const floor = frames[0]!.length - 1
    // Rows from the floor to its feet: a squash stands on the floor a row shorter.
    expect(frames.map(frame => floor - (figureIn(frame)!.head + (squashed(frame) ? 1 : 2)))).toEqual([0, 2, 4, 4, 2, 0])
  })

  test('flying: the propeller cap in its hat\'s place, its blade a row above turning + then x every frame; legs tucked; no wings', () => {
    const { frames, cells } = sheetOf('agent · flying')
    frames.slice(0, 8).forEach((frame, index) => {
      const at = figureIn(frame)!
      const air = windowOf(frame, at.head - 1, at.x)
      // The cap on the head's corner, as the hat it stands for.
      const cap = HAT_X.left - 2
      expect(air.slice(cap, cap + 3), `#${index}`).toBe('▄▄▄')
      expect(air[4], `#${index}`).toBe('w')
      expect(windowOf(frame, at.head - 2, at.x)[cap + 1], `#${index}`).toBe(index % 2 === 0 ? '+' : 'x')
      expect(cells[index]![at.head - 2]![at.x + cap + 1]?.colour).toBe(ACCESSORIES.beanie.colour)
      expect(windowOf(frame, at.rows[1]!.row, at.x)).toBe(LEGS.tuck)
    })
    for (const { frames: all } of spriteSheet()) for (const frame of all) expect(frame.join('')).not.toMatch(/[˂˃⌃]/)
  })

  test('knocked over: a stagger, flat on its back; dizzy eight frames, its eyes crossing and rolling apart every frame under three stars blinking in turn; a crouch with its eyes back; up', () => {
    const { frames, cells } = sheetOf('agent · knocked over')
    expect(frames).toHaveLength(12)
    const at = frames.map(frame => figureIn(frame)!)
    const eyes = frames.map((frame, index) => HEADS_BY_INNER.get(windowOf(frame, at[index]!.head, at[index]!.x).slice(1, 8)))
    expect(eyes).toEqual(['shut', 'shut', 'spiral', 'spin', 'spiral', 'spin', 'spiral', 'spin', 'spiral', 'spin', 'open', 'right'])
    expect(at.map(one => one.flat)).toEqual([false, ...Array(9).fill(true), false, false])
    // Its hat on the floor beside its head while it is down; the letter waits.
    for (let index = 1; index < 10; index += 1) {
      expect(frames[index]![at[index]!.head]?.slice(at[index]!.x + 10, at[index]!.x + 13)).toBe(ACCESSORIES.beanie.art)
      expect(frames[index]!.join('')).not.toContain('w')
    }
    // Three stars over it at its columns 3, 6 and 9: frame n hides star n mod 3, each back as the other star.
    for (let frame = 0; frame < 8; frame += 1) {
      const one = at[frame + 2]!
      const row = frames[frame + 2]![one.head - 3] ?? ''
      const stars = [1, 4, 7].map(dx => row[one.x + dx])
      expect(stars[frame % 3], `dizzy ${frame}`).toBe(' ')
      expect(stars.filter(star => star === '✦' || star === '✧'), `dizzy ${frame}`).toHaveLength(2)
      for (const dx of [1, 4, 7]) if (row[one.x + dx] !== ' ') expect(cells[frame + 2]![one.head - 3]![one.x + dx]?.ink).toBe('y')
    }
    const glyphs = Array.from({ length: 8 }, (_, frame) => [1, 4, 7].map(dx => (frames[frame + 2]![at[frame + 2]!.head - 3] ?? '')[at[frame + 2]!.x + dx]).join(''))
    expect(glyphs).toEqual([' ✦✦', '✧ ✦', '✧✧ ', ' ✧✧', '✦ ✧', '✦✦ ', ' ✦✦', '✧ ✦'])
    // The crouch: hands on the floor, a row lower.
    expect(windowOf(frames[10]!, at[10]!.head + 1, at[10]!.x)).toBe(CROUCHED)
  })

  test('the cheer: eight frames under its ✓, a shuffle a cell left, a bounce with its arms up, a shuffle a cell right, a bounce; then up the pipe', () => {
    const { frames } = sheetOf('agent · cheer')
    const dance = frames.slice(0, CHEER_TICKS)
    const at = dance.map(frame => figureIn(frame)!)
    const ground = at[0]!.head
    dance.forEach((frame, index) => {
      const one = at[index]!
      const lifted = index % 2 === 1
      expect(one.head, `#${index}`).toBe(lifted ? ground - 1 : ground)
      expect(frame[one.head]?.[one.x + 9], `#${index}: the tick beside its head`).toBe('✓')
      if (lifted) {
        expect(one.x, `#${index}`).toBe(2)
        expect(windowOf(frame, one.head + 1, one.x)).toBe(TORSOS.up)
        expect(armsUp(frame), `#${index}: arms up`).toBe(true)
      } else {
        const left = index % 4 === 0
        expect(one.x, `#${index}`).toBe(left ? 1 : 3)
        expect(windowOf(frame, one.head + 2, one.x)).toBe(left ? LEGS.shuffleLeft : LEGS.shuffleRight)
      }
    })
    // The pipe coming down: eyes up at it (as open eyes), still under its ✓; then sucked up it, stretched: arms up, legs long, nothing beside it.
    const lowered = frames[CHEER_TICKS]!
    expect(lowered.join('')).toContain('✓')
    expect(HEADS_BY_INNER.get(windowOf(lowered, figureIn(lowered)!.head, figureIn(lowered)!.x).slice(1, 8))).toBe('open')
    for (const frame of frames.slice(CHEER_TICKS + 1)) {
      const at = figureIn(frame)!
      expect(windowOf(frame, at.rows[1]!.row, at.x)).toBe(LEGS.stretch)
      expect(frame.join('')).not.toContain('✓')
    }
    expect(frames.length).toBe(CHEER_TICKS + 4)
  })
})
