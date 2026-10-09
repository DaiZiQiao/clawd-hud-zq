import { describe, expect, test } from 'claude-code/testing'

import type { HudTidyFacts } from '../types'
import { mainLook } from './mascot-poses'
import { OVERLAYS } from './mascot-sprites'
import { sceneOf } from './scene-model'
import { NOW, entry, family, idleHud } from './scene-model.fixtures'
import { SCENE_FRAME_MS, TIDY_STALE_MS } from './scene-phases'
import { mascotPlan } from './scene-plan'
import { TIDY_AFTER, TIDY_AGAIN, TIDY_COUNTDOWN_MS, TIDY_MIN, TIDY_RESULT_MS, bandLinesOf, bandTidyOf, isTidyDue, paybackOf } from './tidy'
import type { TidyInputs } from './tidy'

// Tidying up (hooks/tidy.ts) and the casts the band and the pane draw
// (hooks/scene-model.ts): pure functions of the facts and the time.

const due = (extra: Partial<TidyInputs> = {}): TidyInputs => ({
  mode: 'ask',
  at: 150_000,
  tokens: 182_000,
  main: { idleSince: NOW - 1000 },
  tidy: {},
  model: 'claude-opus-5-5',
  now: NOW,
  ...extra,
})

const textOf = (lines: ReturnType<typeof bandLinesOf>): string[] => lines.map(line => line.map(run => run.text).join(''))

describe('when a tidy is due', () => {
  test('past tidyAt (and never under TIDY_MIN), the main loop idle and not compacting, not put off', () => {
    expect(isTidyDue(due())).toBe(true)
    expect(isTidyDue(due({ tokens: 149_999 }))).toBe(false)
    expect(isTidyDue(due({ tokens: undefined }))).toBe(false)
    expect(isTidyDue(due({ mode: 'off' }))).toBe(false)
    expect(isTidyDue(due({ mode: 'auto' }))).toBe(true)
    // A tidyAt under TIDY_MIN still waits for TIDY_MIN.
    expect(isTidyDue(due({ at: 1000, tokens: TIDY_MIN - 1 }))).toBe(false)
    expect(isTidyDue(due({ at: 1000, tokens: TIDY_MIN }))).toBe(true)
    // The main loop at work, or a compaction running.
    expect(isTidyDue(due({ main: { busySince: NOW - 500 } }))).toBe(false)
    expect(isTidyDue(due({ tidy: { runningSince: NOW - 500 } }))).toBe(false)
    // One left over from a reload mid-way no longer holds it back.
    expect(isTidyDue(due({ tidy: { runningSince: NOW - TIDY_STALE_MS } }))).toBe(true)
  })

  test('after a compaction, not again until the context has grown TIDY_AGAIN past what it left: its tools and instructions alone past tidyAt do not tidy again and again', () => {
    const last = { at: NOW - 60_000, trigger: 'plugin' as const, before: 182_000, after: 60_000 }
    const dueAt = (tokens: number): boolean => isTidyDue(due({ mode: 'auto', at: 50_000, tokens, tidy: { last } }))
    expect(dueAt(60_000)).toBe(false)
    expect(dueAt(60_000 + TIDY_AGAIN - 1)).toBe(false)
    expect(dueAt(60_000 + TIDY_AGAIN)).toBe(true)
    // A compaction whose size after is not known: no floor.
    expect(isTidyDue(due({ mode: 'auto', at: 50_000, tokens: 60_000, tidy: { last: { at: NOW - 60_000, trigger: 'auto' } } }))).toBe(true)
  })

  test('Not now puts it off until the context holds TIDY_AGAIN tokens more', () => {
    const tidy: HudTidyFacts = { dismissedAt: 182_000 }
    expect(isTidyDue(due({ tidy }))).toBe(false)
    expect(isTidyDue(due({ tidy, tokens: 182_000 + TIDY_AGAIN - 1 }))).toBe(false)
    expect(isTidyDue(due({ tidy, tokens: 182_000 + TIDY_AGAIN }))).toBe(true)
  })
})

