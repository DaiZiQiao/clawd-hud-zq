import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudTidyFacts } from '../types'
import { NOW, START, SURFACES, VIEWPORT, arrange, mountPane, spawn } from './register.fixtures'
import type { SceneInputs } from './scene-types'
import { TIDY_COUNTDOWN_MS, TIDY_INSTRUCTIONS } from './tidy'

// The band above the prompt: the session's mascot lives there (its scene the
// session's alone, the pane's then the agents' alone), a click opens the HUD
// on the session, and tidying up is offered, counted down, run and reported.

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} } as const

const mountBand = ($: Engine, surface: 'terminal' | 'desktop', bodyColumns = 100, extra: Record<string, unknown> = {}) =>
  $.ui.mount({ plugin: 'mod-hud', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns, ...extra }, requestId: 'band', viewport: VIEWPORT })

type Drawing = Awaited<ReturnType<typeof mountBand>>

const MESSAGES = [{ role: 'user', text: 'the plan so far', toolUses: [] }]

const sceneOfClient = async (ui: { find: Drawing['find'] }, key: string): Promise<SceneInputs | undefined> =>
  (await ui.find({ type: 'Client', key }))?.props.props as SceneInputs | undefined

// The band's tidy lines, as a person reads them, ` / ` between them; '' with none.
const bandText = async (ui: Drawing): Promise<string> => {
  await ui.redraw()

  return (await ui.findAll({ type: 'Box' })).filter(box => /^tidy:\d+$/.test(box.key ?? '')).map(box => box.text).join(' / ')
}

// The session beneath, with the engine's own band (`engine`) under a hook that passes.
const bandWorld = (on: On) => {
  const arranged = arrange(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))

  return arranged
}

// The session beneath: the context past tidyAt on Opus 5.5, idle, and a compaction that answers.
const tidyWorld = (on: On) => {
  const arranged = bandWorld(on)
  const asked: Record<string, unknown>[] = []
  let during: unknown
  on('session.compact', (_$, e) => {
    asked.push(e as unknown as Record<string, unknown>)
    during = arranged.held.get('tidy')?.value

    return { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], tokensBefore: 182_000, tokensAfter: 21_000 } as never
  })
  const context = (tokens: number) => {
    arranged.held.set('session', { value: { model: 'claude-opus-5-5' }, version: 50 + tokens })
    arranged.held.set('usage', { value: { contextTokens: tokens, rateLimits: [], compactions: 0 }, version: 50 + tokens })
  }
  const tidyFacts = (): HudTidyFacts | undefined => arranged.held.get('tidy')?.value as HudTidyFacts | undefined

  return { ...arranged, asked, during: () => during, context, tidyFacts }
}

const endMainTurn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])

