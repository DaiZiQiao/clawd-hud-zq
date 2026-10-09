import type { PluginOptions } from 'claude-code'

import { TODO_ROWS } from './hud'
import type { Character } from './scene-types'
import type { TidyMode } from './tidy'

// The mod's options (`userConfig` in plugin.json) as the hooks use them:
// every HUD part shown unless switched off, the status line opt-in, numbers
// kept positive.

/** The motto drawn dim under the HUD when the option is left as it is: none since 1.2.0. */
const DEFAULT_MOTTO = ''

export type Settings = {
  stalledMs: number
  statusLine: boolean
  maxRows: number
  showGit: boolean
  showTools: boolean
  showTodos: boolean
  /** Reads the context breakdown (MCP servers, skills, the auto-compact threshold); the HUD no longer draws its counts. */
  showInventory: boolean
  motto: string
  mascots: boolean
  /** Who the mascots are: Clawd (the default), or Usagi. */
  character: Character
  showWorkflows: boolean
  inspect: boolean
  /**
   * How an inspected agent (or the session) shows: `tv`, its mascot grown
   * into a TV over the pane where the surface can (terminal, desktop) and the
   * pane has room; `pane`, the inspect view under the HUD in the lists' place.
   */
  inspectView: 'tv' | 'pane'
  wander: boolean
  scenes: boolean
  todoRows: number
  collisions: 'off' | 'rare' | 'normal'
  /** The prompt cache's TTL the context section counts down: `auto` infers it (hooks/facts.ts `cacheTtlOf`). */
  cacheTtl: 'auto' | '5m' | '1h'
  /** `smooth`: the scene runs in a `Client` surface module where the surface has one; `classic` keeps the Box/Text scene everywhere. */
  motion: 'smooth' | 'classic'
  /**
   * Where the session's own mascot lives: `band`, in the band above the
   * prompt where the surface draws one (terminal, desktop), the subagents in
   * the pane; `pane`, in the pane's scene with them, as before 1.4.0.
   */
  sessionMascot: 'band' | 'pane'
  /** Tidying up the main conversation (hooks/tidy.ts): offered in the band (`ask`), counted down and started (`auto`), or never (`off`). */
  tidy: TidyMode
  /** The context, in tokens, past which a tidy is due (the `tidyAt` option is in thousands). */
  tidyAt: number
}

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

// The status line is opt-in; every HUD part is shown unless switched off.
export const settingsOf = (options: PluginOptions): Settings => ({
  stalledMs: positive(options.stalledAfterSec, 240) * 1000,
  statusLine: options.statusLine === true,
  maxRows: Math.max(1, Math.floor(positive(options.maxRows, 40))),
  showGit: options.showGit !== false,
  showTools: options.showTools !== false,
  showTodos: options.showTodos !== false,
  showInventory: options.showInventory !== false,
  // Left unset, the default motto (none); an empty one draws none.
  motto: typeof options.motto === 'string' ? options.motto.trim() : DEFAULT_MOTTO,
  mascots: options.mascots !== false,
  character: options.character === 'usagi' ? 'usagi' : 'clawd',
  showWorkflows: options.showWorkflows !== false,
  inspect: options.inspect !== false,
  inspectView: options.inspectView === 'pane' ? 'pane' : 'tv',
  wander: options.wander !== false,
  scenes: options.scenes !== false,
  todoRows: Math.max(1, Math.floor(positive(options.todoRows, TODO_ROWS))),
  collisions: options.collisions === 'off' || options.collisions === 'normal' ? options.collisions : 'rare',
  motion: options.motion === 'classic' ? 'classic' : 'smooth',
  cacheTtl: options.cacheTtl === '5m' || options.cacheTtl === '1h' ? options.cacheTtl : 'auto',
  sessionMascot: options.sessionMascot === 'pane' ? 'pane' : 'band',
  tidy: options.tidy === 'auto' || options.tidy === 'off' ? options.tidy : 'ask',
  tidyAt: Math.round(positive(options.tidyAt, 150) * 1000),
})
