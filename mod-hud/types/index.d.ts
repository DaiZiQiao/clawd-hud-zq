/** A turn-completion reason or an engine task status (`AgentInfo.status` is open-ended). */
export type AgentBoardOutcome = string

export type AgentBoardEntry = {
  id: string
  toolUseId?: string
  parentId?: string
  type: string
  model?: string
  /** The last `turn.step`'s effort, when one was recorded; the mascot's build follows it. */
  effort?: string
  description: string
  name?: string
  background: boolean
  /** `$.clock.now()` at spawn; 0 when seeded from `$.agent.list()`. */
  startedAt: number
  endedAt?: number
  lastActivityAt: number
  /** 'stalled' is derived at draw time, never stored. */
  status: 'running' | 'done' | 'failed'
  outcome?: AgentBoardOutcome
  toolCalls: number
  currentTool?: string
  /** First non-empty line of the answer, at most 200 characters. */
  summary?: string
  /** At least one tracked call has a lingering permission ask; clears after the last such call ends. */
  awaitingPermission?: boolean
  /**
   * When its run of Read, Grep and Glob calls began: set by the first such call
   * after any other, cleared by any other call (written with the call's start,
   * never on its own). The mascot scene's reading streak.
   */
  readingSince?: number
  /** Reserved for later mods. */
  labels?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'mod-hud': {
      agents: Record<string, AgentBoardEntry>
      tick: number
      /** Quarter-second frame clock, written only while a visible scene fits. */
      sceneTick: number
      dismissed: string[]
      seeded: boolean
      statusText: string | null
      session: HudSessionFacts
      usage: HudUsageFacts
      git: HudGitFacts
      tools: HudToolFacts
      todos: HudTodoFacts
      inventory: HudInventoryFacts
      main: HudMainFacts
      /** Workflow agents, by id: kept beside `agents`, never in it. */
      shadows: Record<string, ShadowAgentEntry>
      /** The agent (or the session, `main`) the inspect view shows, and its tab; written only by a press (a row's, a mascot's, a tab's, or Back). */
      selected: HudSelection | null
      /** The selected subagent's prompt and last answers: fetched on selection, on a tab that needs them, and on its turn ends; never per frame. */
      detail: HudDetailFacts | null
      /** Each agent's calls: at most 200 each, 800 total; start/end writes only while held. */
      trails: Record<string, HudTrailStep[]>
      /** Which lists and Cost-tree models are expanded; written only by a press. */
      listView: HudListView
      /** What each loop spent, by model: one write per request (`turn.step`), per agent turn end and per failed call. */
      ledger: HudLedger
    }
  }
}

/** A tab of the inspect view: an agent's (`task` to `agents`) or the session's (`overview`, `cost`, `agents`). */
export type HudTab = 'task' | 'trail' | 'said' | 'agents' | 'overview' | 'cost'

/** What the inspect view shows: a board subagent, a workflow agent, or the session itself (`main`), and on which tab. */
export type HudSelection = { id: string; kind: 'agent' | 'shadow' | 'main'; tab?: HudTab }

/** The selected subagent's conversation, as `$.session.messages({ agentId })` gave it. */
export type HudDetailFacts = {
  id: string
  /** Its last assistant messages with text, oldest first: at most 10, each at most 2,000 characters. */
  said?: string[]
  /** The first user message with text: the prompt it was given, at most 8,000 characters. */
  prompt?: string
  /** Why none was read (the engine's deny). */
  deny?: string
  /** When it was read. */
  at: number
}

/**
 * One tool call of an agent, for its trail: the tool, its main argument (at
 * most 160 characters), when it started, and once it ended, how long it took
 * and how it ended.
 */
export type HudTrailStep = { tool: string; arg?: string; at: number; ms?: number; outcome?: 'ok' | 'denied' | 'error' }