describe('the session mascot in the band', () => {
  test('on the terminal and desktop its yard is the session\'s scene alone; once the band draws it, the pane\'s scene is the agents\' alone', async ($, on) => {
    const { clock } = bandWorld(on)
    await $.session.start(START)
    await clock.settle()
    await spawn($)
    for (const surface of SURFACES) {
      // Before the band has drawn it, the pane keeps the session's mascot.
      const pane = await mountPane($, surface, 100, 30)
      expect((await sceneOfClient(pane, 'mascots'))?.only).toBeUndefined()
      const band = await mountBand($, surface)
      const yard = await band.find({ type: 'Client', key: 'session' })
      // It walks the band's width; where the world behind it is drawn (the desktop's Svg), in a row more of sky.
      const rows = surface === 'desktop' ? 6 : 5
      expect(yard?.props).toMatchObject({ module: 'hooks/scene-client.tsx', width: 100, height: rows })
      const inputs = yard?.props.props as SceneInputs
      expect(inputs.only).toBe('main')
      expect(inputs.rows).toBe(rows)
      expect(inputs.scenery).toBe('fast')
      // The board rides along for its mood (watching a subagent at work), never drawn there.
      expect(inputs.agents.map(one => one.id)).toEqual(['sub-1'])
      // Nothing to say about tidying: no text beside it.
      expect(await band.find({ type: 'Box', key: 'band:tidy' })).toBeUndefined()
      await pane.redraw()
      expect((await sceneOfClient(pane, 'mascots'))?.only).toBe('agents')
      await band.unmount()
      await pane.unmount()
    }
  })

  test('motion classic: the band draws the classic scene, the session\'s crowned mascot in it', { options: { motion: 'classic' } }, async ($, on) => {
    const { clock } = bandWorld(on)
    await $.session.start(START)
    await clock.settle()
    const band = await mountBand($, 'terminal')
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    const scene = await band.find({ type: 'Box', key: 'mascots' })
    expect(scene?.text).toContain('▙█▟')
    await band.unmount()
  })

  test('sessionMascot pane: the band draws nothing until tidying has something to say, and the pane keeps the session\'s mascot', { options: { sessionMascot: 'pane' } }, async ($, on) => {
    const { clock, context } = tidyWorld(on)
    await $.session.start(START)
    await clock.settle()
    const band = await mountBand($, 'terminal')
    expect(await band.find({ type: 'Box', key: 'band' })).toBeUndefined()
    expect(await band.find({ type: 'Box', key: 'engine' })).toBeDefined()
    const pane = await mountPane($, 'terminal', 100, 30)
    expect((await sceneOfClient(pane, 'mascots'))?.only).toBeUndefined()
    context(182_000)
    await band.redraw()
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    expect(await bandText(band)).toContain('tidy up?')
    await band.unmount()
    await pane.unmount()
  })

  test('too narrow for its slot, or a survey holding the band: the engine\'s own, and the pane keeps the mascot', async ($, on) => {
    const { clock } = bandWorld(on)
    await $.session.start(START)
    await clock.settle()
    const narrow = await mountBand($, 'terminal', 16)
    expect(await narrow.find({ type: 'Box', key: 'band' })).toBeUndefined()
    expect(await narrow.find({ type: 'Box', key: 'engine' })).toBeDefined()
    const pane = await mountPane($, 'terminal', 100, 30)
    expect((await sceneOfClient(pane, 'mascots'))?.only).toBeUndefined()
    await narrow.unmount()
    const survey = await mountBand($, 'terminal', 100, { hasSurvey: true })
    expect(await survey.find({ type: 'Box', key: 'band' })).toBeUndefined()
    await survey.unmount()
    await pane.unmount()
  })

  test('a click on the session\'s mascot in the band opens the HUD on the session\'s own view', async ($, on) => {
    const { clock, world, held } = bandWorld(on)
    await $.session.start(START)
    await clock.settle()
    const band = await mountBand($, 'terminal')
    await band.post({ kind: 'inspect', id: 'main', at: { x: 2, y: 3 } }, { in: 'session' })
    await clock.settle()
    expect(world.opens.map(one => one.id)).toEqual(['hud'])
    expect(held.get('selected')?.value).toEqual({ id: 'main', kind: 'main' })
    await band.unmount()
  })
})