describe('what a tidy pays back', () => {
  test('its one cost over what each request after it saves, at the model\'s list prices', () => {
    // Opus 5.5: reading 182k from the cache, a 12k summary, caching 30k after, against 152k read less each request.
    expect(paybackOf('claude-opus-5-5', 182_000, TIDY_AFTER)).toBe(15)
    // A bigger context pays back sooner.
    expect(paybackOf('claude-opus-5-5', 400_000, TIDY_AFTER)).toBe(7)
    expect(paybackOf('claude-sonnet-5-5', 182_000, TIDY_AFTER)).toBe(8)
    // A model with no price, or nothing to save: no estimate.
    expect(paybackOf('some-model', 182_000, TIDY_AFTER)).toBeUndefined()
    expect(paybackOf(undefined, 182_000, TIDY_AFTER)).toBeUndefined()
    expect(paybackOf('claude-opus-5-5', 20_000, TIDY_AFTER)).toBeUndefined()
  })
})

describe('what the band says', () => {
  test('a compaction running, then its result for TIDY_RESULT_MS, then a failure, then the countdown or the offer', () => {
    const running = bandTidyOf(due({ tidy: { runningSince: NOW - 12_000 } }))
    expect(running).toEqual({ kind: 'tidying', since: NOW - 12_000, before: 182_000 })
    expect(textOf(bandLinesOf(running!, NOW))).toEqual(['tidying up · 182k tokens', 'squashing the conversation into a summary · 12s'])

    const last = { at: NOW - 1000, trigger: 'auto' as const, before: 182_000, after: 21_000 }
    const tidied = bandTidyOf(due({ tokens: 21_000, tidy: { last } }))
    expect(tidied).toEqual({ kind: 'tidied', tidied: last })
    expect(textOf(bandLinesOf(tidied!, NOW))).toEqual(['✓ tidied 182k → 21k (−88%)', 'every request from here reads 161k tokens less'])
    // Its result goes once TIDY_RESULT_MS has passed; with nothing due, so does the band's say.
    expect(bandTidyOf(due({ tokens: 21_000, tidy: { last: { ...last, at: NOW - TIDY_RESULT_MS } } }))).toBeUndefined()

    const failed = bandTidyOf(due({ tidy: { failed: { at: NOW - 1000, reason: 'a turn is running' } } }))
    expect(textOf(bandLinesOf(failed!, NOW))).toEqual(['could not tidy up', 'a turn is running'])

    const offer = bandTidyOf(due())
    expect(offer).toEqual({ kind: 'offer', tokens: 182_000, payback: 15 })
    expect(textOf(bandLinesOf(offer!, NOW))).toEqual(['182k tokens of context · tidy up?', 'pays for itself in ~15 requests'])
    // The last tidy's size after stands in for the estimate's.
    expect(bandTidyOf(due({ tidy: { last: { ...last, at: NOW - TIDY_RESULT_MS, after: 60_000 } } }))).toMatchObject({ kind: 'offer', payback: 24 })
    // No price: the offer without its payback.
    expect(textOf(bandLinesOf(bandTidyOf(due({ model: 'some-model' }))!, NOW))[1]).toBe('a summary stands in for the conversation')

    // auto: its countdown while it runs, the offer before one starts.
    const counting = bandTidyOf(due({ mode: 'auto', tidy: { countdownSince: NOW - 3000 } }))
    expect(counting).toEqual({ kind: 'countdown', leftMs: TIDY_COUNTDOWN_MS - 3000, tokens: 182_000 })
    expect(textOf(bandLinesOf(counting!, NOW))[0]).toBe('tidying up in 7s · 182k tokens')
    expect(bandTidyOf(due({ mode: 'auto' }))?.kind).toBe('offer')
    // Off: a compaction's progress and result still show, never an offer.
    expect(bandTidyOf(due({ mode: 'off' }))).toBeUndefined()
    expect(bandTidyOf(due({ mode: 'off', tidy: { runningSince: NOW } }))?.kind).toBe('tidying')
  })

  test('a result whose sizes the engine did not give says what it knows', () => {
    const lines = textOf(bandLinesOf({ kind: 'tidied', tidied: { at: NOW, trigger: 'manual' } }, NOW))
    expect(lines).toEqual(['✓ tidied conversation compacted', 'a summary stands in for the conversation'])
    expect(textOf(bandLinesOf({ kind: 'tidied', tidied: { at: NOW, trigger: 'manual', after: 21_000 } }, NOW))[0]).toBe('✓ tidied now 21k tokens')
  })
})

