import type { HudData } from '../types'

// The HUD's test fixtures. Times are built from local date parts, so a reset
// reads `↻ 14:20` and `↻ Tue` in whatever time zone the tests run.

/** Saturday 3 October 2026, 12:00 local time. */
export const NOW = new Date(2026, 9, 3, 12, 0, 0).getTime()

/** A local time `days` after NOW's date, as ISO 8601. */
export const localIso = (hours: number, minutes: number, days = 0): string =>
  new Date(2026, 9, 3 + days, hours, minutes, 0).toISOString()

const MINUTE = 60_000

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
      { kind: 'five_hour', percentUsed: 31, resetsAt: localIso(14, 20) },
      // Tuesday 6 October.
      { kind: 'seven_day', percentUsed: 12, resetsAt: localIso(9, 0, 3) },
    ],
    costUsd: 4.21,
    compactions: 3,
  },
  git: { branch: 'main', dirty: 4, added: 3, deleted: 1, ahead: 2 },
  tools: {
    current: { name: 'Bash', since: NOW - 4000 },
    counts: { Read: 41, Bash: 12, Edit: 9, Grep: 7, Write: 3 },
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
  inventory: { mcpServers: ['context7', 'notion', 'playwright', 'review-gates'], skills: 12 },
  motto: 'ship small, ship often',
  now: NOW,
}

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
    current: { name: 'mcp__playwright__browser_take_screenshot', since: NOW - 65_000 },
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
    rateLimits: [
      { kind: 'five_hour', percentUsed: 92, resetsAt: localIso(14, 20) },
      { kind: 'seven_day', percentUsed: 64, resetsAt: localIso(9, 0, 3) },
      { kind: 'spend_limit', percentUsed: 85, resetsAt: localIso(0, 0, 29) },
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

export const FIXTURES = { full, sparse, empty, manyTools, longBranch, fullContext } as const