/** Which of the pane's lists show every finished agent, which are minimised, and which Cost-tree models are open. */
export type HudListView = {
  /** The Agents group lists every finished subagent, not only the three most recent. */
  agents?: true
  /** The Workflow group lists every finished workflow agent. */
  workflow?: true
  /** The Agents group is minimised to its header line. */
  agentsMinimised?: true
  /** The Workflow group is minimised to its header line. */
  workflowMinimised?: true
  /** The models whose users the Session tab's Cost tree lists. */
  models?: string[]
  /** The TODO section lists every item instead of its one progress line. */
  todosExpanded?: true
}

/**
 * One loop's spend: the session's own (`main`), a subagent's, a workflow
 * agent's, or a loop no list names that has not shown as one (`fork`: the
 * engine's one-request compaction and memory forks, until it shows).
 */
export type HudLedgerEntry = {
  kind: 'main' | 'agent' | 'workflow' | 'fork'
  /** A subagent's type, a workflow agent's `wf-` name. */
  name?: string
  /** A subagent's task description. */
  description?: string
  /** Its tokens by model, as the API named the model. */
  models: Record<string, HudTokenFacts>
  /** Its first request (a subagent's spawn, when known). */
  firstAt: number
  /** Its latest request. */
  lastAt: number
  /** When its run last ended, and how; absent while it runs. */
  endedAt?: number
  status?: 'done' | 'failed'
}

/**
 * What each loop spent: by loop, then the finished ones compacted an hour after
 * they ended (or past 500 loops) into one bucket per model. Prices are applied
 * when it is drawn (hooks/facts.ts); `costUsd` stays the session's total.
 */
export type HudLedger = {
  entries: Record<string, HudLedgerEntry>
  /** The compacted loops' tokens by model, and how many loops used it. */
  others: Record<string, HudTokenFacts & { agents: number }>
  /** The compacted loops counted: how many, how they ended, and their running time. */
  gone?: { agents: number; done: number; failed: number; ms: number }
  /** Tool calls, in any loop, that ended denied or in an error. */
  failures?: { denied: number; error: number }
}

/**
 * A workflow agent (the Workflow tool's `agent()` calls), seen only through
 * its loop's events: a `turn.step`, `tool.call` or `turn.complete` whose
 * `agentId` is neither on the board nor in the latest `$.agent.list()`.
 * Written once per step, call start, call end and turn end; nothing per tick.
 * Shown once it made a tool call or a second step (the engine's one-step
 * compaction and memory forks never show); dropped 10 minutes after its last
 * event, or 30 s after it ended.
 */
export type ShadowAgentEntry = {
  id: string
  /** The last `turn.step`'s model. */
  model?: string
  /** The last `turn.step`'s effort. */
  effort?: string
  /** `$.clock.now()` at the first event seen for this id. */
  firstSeen: number
  /** When the first tool call or second request made it visible; arrival starts here. */
  visibleAt?: number
  /** `$.clock.now()` at the latest event. */
  lastSeen: number
  /** `turn.step`s seen: its model requests. */
  steps: number
  toolCalls: number
  currentTool?: string
  lastTool?: string
  /** When its run of Read, Grep and Glob calls began, as on a board entry. */
  readingSince?: number
  status: 'running' | 'done' | 'failed'
  endedAt?: number
  /** The `turn.complete` reason that ended it: `answer` is done, any other failed. */
  reason?: string
}

/**
 * The main loop's activity, for the mascot scene (hooks/scene-model.ts): written
 * once when a main turn starts its first request and once when it ends, and
 * at each main compaction; nothing per tick.
 */
export type HudMainFacts = {
  /** When the main loop started working; absent while it is idle. */
  busySince?: number
  /** When it last stopped working. */
  idleSince?: number
  /** When the main conversation was last compacted. */
  compactedAt?: number
}

// The HUD's facts as `$.state` holds them (hooks/facts.ts assembles them into
// what the renderer draws). A fact the engine has not given yet is left out.

