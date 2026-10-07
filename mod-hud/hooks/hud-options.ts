import type { PluginOptions } from 'claude-code'

import { TODO_ROWS } from './hud'
import type { Character } from './scene-types'

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
  wander: boolean
  scenes: boolean
  todoRows: number
  collisions: 'off' | 'rare' | 'normal'
  /** The prompt cache's TTL the context section counts down: `auto` infers it (hooks/facts.ts `cacheTtlOf`). */
  cacheTtl: 'auto' | '5m' | '1h'
  /** `smooth`: the scene runs in a `Client` surface module where the surface has one; `classic` keeps the Box/Text scene everywhere. */
  motion: 'smooth' | 'classic'
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
  wander: options.wander !== false,
  scenes: options.scenes !== false,
  todoRows: Math.max(1, Math.floor(positive(options.todoRows, TODO_ROWS))),
  collisions: options.collisions === 'off' || options.collisions === 'normal' ? options.collisions : 'rare',
  motion: options.motion === 'classic' ? 'classic' : 'smooth',
  cacheTtl: options.cacheTtl === '5m' || options.cacheTtl === '1h' ? options.cacheTtl : 'auto',
})
