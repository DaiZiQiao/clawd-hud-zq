import type { HudData } from '../types'

// The HUD's test fixtures. NOW is one fixed instant, so the mascots'
// choreography, which hashes absolute frames, moves the same way in every
// time zone. A reset and a trail step are drawn on the local clock: the labels
// below are what the zone the tests run in draws for them.

/** Saturday 3 October 2026, 12:00 UTC. */
export const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)

const MINUTE = 60_000

/** The 5h window resets in 2h20; the 7d one on Tuesday 6 October; the spend limit on 1 November (at noon UTC, the 1st or the 2nd in any zone). */
export const RESET_5H = new Date(NOW + 140 * MINUTE).toISOString()
export const RESET_7D = new Date(Date.UTC(2026, 9, 6, 9, 0, 0)).toISOString()
export const RESET_SPEND = new Date(Date.UTC(2026, 10, 1, 12, 0, 0)).toISOString()

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `12:00:00`: a time on this zone's clock, as a trail step reads. */
export const clockOf = (ms: number): string => {
  const date = new Date(ms)

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** `↻ 14:20`: RESET_5H, under a day ahead, on this zone's clock. */
export const AT_5H = `↻ ${clockOf(Date.parse(RESET_5H)).slice(0, 5)}`
/** `↻ Tue`: RESET_7D, under a week ahead, as this zone's weekday. */
export const AT_7D = `↻ ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(RESET_7D).getDay()] ?? ''}`
/** `↻ Nov 1`: RESET_SPEND, past a week ahead, as this zone's date. */
export const AT_SPEND = `↻ Nov ${new Date(RESET_SPEND).getDate()}`
/** `↻14:20`: RESET_5H as the shared limits row and the alert strip draw it, tight. */
export const TIGHT_5H = AT_5H.replace('↻ ', '↻')
/** `↻Tue`: RESET_7D, tight. */
export const TIGHT_7D = AT_7D.replace('↻ ', '↻')

/**
 * The 5h window's percent over the last 35 minutes: 11 % at its start, 31 %
 * now. At that burn it runs out about 1h44m on, before its reset at 2h20.
 */
export const FIVE_HOUR_SAMPLES = [
  { at: NOW - 35 * MINUTE, percent: 11 },
  { at: NOW - 20 * MINUTE, percent: 20 },
  { at: NOW - 5 * MINUTE, percent: 31 },
]

/** When the 5h window runs out at that burn: 69 % left at 20 % per 30 minutes, 103.5 minutes on. */
export const OUT_5H = NOW + 103.5 * MINUTE
/** `13:43`: OUT_5H on this zone's clock, as the alert strip draws it (`5h out ~13:43`). */
export const AT_OUT_5H = clockOf(OUT_5H).slice(0, 5)

/** The context as each of the last five main turns ended: 65k a turn, so ~6 turns from 412k to the 800k threshold. */
export const CONTEXT_SAMPLES = [152_000, 217_000, 282_000, 347_000, 412_000]

/** Everything known: the sketch in docs/pane-sketch.md. */
export const full: HudData = {
  session: {
    model: 'claude-opus-5-5[1m]',
    effort: 'xhigh',
    provider: 'gateway',
    startedAt: NOW - 72 * MINUTE,
    cwd: '/Users/daiziqiao/.claude/mods',
    repoRoot: '/Users/daiziqiao/.claude',
  },
  usage: {
    contextTokens: 412_000,
    contextPercent: 41.2,
    window: 1_000_000,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 31, resetsAt: RESET_5H },
      { kind: 'seven_day', percentUsed: 12, resetsAt: RESET_7D },
    ],
    costUsd: 4.21,
    // 87 % of the input served by the cache.
    tokens: { input: 300_000, output: 84_000, cacheRead: 9_800_000, cacheWrite: 1_164_000 },
    compactions: 3,
    contextSamples: CONTEXT_SAMPLES,
    limitSamples: { five_hour: FIVE_HOUR_SAMPLES },
    lastTurn: { costUsd: 0.38, durationMs: 72_000, tokens: 24_000 },
    agentShare: 0.38,
  },
  git: { branch: 'main', dirty: 4, added: 3, deleted: 1, ahead: 2, linesAdded: 142, linesDeleted: 37, lastCommitAt: NOW - 48 * MINUTE },
  tools: {
    current: { name: 'Bash', since: NOW - 4000, arg: 'npm test -- hud' },
    counts: { Read: 41, Bash: 12, Edit: 9, Grep: 7, Write: 3 },
    edited: 7,
  },
  todos: {
    items: [
      { content: 'Read the pane', status: 'completed', activeForm: 'Reading the pane' },
      { content: 'Sketch the HUD', status: 'completed', activeForm: 'Sketching the HUD' },
      { content: 'Write the renderer', status: 'completed', activeForm: 'Writing the renderer' },
      { content: 'Wire the status line', status: 'in_progress', activeForm: 'Wiring the status line' },
      { content: 'Review the diff', status: 'pending', activeForm: 'Reviewing the diff' },
    ],
  },
  inventory: { mcpServers: ['context7', 'notion', 'playwright', 'review-gates'], skills: 12, compactAt: 800_000 },
  main: { busySince: NOW - 42_000 },
  // The main loop's last request answered 18 minutes ago: 42 minutes left of an hour.
  cache: { ttl: '1h', lastAt: NOW - 18 * MINUTE },
  alerts: { asks: 2 },
  motto: 'ship small, ship often',
  now: NOW,
}

