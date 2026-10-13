import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { HudTidyFacts, HudTidyGate } from '../types'
import { NOW, START, TOGGLE, SURFACES, VIEWPORT, arrange, mountPane, spawn } from './register.fixtures'
import type { SceneInputs } from './scene-types'
import { TIDY_COUNTDOWN_MS, TIDY_INSTRUCTIONS, TIDY_RESULT_MS, tidyButtonLabels } from './tidy'
import { TIDY_FEEDBACK_REASONS, tidyCostsOf, tidyDueOf } from './tidy-policy'
import { displayWidth } from './text-width'
import { rowSource, textLine, textRuns } from './text-svg.fixtures'

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
const tidyWorld = (on: On, $: Engine, skip?: string, toggleOption: boolean | 'off' = false) => {
  const arranged = bandWorld(on)
  on('store.get', () => ({ value: true }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('config.list', () => ({ value: toggleOption ? [{ key: 'mod-hud.tidy', value: toggleOption === 'off' ? 'off' : 'auto', provider: { plugin: 'mod-hud' } }] : [] } as never))
  on('tool.list', () => ({ value: [{ name: 'TodoWrite' }] } as never))
  on('classic.Stop', () => ({}))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const asked: Record<string, unknown>[] = []
  let during: unknown
  on('session.compact', (_$, e) => {
    asked.push(e as unknown as Record<string, unknown>)
    during = arranged.held.get('tidy')?.value

    return skip === undefined ? { messages: [{ role: 'assistant', text: 'summary', toolUses: [] }], tokensBefore: 182_000, tokensAfter: 21_000 } as never : { skip }
  })
  const context = async (tokens: number) => {
    arranged.held.set('session', { value: { model: 'claude-opus-5-5', cacheTtl: '1h', cacheTtlAssumed: false, isInteractive: true, compactDisabled: false }, version: 50 + tokens })
    arranged.held.set('usage', { value: { contextTokens: tokens, mainRequestAt: arranged.clock.now(), rateLimits: [], compactions: 0 }, version: 50 + tokens })
    const gate = arranged.held.get('tidyGate')?.value as HudTidyGate | undefined
    arranged.held.set('tidyGate', { value: { todos: [], tasks: [], precomputeSeen: false, teammate: false, mainRequests: 0, mainInput: 0, mainCacheRead: 0, ...gate, requestsSinceCompaction: 100, awaitingAfter: undefined }, version: 100 })
    await $.session.measure({ context: { tokens, window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  }
  const tidyFacts = (): HudTidyFacts | undefined => arranged.held.get('tidy')?.value as HudTidyFacts | undefined

  return { ...arranged, asked, during: () => during, context, tidyFacts }
}

const endMainTurn = async ($: Engine) => {
  await $.turn.start({ turnId: 't1', text: 'work' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  return $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as Parameters<Engine['turn']['complete']>[0])
}

describe('the session mascot in the band', () => {
  test('on the terminal and desktop its yard is the session\'s scene alone; once the band draws it, the pane\'s scene is the agents\' alone', { timeoutMs: 20_000 }, async ($, on) => {
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
      // It walks the band's width, a mascot's rows high.
      expect(yard?.props).toMatchObject({ module: 'hooks/scene-client.tsx', width: 100, height: 5 })
      const inputs = yard?.props.props as SceneInputs
      expect(inputs.only).toBe('main')
      expect(inputs.rows).toBe(5)
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

  test('Claude Code\'s spinner word for the main conversation is what the session\'s mascot thinks: written once as it changes, carried to the band\'s scene; an agent\'s spinner writes none', { timeoutMs: 20_000 }, async ($, on) => {
    const { clock, held, world } = bandWorld(on)
    // The engine's own spinner beneath the hook.
    on('ui.render', { component: 'Spinner' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
    await $.session.start(START)
    const spin = async (requestId: string, word: string) => {
      const ui = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Spinner', props: { word, message: null, suffix: '…', mode: 'thinking' }, requestId, viewport: VIEWPORT })
      await ui.unmount()
      await clock.settle()
    }
    const writes = () => world.writes.filter(key => key === 'spinner').length
    await spin('main', 'Sautéing')
    expect(held.get('spinner')?.value).toBe('Sautéing')
    await spin('main', 'Sautéing')
    await spin('agent-1', 'Pondering')
    expect([held.get('spinner')?.value, writes()]).toEqual(['Sautéing', 1])
    const band = await mountBand($, 'terminal')
    expect((await sceneOfClient(band, 'session'))?.word).toBe('Sautéing')
    await band.unmount()
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

  test('sessionMascot pane: the band draws nothing until tidying has something to say, and the pane keeps the session\'s mascot', { options: { sessionMascot: 'pane', tidy: 'ask' } }, async ($, on) => {
    const { clock, context } = tidyWorld(on, $)
    await $.session.start(START)
    await clock.settle()
    const band = await mountBand($, 'terminal')
    expect(await band.find({ type: 'Box', key: 'band' })).toBeUndefined()
    expect(await band.find({ type: 'Box', key: 'engine' })).toBeDefined()
    const pane = await mountPane($, 'terminal', 100, 30)
    expect((await sceneOfClient(pane, 'mascots'))?.only).toBeUndefined()
    await context(182_000)
    await band.redraw()
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    expect(await bandText(band)).toContain('tidy up 182k?')
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
  test('past tidyAt with the main loop idle the band offers it and its payback; Tidy up compacts, told to keep the plan; the result shows before and after', { options: { tidy: 'ask' } }, async ($, on) => {
    const { clock, asked, context, tidyFacts, held } = tidyWorld(on, $)
    await $.session.start(START)
    await clock.settle()
    await context(149_000)
    const band = await mountBand($, 'terminal')
    expect(await bandText(band)).toBe('')
    await context(182_000)
    expect(await bandText(band)).toBe('save ≈$0.92 · tidy up 182k? / if this chat runs as long again · costs $1.02')
    expect((await band.findAll({ type: 'Button' })).map(one => one.key)).toEqual(['tidy:now', 'tidy:later', 'tidy:auto'])
    // The main loop at work: no offer.
    held.set('main', { value: { busySince: NOW }, version: 70 })
    await $.session.measure({ context: { tokens: 182_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] })
    expect(await bandText(band)).toBe('')
    held.set('main', { value: { idleSince: NOW }, version: 71 })
    await $.session.measure({ context: { tokens: 182_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] })
    expect(await bandText(band)).toContain('tidy up 182k?')

    await band.press({ key: 'tidy:now' })
    await clock.settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ instructions: TIDY_INSTRUCTIONS })
    expect(tidyFacts()).toEqual({ last: { at: clock.now(), trigger: 'plugin', before: 182_000, after: 21_000 } })
    expect(await bandText(band)).toBe('✓ tidied 182k → 21k (−88%) / every request from here reads 161k tokens less')
    // The band's clock lets it go after TIDY_RESULT_MS; the context, now small, offers nothing.
    await context(21_000)
    await clock.advance(20_000)
    await clock.settle()
    expect(await bandText(band)).toBe('')
    await band.unmount()
  })

  test('Not now puts the offer off until the context grows by TIDY_AGAIN', { options: { tidy: 'ask' } }, async ($, on) => {
    const { clock, asked, context, tidyFacts } = tidyWorld(on, $)
    await $.session.start(START)
    await clock.settle()
    await context(182_000)
    const band = await mountBand($, 'desktop')
    expect(await bandText(band)).toContain('tidy up 182k?')
    await band.press({ key: 'tidy:later' })
    await clock.settle()
    expect(tidyFacts()).toEqual({ dismissedAt: 182_000, coolingDismissedAt: NOW })
    expect(await bandText(band)).toBe('')
    await context(231_999)
    expect(await bandText(band)).toBe('')
    await context(232_000)
    expect(await bandText(band)).toContain('save ≈$1.91 · tidy up 232k?')
    expect(asked).toHaveLength(0)
    await band.unmount()
  })

  test('a compaction the engine refuses: the band says why, and the offer comes back after', { options: { tidy: 'ask' } }, async ($, on) => {
    const arranged = tidyWorld(on, $, 'a turn is running')
    await $.session.start(START)
    await arranged.clock.settle()
    await arranged.context(182_000)
    const band = await mountBand($, 'terminal')
    await band.press({ key: 'tidy:now' })
    await arranged.clock.settle()
    expect(await bandText(band)).toBe('could not tidy up / a turn is running')
    await arranged.clock.advance(20_000)
    await arranged.clock.settle()
    expect(await bandText(band)).toBe('')
    await arranged.context(232_000)
    expect(await bandText(band)).toContain('tidy up 232k?')
    await band.unmount()
  })

  test('tidy auto: a main turn\'s end counts down in the band, then tidies up; a prompt meanwhile, or Not now, stops it', { options: { tidy: 'auto' } }, async ($, on) => {
    const { clock, asked, context, tidyFacts, held } = tidyWorld(on, $)
    // The engine beneath takes a prompt in.
    on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
    await $.session.start(START)
    await clock.settle()
    await context(182_000)
    await $.command.run(TOGGLE)
    const band = await mountBand($, 'terminal')
    // Before a fresh Stop, automatic D1 waits rather than guessing.
    expect(await bandText(band)).toContain('the next turn to end')

    await endMainTurn($)
    expect(tidyFacts()?.countdownSince).toBe(clock.now())
    expect(await bandText(band)).toBe('auto-tidy in 0:30 · save ≈$0.92 / if this chat runs as long again')
    expect((await band.findAll({ type: 'Button' })).map(one => one.props.label)).toEqual(['Tidy up now', 'Cancel', 'Turn auto off'])
    await clock.advance(4000)
    await clock.settle()
    expect(await bandText(band)).toContain('auto-tidy in 0:26')
    await clock.advance(TIDY_COUNTDOWN_MS - 4000)
    await clock.settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.instructions).toBe(TIDY_INSTRUCTIONS)

    // Again, but the person sends a prompt before it runs.
    await clock.advance(20_000)
    await context(182_000)
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

  test('a load (or a session\'s end) mid-way drops a compaction it never saw end and a countdown whose timer went with the old module', { options: { tidy: 'ask' } }, async ($, on) => {
    const { clock, held, tidyFacts } = tidyWorld(on, $)
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
    const { clock, context, tidyFacts, world } = tidyWorld(on, $)
    await $.session.start(START)
    await clock.settle()
    await spawn($)
    world.agents = [{ id: 'sub-1', status: 'running' }] as never
    await context(182_000)
    await endMainTurn($)
    expect(tidyFacts()?.countdownSince).toBeUndefined()
    expect(tidyFacts()?.pending?.firstReason).toBe('1 agent running')
  })

  test('any compaction of the main conversation: the session mascot tidies up in the band while it runs, and the band shows the result; a precompute or a subagent\'s leaves them alone', async ($, on) => {
    const { clock, context, tidyFacts, during } = tidyWorld(on, $)
    await $.session.start(START)
    await clock.settle()
    await context(120_000)
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

type Pending = NonNullable<HudTidyFacts['pending']>
const t9Pending = (rule: 'D1' | 'D2' | 'D3', state: Pending['state'], now: number): Pending => {
  const gapMs = rule === 'D3' ? 3_600_000 : rule === 'D2' ? 3_600_000 - 118_000 : 0
  const due = tidyDueOf({ model: 'claude-opus-5-5', tokens: 400_000, ttl: '1h', mode: 'auto', at: 150_000, requests: rule === 'D1' ? 140 : rule === 'D3' ? 10 : 0, gapMs, interactive: true, promptCacheWorking: true, autoAllowed: true }).find(item => item.rule === rule)!

  return { ...due, state, reasons: [], otherReasons: 0, ...(rule === 'D2' ? { cacheExpiresAt: now + 118_000 } : {}), ...(state === 'countdown' ? { countdownSince: now - 2000, endsAt: now + 28_000 } : {}) }
}

for (const surface of SURFACES) for (const columns of [120, 48]) {
  test(`T9 render: savings and every band state on ${surface} at ${columns} columns`, { options: { tidy: 'auto' }, timeoutMs: 20_000 }, async ($, on) => {
    const { clock, held, world, context } = tidyWorld(on, $, undefined, true)
    const configWrites: string[] = []
    const storeWrites: string[] = []
    on('store.set', (_$, e) => { storeWrites.push(e.key); return { value: undefined } })
    on('config.set', (_$, e) => { configWrites.push(String(e.value)); return { value: e.value } })
    await $.session.start(START)
    await clock.settle()
    await context(400_000)
    const now = clock.now()
    const put = (facts: HudTidyFacts) => held.set('tidy', { value: facts, version: (held.get('tidy')?.version ?? 0) + 1 })
    const width = (text: string) => displayWidth(text) + (text.match(/[≈·]/g)?.length ?? 0)
    const d1 = t9Pending('D1', 'offer', now)
    const d2 = t9Pending('D2', 'offer', now)
    const d3 = t9Pending('D3', 'offer', now)
    const cases: { name: string; facts: HudTidyFacts; lines: string[]; labels: string[] }[] = [
      { name: 'D1 offer', facts: { pending: d1 }, lines: ['save ≈$7.76 · tidy up 400k?', 'if this chat runs as long again · costs $1.06'], labels: ['Tidy up', 'Not now', 'Turn auto off'] },
      { name: 'D2 offer', facts: { pending: d2 }, lines: ['save ≈$2.14 · tidy before the cache cools?', 'cold in 1m58s; a cold return costs $3.20'], labels: ['Tidy up', 'Not now', 'Turn auto off'] },
      { name: 'D3 offer', facts: { pending: d3 }, lines: ['save ≈$0.85 · tidy the cold cache first?', 'if this chat runs as long again · costs $2.98'], labels: ['Tidy up', 'Not now', 'Turn auto off'] },
      ...[d1, d2, d3].map((pending): typeof cases[number] => ({ name: `${pending.rule} intro`, facts: { pending: { ...pending, intro: true } }, lines: [`auto-tidy is now on · save ≈$${pending.saving?.toFixed(2)}`, pending.rule === 'D2' ? 'cold in 1m58s; a cold return costs $3.20' : `if this chat runs as long again · costs $${pending.costs?.K.toFixed(2)}`], labels: ['Tidy up', 'Not now', 'Turn auto off'] })),
      { name: 'waiting', facts: { pending: { ...d1, state: 'waiting', firstReason: '3 todos open', otherReasons: 2, reasons: ['3 todos open', '2 agents running', 'a tool is running'] } }, lines: ['auto-tidy waiting · save ≈$7.76', 'for: 3 todos open (+2 more)'], labels: ['Cancel', 'Turn auto off'] },
      { name: 'D1 countdown', facts: { pending: t9Pending('D1', 'countdown', now) }, lines: ['auto-tidy in 0:28 · save ≈$7.76', 'if this chat runs as long again'], labels: ['Tidy up now', 'Cancel', 'Turn auto off'] },
      { name: 'D2 countdown', facts: { pending: t9Pending('D2', 'countdown', now) }, lines: ['auto-tidy in 0:28 · save ≈$2.14', "if you're back after it goes cold"], labels: ['Tidy up now', 'Cancel', 'Turn auto off'] },
      { name: 'advisory unpriced', facts: { pending: { state: 'offer', rule: 'advisory', why: 'unpriced', automatic: false, reasons: [], otherReasons: 0 } }, lines: ['400k tokens · tidy up?', 'a summary stands in for the conversation'], labels: ['Tidy up', 'Not now', 'Turn auto off'] },
      { name: 'advisory cache', facts: { pending: { state: 'offer', rule: 'advisory', why: 'cache', automatic: false, reasons: [], otherReasons: 0 } }, lines: ['400k tokens · tidy up?', 'prompt cache not working here'], labels: ['Tidy up', 'Not now', 'Turn auto off'] },
      { name: 'tidying', facts: { runningSince: now - 12_000 }, lines: ['tidying up · 400k tokens · 12s', 'squashing the conversation into a summary'], labels: [] },
      { name: 'tidied', facts: { last: { at: now - 1000, trigger: 'plugin', before: 400_000, after: 21_000 } }, lines: ['✓ tidied 400k → 21k (−95%)', 'every request from here reads 379k tokens less'], labels: [] },
      { name: 'failed', facts: { failed: { at: now, reason: 'Claude started working; try again' } }, lines: ['could not tidy up', 'Claude started working; try again'], labels: [] },
      { name: 'toggle', facts: { toggle: { at: now, reason: TIDY_FEEDBACK_REASONS.optionLocked } }, lines: ['auto-tidy', 'locked by your organization'], labels: [] },
    ]
    for (const sample of cases) {
      put(sample.facts)
      const beforeWrites = world.writes.length
      const beforeStores = storeWrites.length
      const band = await mountBand($, surface, columns)
      const lines = (await band.findAll({ type: 'Box' })).filter(box => /^tidy:\d+$/.test(box.key ?? '')).map(box => box.text)
      expect(lines, sample.name).toEqual(sample.lines)
      const color = sample.name === 'failed' ? 'warning' : sample.name === 'tidied' ? 'success' : 'claude'
      const tidyBox = await band.find({ type: 'Box', key: 'band:tidy' })
      const textProps = (node: unknown): Record<string, unknown>[] => {
        if (typeof node !== 'object' || node === null) return []
        const element = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
        return [...(element.type === 'Text' ? [element.props ?? {}] : []), ...(element.children ?? []).flatMap(textProps)]
      }
      const runs = textProps(tidyBox)
      expect(runs.some(props => props.color === color), `${sample.name} band colour`).toBe(true)
      const head = await band.find({ key: 'tidy:0' })
      const detail = await band.find({ key: 'tidy:1' })
      const headRuns = textProps(head)
      expect(headRuns.some(props => props.color === color && props.bold === (sample.name === 'waiting' || sample.name === 'toggle' ? undefined : true)), `${sample.name} heading style`).toBe(true)
      expect(textProps(detail).some(props => props.dimColor === true), `${sample.name} detail dim`).toBe(true)
      for (const line of lines) expect(width(line), `${sample.name}: ${line}`).toBeLessThanOrEqual(46)
      const buttons = await band.findAll({ type: 'Button' })
      expect(buttons.map(button => button.props.label), sample.name).toEqual(sample.labels)
      const buttonBoxes = (await band.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('tidy:button:'))
      expect(buttonBoxes.reduce((sum, box) => sum + Number(box.props.width), Math.max(0, buttons.length - 1))).toBeLessThanOrEqual(48)
      expect((await band.find({ type: 'Box', key: 'band:tidy' }))?.props.width).toBe(48)
      if (columns === 48) expect(await band.find({ type: 'Box', key: 'band:yard' })).toBeUndefined()
      else expect((await band.find({ type: 'Box', key: 'band:yard' }))?.props.width).toBe(71)
      expect(world.writes.length, 'drawing writes no state').toBe(beforeWrites)
      const pane = await mountPane($, surface, columns, 60)
      const row = await pane.find({ type: 'Box', key: 'hud:context.tidy' })
      expect(row).toBeDefined()
      const toggle = await pane.find({ type: 'Button', key: 'hud:tidy:auto' })
      expect(toggle?.props.label).toBe('Turn auto off')
      const source = rowSource(row)
      const hudText = source === undefined ? row?.text ?? '' : `${textLine(source).trimEnd()} ${toggle?.props.label}`
      expect(width(hudText)).toBeLessThanOrEqual(columns)
      const hudColor = sample.name === 'toggle' ? 'warning' : color
      expect(source === undefined ? JSON.stringify(row).includes(`"color":"${hudColor}"`) : textRuns(source).some(run => run.props.color === hudColor)).toBe(true)
      const saving = sample.facts.pending?.saving
      const hudValue = sample.name === 'waiting' ? (columns === 120 ? 'auto · waiting: 3 todos open' : 'auto · waiting: 3 t…')
        : sample.name === 'failed' ? (columns === 120 ? 'auto · not tidied: Claude started work…' : 'auto · not tidied:…')
          : sample.name === 'toggle' ? (columns === 120 ? 'auto · not saved: locked by your organ…' : 'auto · not saved: l…')
            : sample.name.endsWith('countdown') ? 'auto · tidy in 0:28'
              : sample.name.startsWith('advisory') ? 'auto · tidy up 400k?'
                : sample.name === 'tidying' ? 'auto · tidying up'
                  : sample.name === 'tidied' ? 'auto · tidied'
                    : `auto · save ≈$${saving?.toFixed(2)}`
      expect(hudText.slice(hudText.indexOf('auto')), `${sample.name} exact HUD value`).toBe(`${hudValue} Turn auto off`)
      expect(world.writes.length, 'band and HUD render without state writes').toBe(beforeWrites)
      expect(storeWrites.length, 'band and HUD render without store writes').toBe(beforeStores)
      if (sample.name === 'D1 offer') expect(hudText).toContain('auto · save ≈$7.76')
      if (sample.name.endsWith('countdown')) {
        const alert = await pane.find({ key: 'hud:alerts' })
        const alertSource = rowSource(alert)
        expect(alertSource === undefined ? alert?.text : textLine(alertSource)).toContain('auto-tidy in 0:28')
      }
      await band.unmount()
      await pane.unmount()
    }
    // Unknown sizes omit the number in both surfaces' HUD and band.
    const usage = held.get('usage')!
    for (const rule of ['D1', 'advisory'] as const) {
      held.set('usage', { value: { mainRequestAt: now, rateLimits: [], compactions: 0 }, version: usage.version + 1 })
      put({ pending: rule === 'D1' ? d1 : { state: 'offer', rule, why: 'unpriced', automatic: false, reasons: [], otherReasons: 0 } })
      const band = await mountBand($, surface, columns)
      const pane = await mountPane($, surface, columns, 60)
      expect((await band.find({ key: 'tidy:0' }))?.text).toBe(rule === 'D1' ? 'save ≈$7.76 · tidy up?' : 'tidy up?')
      const row = await pane.find({ key: 'hud:context.tidy' })
      const source = rowSource(row)
      expect(source === undefined ? row?.text : textLine(source)).toContain(rule === 'D1' ? 'auto · save ≈$7.76' : 'auto · tidy up?')
      await band.unmount()
      await pane.unmount()
    }
    held.set('usage', usage)
    // A live D2 offer (including the intro) ticks without rewriting tidy facts,
    // then re-evaluates once at expiry and stops when nothing timed remains.
    for (const intro of [false, true]) {
      const at = clock.now()
      const pending = { ...t9Pending('D2', 'offer', at), ...(intro ? { intro: true as const } : {}) }
      held.set('usage', { value: { contextTokens: 400_000, mainRequestAt: at - (3_600_000 - 118_000), rateLimits: [], compactions: 0 }, version: 2000 })
      held.set('tidyGate', { value: { ...(held.get('tidyGate')?.value as HudTidyGate), requestsSinceCompaction: 0 }, version: 2000 })
      held.set('main', { value: { idleSince: at - 3_600_000, lastTurnReason: 'answer' }, version: 2000 })
      put({ pending })
      const band = await mountBand($, surface, columns)
      expect(await bandText(band)).toContain('cold in 1m58s; a cold return costs $3.20')
      const tidyWrites = world.writes.filter(key => key === 'tidy').length
      const ticks = world.writes.filter(key => key === 'bandTick').length
      await clock.advance(1000)
      await clock.settle()
      expect(await bandText(band)).toContain('cold in 1m57s; a cold return costs $3.20')
      expect(world.writes.filter(key => key === 'bandTick').length).toBeGreaterThan(ticks)
      expect(world.writes.filter(key => key === 'tidy')).toHaveLength(tidyWrites)
      await clock.advance(117_000)
      await clock.settle()
      expect(await bandText(band)).not.toContain('save ≈$2.14')
      expect((held.get('tidy')?.value as HudTidyFacts).pending?.rule).not.toBe('D2')
      const stopped = world.writes.filter(key => key === 'bandTick').length
      await clock.advance(3000)
      await clock.settle()
      expect(world.writes.filter(key => key === 'bandTick')).toHaveLength(stopped)
      await band.unmount()
    }
    // Shorten countdown first; drop the toggle only if the row still cannot fit.
    expect(tidyButtonLabels('countdown', 'auto', 43)).toEqual(['Tidy up', 'Cancel', 'Turn auto off'])
    expect(tidyButtonLabels('offer', 'ask', 48)).toEqual(['Tidy up', 'Not now', 'Turn auto on'])
    expect(tidyButtonLabels('offer', 'auto', 40)).toEqual(['Tidy up', 'Not now'])
    expect(tidyButtonLabels('countdown', 'auto', 39)).toEqual(['Tidy up', 'Cancel'])
    // Cents, including exact zero and a positive fraction of a cent, in the band and command.
    for (const [saving, amount] of [[0, '$0.00'], [0.0001, '<$0.01'], [0.01, '$0.01']] as const) {
      put({ pending: { ...d1, saving } })
      const band = await mountBand($, surface, columns)
      expect(await bandText(band)).toContain(`save ≈${amount}`)
      expect((await $.command.run({ ...TOGGLE, args: 'tidy' })).text).toContain(`save ≈${amount}`)
      await band.unmount()
    }
    // Feedback expires over both event-driven states; nothing writes tidy facts on a band tick.
    for (const state of ['offer', 'waiting'] as const) {
      const at = clock.now()
      put({ pending: { ...d1, state, firstReason: '3 todos open' }, toggle: { at, reason: TIDY_FEEDBACK_REASONS.deferredOff } })
      const band = await mountBand($, surface, columns)
      expect(await bandText(band)).toContain(TIDY_FEEDBACK_REASONS.deferredOff)
      const writes = world.writes.filter(key => key === 'tidy').length
      await clock.advance(TIDY_RESULT_MS - 1000)
      await clock.settle()
      expect(await bandText(band)).toContain(TIDY_FEEDBACK_REASONS.deferredOff)
      await clock.advance(1000)
      await clock.settle()
      expect(await bandText(band)).not.toContain(TIDY_FEEDBACK_REASONS.deferredOff)
      expect(world.writes.filter(key => key === 'tidy')).toHaveLength(writes)
      const ticks = world.writes.filter(key => key === 'bandTick').length
      await clock.advance(3000)
      await clock.settle()
      expect(world.writes.filter(key => key === 'bandTick')).toHaveLength(ticks)
      await band.unmount()
    }
    // The HUD button follows the accepted toggle procedure, not Cancel or a session override.
    put({})
    held.set('main', { value: { idleSince: clock.now() }, version: 1000 })
    const pane = await mountPane($, surface, columns)
    await pane.press({ key: 'hud:tidy:auto' })
    await clock.settle()
    expect(configWrites).toEqual(['ask'])
    await pane.unmount()
    expect(tidyCostsOf({ model: 'claude-opus-5-5', tokens: 400_000, ttl: '1h' })?.K).toBe(1.06)
  })
}

test('T4 a pending toggle names its target in the HUD and band; a second press reverses it', { options: { tidy: 'auto', mascots: false } }, async ($, on) => {
  let delayGateRead = false
  let gateReadHeld = false
  const delayedOn = ((name: string, ...args: unknown[]) => {
    if (name === 'state.get') {
      const get = args[0] as import('claude-code').Hook<'state.get'>
      args[0] = (async ($, e, next) => {
        if (e.key === 'tidyGate' && delayGateRead) {
          delayGateRead = false
          gateReadHeld = true
          await w.clock.sleep(2000)
        }
        return get($, e, next)
      }) as import('claude-code').Hook<'state.get'>
    }
    return (on as unknown as (name: string, ...args: unknown[]) => unknown)(name, ...args)
  }) as On
  const w = tidyWorld(delayedOn, $, undefined, true)
  const configWrites: unknown[] = []
  on('config.set', (_$, e) => { configWrites.push(e.value); return { value: e.value } })
  await $.session.start(START)
  await w.clock.settle()
  await w.context(400_000)
  await $.turn.start({ turnId: 'work', text: 'work' })
  const pane = await mountPane($, 'terminal', 120, 60)
  const band = await mountBand($, 'terminal', 120)
  await pane.press({ key: 'hud:tidy:auto' })
  await w.clock.settle()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggle).toBe('ask')
  // Press the same drawing again: the handler must re-read the pending target.
  await pane.press({ key: 'hud:tidy:auto' })
  await w.clock.settle()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggle).toBeUndefined()
  await pane.redraw()
  expect((await pane.find({ key: 'hud:context.tidy' }))?.text).toContain('auto · nothing due')
  expect((await pane.find({ key: 'hud:tidy:auto' }))?.props.label).toBe('Turn auto off')
  const withdrawn = await bandText(band)
  expect(withdrawn).toBe('')
  expect(withdrawn).not.toContain('auto stays on')
  expect(withdrawn).not.toContain('when this turn ends')
  expect((await $.command.run({ ...TOGGLE, args: 'tidy' })).text).not.toContain('auto stays on')
  await pane.press({ key: 'hud:tidy:auto' })
  await w.clock.settle()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggle).toBe('ask')
  await pane.redraw()
  expect((await pane.find({ key: 'hud:context.tidy' }))?.text).toContain('auto off at turn end')
  expect((await pane.find({ key: 'hud:tidy:auto' }))?.props.label).toBe('Turn auto on')
  expect(await bandText(band)).toBe('auto-tidy / auto off when this turn ends')
  expect((await $.command.run({ ...TOGGLE, args: 'tidy' })).text).toContain('auto off when this turn ends')
  // A held offer's band toggle withdraws pending ask without saving a mode.
  const facts = w.tidyFacts()!
  w.held.set('tidy', { value: { ...facts, pending: t9Pending('D1', 'offer', w.clock.now()) }, version: 3000 })
  await band.redraw()
  expect((await band.find({ key: 'tidy:auto' }))?.props.label).toBe('Turn auto on')
  await band.press({ key: 'tidy:auto' })
  await w.clock.settle()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggle).toBeUndefined()
  expect(configWrites).toHaveLength(0)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'work', reason: 'answer' })
  await w.clock.advance(0)
  await w.clock.settle()
  expect(configWrites).toEqual([])
  await $.command.run(TOGGLE)
  // Hold each press's first gate read across the final tick. Cancellation must
  // happen before that await, not when toggleTidy finally receives its target.
  const races: { control: string; duringRead: number; afterPress: number; stopped: boolean }[] = []
  for (const control of ['HUD', 'band']) {
    await w.context(400_000)
    await endMainTurn($)
    expect(w.tidyFacts()?.pending?.state, `${control} countdown starts`).toBe('countdown')
    await w.clock.advance(TIDY_COUNTDOWN_MS - 1000)
    expect(w.tidyFacts()?.pending?.state, `${control} countdown is still in progress`).toBe('countdown')
    await pane.redraw()
    await band.redraw()
    const compactBefore = w.asked.length
    gateReadHeld = false
    delayGateRead = true
    const press = control === 'HUD' ? pane.press({ key: 'hud:tidy:auto' }) : band.press({ key: 'tidy:auto' })
    await w.clock.settle()
    expect(gateReadHeld, `${control} press is waiting for its gate read`).toBe(true)
    await w.clock.advance(1000)
    const duringRead = w.asked.length - compactBefore
    await w.clock.advance(1000)
    await press
    await w.clock.settle()
    const stopped = w.tidyFacts()?.countdownSince === undefined && w.tidyFacts()?.pending?.state !== 'countdown'
    await w.clock.advance(TIDY_COUNTDOWN_MS)
    await w.clock.settle()
    races.push({ control, duringRead, afterPress: w.asked.length - compactBefore, stopped })
  }
  expect(races, 'each toggle stops the countdown before its gate read and never compacts after the press').toEqual([
    { control: 'HUD', duringRead: 0, afterPress: 0, stopped: true },
    { control: 'band', duringRead: 0, afterPress: 0, stopped: true },
  ])
  await band.unmount()
  await pane.unmount()
})

test('T4 off mode: a second press withdraws the pending toggle and nothing is saved', { options: { tidy: 'off', mascots: false } }, async ($, on) => {
  const w = tidyWorld(on, $, undefined, 'off')
  const configWrites: unknown[] = []
  const storeWrites: string[] = []
  on('config.set', (_$, e) => { configWrites.push(e.value); return { value: e.value } })
  on('store.set', (_$, e) => { storeWrites.push(e.key); return { value: undefined } })
  await $.session.start(START)
  await w.clock.settle()
  await w.context(400_000)
  await $.turn.start({ turnId: 'work', text: 'work' })
  const pane = await mountPane($, 'terminal', 120, 60)
  await pane.press({ key: 'hud:tidy:auto' })
  await w.clock.settle()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggle).toBe('auto')
  await pane.redraw()
  expect((await pane.find({ key: 'hud:context.tidy' }))?.text).toContain('auto on at turn end')
  expect((await pane.find({ key: 'hud:tidy:auto' }))?.props.label).toBe('Turn auto off')
  await pane.press({ key: 'hud:tidy:auto' })
  await w.clock.settle()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggle).toBeUndefined()
  expect((w.held.get('tidyGate')?.value as HudTidyGate).pendingToggleFrom).toBeUndefined()
  expect(w.tidyFacts()?.toggle).toBeUndefined()
  await pane.redraw()
  expect((await pane.find({ key: 'hud:context.tidy' }))?.text).toContain('off · nothing due')
  expect((await pane.find({ key: 'hud:tidy:auto' }))?.props.label).toBe('Turn auto on')
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'work', reason: 'answer' })
  await w.clock.advance(0)
  await w.clock.settle()
  expect(configWrites).toEqual([])
  expect(storeWrites).toEqual([])
  await pane.unmount()
})

test('another plugin\'s drawing beneath the band stays drawn, under the session\'s yard', async ($, on) => {
  const { clock } = bandWorld(on)
  await $.session.start(START)
  await clock.settle()
  const band = await mountBand($, 'terminal')
  const root = await band.find({ type: 'Box' })
  expect(root?.props.flexDirection).toBe('column')
  expect((await band.findAll({ type: 'Box' })).filter(one => one.key === 'band' || one.key === 'engine').map(one => one.key)).toEqual(['band', 'engine'])
  await band.unmount()
})