describe('the casts', () => {
  test('the agents alone (the pane under the band): no session mascot in the field, no hand-offs to it, no messages from it', () => {
    const board = [...family, entry('solo', { startedAt: NOW - 30_000 })]
    const events = [{ kind: 'message' as const, from: 'main', to: 'solo', tick: Math.floor(NOW / SCENE_FRAME_MS) }, { kind: 'message' as const, from: 'parent', to: 'solo', tick: Math.floor(NOW / SCENE_FRAME_MS) }]
    const all = sceneOf(board, idleHud, NOW, { scenes: true, events })
    const agents = sceneOf(board, idleHud, NOW, { scenes: true, events, only: 'agents' })
    expect(all.withoutMain).toBeUndefined()
    expect(agents.withoutMain).toBe(true)
    expect(all.agents.find(one => one.id === 'solo')?.spawner).toBe('main')
    expect(agents.agents.find(one => one.id === 'solo')?.spawner).toBeUndefined()
    // A child still takes its task from its parent.
    expect(agents.agents.find(one => one.id === 'child')?.spawner).toBe('parent')
    expect(all.events).toHaveLength(2)
    expect(agents.events).toEqual([events[1]])

    const room = { columns: 100, rows: 12, tick: Math.floor(NOW / SCENE_FRAME_MS), scenes: true }
    expect(mascotPlan(all, room)?.placements.some(one => one.id === 'main')).toBe(true)
    const plan = mascotPlan(agents, room)
    expect(plan?.placements.some(one => one.kind === 'main')).toBe(false)
    expect(plan?.placements.map(one => one.id).sort()).toEqual(['child', 'grandchild', 'parent', 'solo'])
    // With no agents, an empty field.
    expect(mascotPlan(sceneOf([], idleHud, NOW, { only: 'agents' }), room)?.placements).toEqual([])
  })

  test('the session alone (the band): no agents drawn, but it watches while they run', () => {
    const board = [entry('busy')]
    const band = sceneOf(board, idleHud, NOW, { only: 'main' })
    expect(band.agents).toEqual([])
    expect(band.main.mood).toBe('watching')
    expect(sceneOf([], idleHud, NOW, { only: 'main' }).main.mood).toBe('idle')
    // A mascot's rows: the session's mascot alone in its yard.
    const plan = mascotPlan(band, { columns: 28, rows: 5, tick: 0 })
    expect(plan?.placements.map(one => one.id)).toEqual(['main'])
  })

  test('a compaction running: the session tidies up, frame by frame beside its pile, and stands still while it does', () => {
    const scene = sceneOf([], idleHud, NOW, { tidyingSince: NOW - 3 * SCENE_FRAME_MS })
    expect(scene.main.tidyMs).toBe(3 * SCENE_FRAME_MS)
    expect(sceneOf([], idleHud, NOW, { tidyingSince: NOW - TIDY_STALE_MS }).main.tidyMs).toBeUndefined()
    for (let frame = 0; frame < 8; frame += 1) {
      const look = mainLook({ mood: 'thinking', sweating: false, tidyMs: frame * SCENE_FRAME_MS }, 0)
      expect(look.overlays).toContain(OVERLAYS.tidy[frame])
    }
    // Pressing down: eyes shut with the effort, its arm out over the pile.
    expect(mainLook({ mood: 'idle', sweating: false, tidyMs: 2 * SCENE_FRAME_MS }, 0)).toMatchObject({ head: 'shut', arms: 'point' })
    // Tidying wins over the stretch of an earlier compaction.
    expect(mainLook({ mood: 'idle', sweating: false, tidyMs: 0, stretchMs: 0 }, 0).overlays).toContain(OVERLAYS.tidy[0])
  })
})