/** The sketch an hour and ten minutes after the main loop's last request: the cache cold. */
export const coldCache: HudData = { ...full, cache: { ttl: '1h', lastAt: NOW - 70 * MINUTE }, alerts: undefined, usage: { ...full.usage!, limitSamples: undefined } }

/** The sketch with 90 seconds left on the cache: cooling, and the alert strip says so. */
export const coolingCache: HudData = { ...full, cache: { ttl: '1h', lastAt: NOW - 3_510_000 }, alerts: undefined, usage: { ...full.usage!, limitSamples: undefined } }

/** A session twelve seconds old: a model and a clock, nothing measured yet. */
export const sparse: HudData = {
  session: { model: 'claude-opus-5-5[1m]', effort: 'xhigh', startedAt: NOW - 12_000 },
  usage: { rateLimits: [], compactions: 0, costUsd: 0 },
  git: {},
  tools: { counts: {} },
  todos: { items: [] },
  inventory: { mcpServers: [] },
  now: NOW,
}

/** Nothing at all. */
export const empty: HudData = { now: NOW }

/** Fifteen tools, MCP ones among them, and a long MCP call running. */
export const manyTools: HudData = {
  ...full,
  tools: {
    current: { name: 'mcp__playwright__browser_take_screenshot', since: NOW - 65_000, arg: 'https://example.com/a/page/with/a/long/address' },
    counts: {
      Read: 141,
      Bash: 96,
      Edit: 52,
      Grep: 40,
      Glob: 31,
      Write: 18,
      Agent: 12,
      WebFetch: 9,
      WebSearch: 7,
      TodoWrite: 6,
      'mcp__github__create_pull_request': 4,
      'mcp__playwright__browser_take_screenshot': 3,
      'playwright:browser_navigate': 3,
      NotebookEdit: 2,
      Skill: 1,
    },
  },
}

/** A branch, a todo and a motto far longer than any pane. */
export const longBranch: HudData = {
  ...full,
  git: { ...full.git, branch: 'feature/very-long-branch-name-that-keeps-going-and-going-for-testing' },
  todos: {
    items: [
      { content: 'Plan', status: 'completed' },
      {
        content: 'Rewrite the reconciliation loop',
        status: 'in_progress',
        activeForm: 'Rewriting the reconciliation loop so a missed compare-and-set retries against fresh activity\nand never drops an agent',
      },
    ],
  },
  motto: 'a motto long enough to run past the edge of every pane this HUD is ever drawn into, twice over',
}

/** The context window full and both limits hot. */
export const fullContext: HudData = {
  ...full,
  usage: {
    ...(full.usage ?? { rateLimits: [], compactions: 0 }),
    contextTokens: 1_000_000,
    contextPercent: 100,
    contextSamples: undefined,
    limitSamples: undefined,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 92, resetsAt: RESET_5H },
      { kind: 'seven_day', percentUsed: 64, resetsAt: RESET_7D },
      { kind: 'spend_limit', percentUsed: 85, resetsAt: RESET_SPEND },
    ],
  },
}

/** A seven-item todo list: three done, one in progress, three pending. */
export const sevenTodos: NonNullable<HudData['todos']> = {
  items: [
    { content: 'Read the brief', status: 'completed', activeForm: 'Reading the brief' },
    { content: 'Split the sprites out', status: 'completed', activeForm: 'Splitting the sprites out' },
    { content: 'Write the choreography', status: 'completed', activeForm: 'Writing the choreography' },
    { content: 'Wire the detail view', status: 'in_progress', activeForm: 'Wiring the detail view' },
    { content: 'Test the scenes', status: 'pending', activeForm: 'Testing the scenes' },
    { content: 'Update the sprite sheet', status: 'pending', activeForm: 'Updating the sprite sheet' },
    { content: 'Sketch the pane at 72 and 48 columns', status: 'pending', activeForm: 'Sketching the pane' },
  ],
}

/** Every item done. */
export const allDone: NonNullable<HudData['todos']> = {
  items: (sevenTodos.items).map(item => ({ ...item, status: 'completed' as const })),
}

/**
 * Everything that can need attention at once: two asks, the 5h window running
 * out, a stalled agent, a compaction two turns off, three failed calls and the
 * branch three behind.
 */
export const alarmed: HudData = {
  ...full,
  usage: { ...(full.usage ?? { rateLimits: [], compactions: 0 }), contextTokens: 700_000, contextPercent: 70 },
  git: { ...full.git, behind: 3 },
  main: { idleSince: NOW - 3 * MINUTE },
  alerts: { asks: 2, stalled: 1, failures: 3 },
}

/** Nothing needs attention: the sketch with no asks and no limit samples. */
export const calm: HudData = {
  ...full,
  usage: { ...(full.usage ?? { rateLimits: [], compactions: 0 }), limitSamples: undefined },
  alerts: undefined,
}

export const FIXTURES = { full, sparse, empty, manyTools, longBranch, fullContext, alarmed, calm, coldCache, coolingCache } as const