/** Who and where the session is. */
export type HudSessionFacts = {
  /** The main loop's model, as `/model` shows it or the last main `turn.step` named it. */
  model?: string
  /** The main loop's effort: the last main `turn.step`'s, else the settings'. */
  effort?: string
  /** 'gateway' when `ANTHROPIC_BASE_URL` is set. */
  provider?: 'gateway'
  /** The engine start, or `$.clock.now()` at clear until a fresh start is known. */
  startedAt?: number
  cwd?: string
  /** The git repository's root; absent outside one. */
  repoRoot?: string
}

/** One rate-limit window, of a kind the HUD knows. */
export type HudRateLimitFact = {
  kind: 'five_hour' | 'seven_day' | 'spend_limit'
  /** 0 to 100, past 100 on an exceeded spend limit. */
  percentUsed: number
  /** ISO 8601, as the engine reports it. */
  resetsAt?: string
}

/**
 * The tokens the session's requests went over and wrote, summed over every
 * response that reported them: the main loop's, the subagents', the workflow
 * agents' and the compactions'.
 */
export type HudTokenFacts = {
  /** Input read fresh: neither served by nor written to the prompt cache. */
  input: number
  /** Generated. */
  output: number
  /** Input the prompt cache served. */
  cacheRead: number
  /** Input written to the prompt cache. */
  cacheWrite: number
}

/** The context window, the rate limits, the cost, the tokens and the compaction count. */
export type HudUsageFacts = {
  /** Input tokens of the last response; absent before one and right after a compaction. */
  contextTokens?: number
  contextPercent?: number
  window?: number
  /**
   * The last reading of each window: empty off a subscription or before the
   * first reading; a window a later response did not report is kept until it resets.
   */
  rateLimits: HudRateLimitFact[]
  costUsd?: number
  /** Absent before the first response that reported usage; starts over at /clear. */
  tokens?: HudTokenFacts
  /** Main-loop compactions that took place (the last one's time is `main.compactedAt`). */
  compactions: number
  /** Main-loop turns ended (`turn.complete` without an agent); starts over at /clear. */
  turns?: number
  /** Those turns' wall-clock time summed (`turn.complete`'s `durationMs`): the main loop's busy time. */
  busyMs?: number
  /** The context's tokens as each of the last main turns ended, oldest first (at most 11): its growth per turn. */
  contextSamples?: number[]
  /**
   * Each window's percent as it changed, oldest first: the last 30 minutes'
   * changes and the one before them (at most 32), for its burn rate.
   */
  limitSamples?: { [K in HudRateLimitFact['kind']]?: { at: number; percent: number }[] }
}

/** `git status --porcelain=v2 --branch`, counted; empty outside a repository. */
export type HudGitFacts = {
  /** The branch, or the short commit on a detached HEAD. */
  branch?: string
  /** Changed paths, untracked ones included. */
  dirty?: number
  /** Paths added or untracked. */
  added?: number
  deleted?: number
  /** Absent without an upstream. */
  ahead?: number
  behind?: number
  /** When this reading was taken. */
  at?: number
}

/** The main loop's tool running now, its calls by tool, and the files it edited. */
export type HudToolFacts = {
  /**
   * `name` reads `server:tool` for an MCP tool; `id` is the call's tool_use_id;
   * `arg` its main argument (a path, a command, a pattern: at most 160 characters).
   */
  current?: { name: string; since: number; id?: string; arg?: string }
  counts: Record<string, number>
  /**
   * The distinct files the main loop's Edit, Write, MultiEdit and NotebookEdit
   * calls changed (each call that ended ok), oldest first, at most 500; starts
   * over at /clear.
   */
  edited?: string[]
}

export type HudTodoItemFact = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

/** The main loop's last TodoWrite list. */
export type HudTodoFacts = {
  items: HudTodoItemFact[]
  at?: number
}

/** What the context carries, from a `summary` breakdown at most once per five minutes. */
export type HudInventoryFacts = {
  /** MCP servers with tools in the context, sorted. */
  mcpServers: string[]
  /** How many skills the session has. */
  skills?: number
  /** The context's token count at which auto-compaction runs; absent when it is off or unknown. */
  compactAt?: number
  /** When the breakdown was read. */
  at?: number
}