describe('tidying up', () => {
  test('past tidyAt with the main loop idle the band offers it and its payback; Tidy up compacts, told to keep the plan; the result shows before and after', async ($, on) => {
    const { clock, asked, context, tidyFacts, held } = tidyWorld(on)
    await $.session.start(START)
    await clock.settle()
    context(149_000)
    const band = await mountBand($, 'terminal')
    expect(await bandText(band)).toBe('')
    context(182_000)
    expect(await bandText(band)).toBe('182k tokens of context · tidy up? / pays for itself in ~15 requests')
    expect((await band.findAll({ type: 'Button' })).map(one => one.key)).toEqual(['tidy:now', 'tidy:later'])
    // The main loop at work: no offer.
    held.set('main', { value: { busySince: NOW }, version: 70 })
    expect(await bandText(band)).toBe('')
    held.set('main', { value: { idleSince: NOW }, version: 71 })
    expect(await bandText(band)).toContain('tidy up?')

    await band.press({ key: 'tidy:now' })
    await clock.settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ instructions: TIDY_INSTRUCTIONS })
    expect(tidyFacts()).toEqual({ last: { at: clock.now(), trigger: 'plugin', before: 182_000, after: 21_000 } })
    expect(await bandText(band)).toBe('✓ tidied 182k → 21k (−88%) / every request from here reads 161k tokens less')
    // The band's clock lets it go after TIDY_RESULT_MS; the context, now small, offers nothing.
    context(21_000)
    await clock.advance(20_000)
    await clock.settle()
    expect(await bandText(band)).toBe('')
    await band.unmount()
  })

  test('Not now puts the offer off until the context grows by TIDY_AGAIN', async ($, on) => {
    const { clock, asked, context, tidyFacts } = tidyWorld(on)
    await $.session.start(START)
    await clock.settle()
    context(182_000)
    const band = await mountBand($, 'desktop')
    expect(await bandText(band)).toContain('tidy up?')
    await band.press({ key: 'tidy:later' })
    await clock.settle()
    expect(tidyFacts()).toEqual({ dismissedAt: 182_000 })
    expect(await bandText(band)).toBe('')
    context(231_999)
    expect(await bandText(band)).toBe('')
    context(232_000)
    expect(await bandText(band)).toContain('232k tokens of context · tidy up?')
    expect(asked).toHaveLength(0)
    await band.unmount()
  })

  test('a compaction the engine refuses: the band says why, and the offer comes back after', async ($, on) => {
    const arranged = bandWorld(on)
    on('session.compact', () => ({ skip: 'a turn is running' }) as never)
    arranged.held.set('session', { value: { model: 'claude-opus-5-5' }, version: 60 })
    arranged.held.set('usage', { value: { contextTokens: 182_000, rateLimits: [], compactions: 0 }, version: 60 })
    const band = await mountBand($, 'terminal')
    await band.press({ key: 'tidy:now' })
    await arranged.clock.settle()
    expect(await bandText(band)).toBe('could not tidy up / a turn is running')
    await arranged.clock.advance(20_000)
    await arranged.clock.settle()
    expect(await bandText(band)).toContain('tidy up?')
    await band.unmount()
  })

  test('tidy auto: a main turn\'s end counts down in the band, then tidies up; a prompt meanwhile, or Not now, stops it', { options: { tidy: 'auto' } }, async ($, on) => {
    const { clock, asked, context, tidyFacts, held } = tidyWorld(on)
    // The engine beneath takes a prompt in.
    on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
    await $.session.start(START)
    await clock.settle()
    context(182_000)
    const band = await mountBand($, 'terminal')
    // Before a turn ends, the offer.
    expect(await bandText(band)).toContain('tidy up?')

    await endMainTurn($)
    expect(tidyFacts()?.countdownSince).toBe(clock.now())
    expect(await bandText(band)).toBe('tidying up in 10s · 182k tokens / the conversation becomes a summary; the todos and the plan stay')
    expect((await band.findAll({ type: 'Button' })).map(one => one.props.label)).toEqual(['Tidy up now', 'Not now'])
    await clock.advance(4000)
    await clock.settle()
    expect(await bandText(band)).toContain('tidying up in 6s')
    await clock.advance(TIDY_COUNTDOWN_MS - 4000)
    await clock.settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.instructions).toBe(TIDY_INSTRUCTIONS)

    // Again, but the person sends a prompt before it runs.
    context(182_000)
    await endMainTurn($)
    held.set('main', { value: { busySince: clock.now() }, version: 90 })
    await clock.advance(TIDY_COUNTDOWN_MS)
    await clock.settle()
    expect(asked).toHaveLength(1)
    expect(tidyFacts()?.countdownSince).toBeUndefined()

    // Again, and a prompt sent at once: the countdown stops then, before the turn is under way.
    held.set('main', { value: { idleSince: clock.now() }, version: 91 })
    await endMainTurn($)
    expect(tidyFacts()?.countdownSince).toBe(clock.now())
    await $.prompt.submit({ text: 'and one more thing', wait: false, origin: { kind: 'composer' } })
    expect(tidyFacts()?.countdownSince).toBeUndefined()
    await clock.advance(TIDY_COUNTDOWN_MS)
    await clock.settle()
    expect(asked).toHaveLength(1)

    // Again, and Not now.
    held.set('main', { value: { idleSince: clock.now() }, version: 92 })
    await endMainTurn($)
    expect(tidyFacts()?.countdownSince).toBe(clock.now())
    await band.press({ key: 'tidy:later' })
    await clock.advance(TIDY_COUNTDOWN_MS)
    await clock.settle()
    expect(asked).toHaveLength(1)
    expect(tidyFacts()).toMatchObject({ dismissedAt: 182_000 })
    await band.unmount()
  })

  test('a load (or a session\'s end) mid-way drops a compaction it never saw end and a countdown whose timer went with the old module', async ($, on) => {
    const { clock, held, tidyFacts } = tidyWorld(on)
    const last = { at: NOW - 60_000, trigger: 'manual' as const, before: 200_000, after: 30_000 }
    held.set('tidy', { value: { runningSince: NOW - 1000, countdownSince: NOW - 500, last, dismissedAt: 190_000 }, version: 80 })
    await $.session.start(START)
    await clock.settle()
    expect(tidyFacts()).toEqual({ last, dismissedAt: 190_000 })
    held.set('tidy', { value: { runningSince: NOW, dismissedAt: 190_000 }, version: 81 })
    await $.session.end({ reason: 'other', sessionId: 's' } as Parameters<Engine['session']['end']>[0])
    expect(tidyFacts()).toEqual({ dismissedAt: 190_000 })
  })

  test('tidy auto waits while a subagent runs', { options: { tidy: 'auto' } }, async ($, on) => {
    const { clock, context, tidyFacts } = tidyWorld(on)
    await $.session.start(START)
    await clock.settle()
    await spawn($)
    context(182_000)
    await endMainTurn($)
    expect(tidyFacts()?.countdownSince).toBeUndefined()
  })

  test('any compaction of the main conversation: the session mascot tidies up in the band while it runs, and the band shows the result; a precompute or a subagent\'s leaves them alone', async ($, on) => {
    const { clock, context, tidyFacts, during } = tidyWorld(on)
    await $.session.start(START)
    await clock.settle()
    context(120_000)
    const band = await mountBand($, 'terminal')
    expect((await sceneOfClient(band, 'session'))?.tidyingSince).toBeUndefined()

    await $.session.compact({ trigger: 'precompute', messages: MESSAGES } as Parameters<Engine['session']['compact']>[0])
    await $.session.compact({ trigger: 'manual', agentId: 'sub-1', messages: MESSAGES } as Parameters<Engine['session']['compact']>[0])
    expect(tidyFacts()).toBeUndefined()

    await $.session.compact({ trigger: 'auto', messages: MESSAGES } as Parameters<Engine['session']['compact']>[0])
    // While it ran: one write, read by the scene.
    expect(during()).toEqual({ runningSince: clock.now() })
    expect(tidyFacts()).toEqual({ last: { at: clock.now(), trigger: 'auto', before: 182_000, after: 21_000 } })
    expect(await bandText(band)).toContain('✓ tidied 182k → 21k')
    await band.unmount()
  })

  test('the session\'s mascot tidies up in its scene while a compaction runs', async ($, on) => {
    const arranged = bandWorld(on)
    let inputs: SceneInputs | undefined
    let band: Drawing | undefined
    on('session.compact', async () => {
      await band?.redraw()
      inputs = band === undefined ? undefined : await sceneOfClient(band, 'session')

      return { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }] } as never
    })
    await $.session.start(START)
    await arranged.clock.settle()
    band = await mountBand($, 'terminal')
    await $.session.compact({ trigger: 'manual', messages: MESSAGES } as Parameters<Engine['session']['compact']>[0])
    expect(inputs?.tidyingSince).toBe(arranged.clock.now())
    await band.redraw()
    expect((await sceneOfClient(band, 'session'))?.tidyingSince).toBeUndefined()
    await band.unmount()
  })
})