// --- what the HUD renderer draws (hooks/hud.tsx) ------------------------------
// `renderHud` and `statusLineText` read one `HudData`. Every field may be
// absent and every row copes: a fact not given hides its row or cell. Each
// part is a structural supertype of the matching `Hud*Facts` above, so the
// facts as held assign to it directly.

/** Who the session is and where it runs. */
export type HudSession = {
  /** Any model id or label: `claude-opus-5-5[1m]` draws as `opus 5.5`. */
  model?: string
  effort?: string
  provider?: string
  /** In `$.clock.now()` milliseconds, the same clock as `HudData.now`. */
  startedAt?: number
  cwd?: string
  repoRoot?: string
}

/** One rate-limit window. */
export type HudRateLimit = {
  kind: 'five_hour' | 'seven_day' | 'spend_limit'
  /** 0 to 100; more on an exceeded spend limit. */
  percentUsed: number
  /** ISO 8601. */
  resetsAt?: string
}

/** The session's tokens by kind (HudTokenFacts). */
export type HudTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type HudUsage = {
  contextTokens?: number
  /** 0 to 100; derived from `contextTokens / window` when absent. */
  contextPercent?: number
  window?: number
  rateLimits: HudRateLimit[]
  costUsd?: number
  tokens?: HudTokens
  compactions: number
  /** The context's tokens as each of the last main turns ended (HudUsageFacts): the ctx row's runway to compaction. */
  contextSamples?: number[]
  /** Each window's percent as it changed (HudUsageFacts): the alert strip's limit ETA. */
  limitSamples?: { [K in HudRateLimit['kind']]?: { at: number; percent: number }[] }
}

export type HudGit = {
  branch?: string
  /** Changed paths (a count), or just whether the tree is dirty. */
  dirty?: number | boolean
  /** Paths added or untracked. */
  added?: number
  /** Paths deleted. */
  deleted?: number
  ahead?: number
  behind?: number
}

export type HudTools = {
  /** The tool running now and its main argument; `since` in `$.clock.now()` milliseconds. */
  current?: { name: string; since: number; arg?: string }
  /** Calls so far, by tool name (kept for `/mod-hud facts`; the HUD no longer draws them). */
  counts: Record<string, number>
  /** How many distinct files the main loop edited this conversation. */
  edited?: number
}

export type HudTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export type HudTodos = {
  items: HudTodo[]
}

export type HudInventory = {
  mcpServers: string[]
  skills?: number
  /** The context's token count at which auto-compaction runs: marked on the ctx bar. */
  compactAt?: number
}

/** The main loop working or idle (HudMainFacts): the identity row's `● working 00:42` / `○ idle 3m`. */
export type HudMain = {
  busySince?: number
  idleSince?: number
}

/**
 * What needs attention that the facts above do not carry, counted by the
 * caller from the board, the workflow record and the ledger. A count of 0 is
 * the same as none.
 */
export type HudAlerts = {
  /** Running subagents waiting on a permission ask. */
  asks?: number
  /** Running subagents and workflow agents quiet past `stalledAfterSec`. */
  stalled?: number
  /** Tool calls, in any loop, that ended denied or in an error this conversation. */
  failures?: number
}

/** Everything the HUD draws, read once per frame. */
export type HudData = {
  session?: HudSession
  usage?: HudUsage
  git?: HudGit
  tools?: HudTools
  todos?: HudTodos
  inventory?: HudInventory
  main?: HudMain
  alerts?: HudAlerts
  /** One dim line under the HUD. */
  motto?: string
  /** `$.clock.now()` at draw time: every elapsed time is measured from it. */
  now: number
}

/** The room the HUD is drawn into. */
export type HudLayout = {
  /** Cells across: the pane's `bodyColumns`. */
  columns: number
  /** Rows the pane shows, when known: the HUD takes at most half (never fewer than four). */
  rows?: number
  /**
   * The pane's narrow layout (below 60 columns): the same sections stacked one
   * per row, with 10-cell bars (8 below 44 columns, none at 36 and under).
   */
  isNarrow: boolean
}
