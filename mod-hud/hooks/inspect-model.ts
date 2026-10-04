import type { HudData, HudLedger, HudMainFacts, HudSelection, HudUsageFacts, ShadowAgentEntry } from '../types'
import { ACCENT, elapsedOf, humanize, isRunning, isStalled, lookOf, shadowLookOf, titleOf } from './agent-model'
import type { Agents } from './agent-model'
import { shadowName } from './agent-shadows'
import { busyIdleOf, contextGrowth, limitEta, shortModel, turnsUntil } from './facts'
import { formatReset } from './hud'
import { runCounts } from './hud-ledger'
import type { Settings } from './hud-options'
import type { AgentBody, InspectHeader, SessionOverview } from './inspect'
import { colourFor } from './scene-model'
import { defined } from './state-json'

// Who the inspect view shows and what its Session tab's Overview reads,
// from the facts as held: pure projections with no `$`. register.tsx reads
// the atoms and hands them in; hooks/inspect.tsx draws the rows.

const callsText = (calls: number): string => `${calls} call${calls === 1 ? '' : 's'}`

const effortText = (effort: string | undefined): string | undefined => (effort === undefined || effort.trim() === '' ? undefined : effort.trim())

/**
 * Who the inspect view shows, for its header and its tabs: the selected
 * subagent or workflow agent (undefined once it is gone), or the session.
 */
export const inspectedOf = (
  choice: HudSelection,
  all: Agents,
  workflow: readonly ShadowAgentEntry[],
  hudData: HudData | undefined,
  main: HudMainFacts,
  turns: number | undefined,
  now: number,
  settings: Settings,
): { header: InspectHeader; body?: Omit<AgentBody, 'trail' | 'detail'> } | undefined => {
  const colour = (id: string): string | undefined => (settings.mascots ? colourFor(id) : undefined)
  const facts = (...items: (string | undefined)[]): string[] => items.filter((one): one is string => one !== undefined && one !== '')
  if (choice.kind === 'main') {
    const startedAt = hudData?.session?.startedAt
    const status = main.busySince !== undefined ? 'busy' : settings.mascots && main.idleSince !== undefined ? 'idle' : undefined

    return {
      header: {
        glyph: '◆',
        glyphColour: ACCENT,
        name: 'Session',
        facts: facts(shortModel(hudData?.session?.model), effortText(hudData?.session?.effort), status, startedAt === undefined ? undefined : humanize(now - startedAt), turns === undefined ? undefined : `${turns} turn${turns === 1 ? '' : 's'}`),
      },
    }
  }
  if (choice.kind === 'agent') {
    const entry = all[choice.id]
    if (entry === undefined) return undefined
    const { glyph, color } = lookOf(entry, now, settings.stalledMs)
    const status = isStalled(entry, now, settings.stalledMs) ? 'stalled' : entry.status

    return {
      header: { glyph, glyphColour: color, name: entry.type || entry.name || entry.id, colour: colour(entry.id), facts: facts(shortModel(entry.model), effortText(entry.effort), status, elapsedOf(entry, now), callsText(entry.toolCalls)) },
      body: { kind: 'agent', description: titleOf(entry), running: isRunning(entry) },
    }
  }
  const entry = workflow.find(one => one.id === choice.id)
  if (entry === undefined) return undefined
  const { glyph, color } = shadowLookOf(entry, now, settings.stalledMs)
  const status = entry.status === 'running' && now - entry.lastSeen > settings.stalledMs ? 'stalled' : entry.status

  return {
    header: { glyph, glyphColour: color, name: shadowName(entry), colour: colour(entry.id), facts: facts('workflow', shortModel(entry.model), effortText(entry.effort), status, humanize((entry.endedAt ?? now) - entry.firstSeen), callsText(entry.toolCalls)) },
    body: { kind: 'shadow', running: entry.status === 'running' },
  }
}

const LIMIT_LABELS: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

// The Session tab's Overview, from the facts as held.
export const overviewOf = (
  usage: HudUsageFacts,
  main: HudMainFacts,
  spent: HudLedger,
  compactAt: number | undefined,
  startedAt: number | undefined,
  all: Agents,
  held: Readonly<Record<string, ShadowAgentEntry>>,
  now: number,
): SessionOverview => {
  const duration = startedAt === undefined ? undefined : Math.max(0, now - startedAt)
  const perTurn = contextGrowth(usage.contextSamples)
  const percent = usage.contextPercent ?? (usage.contextTokens !== undefined && usage.window !== undefined && usage.window > 0 ? (usage.contextTokens / usage.window) * 100 : undefined)

  return defined({
    duration,
    busy: busyIdleOf(usage, main, duration, now),
    turns: usage.turns,
    compactions: usage.compactions,
    sinceCompaction: main.compactedAt === undefined ? undefined : now - main.compactedAt,
    context: defined({
      used: usage.contextTokens,
      window: usage.window,
      percent,
      perTurn,
      turnsLeft: turnsUntil(usage.contextTokens, compactAt ?? usage.window, perTurn),
    }),
    tokens: usage.tokens,
    limits: usage.rateLimits.map(limit => {
      const resets = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)

      return defined({
        label: LIMIT_LABELS[limit.kind] ?? limit.kind,
        percent: limit.percentUsed,
        eta: limitEta(usage.limitSamples?.[limit.kind], limit.percentUsed, now),
        untilReset: Number.isFinite(resets) ? Math.max(0, resets - now) : undefined,
        reset: limit.resetsAt === undefined ? undefined : formatReset(limit.resetsAt, now) || undefined,
      })
    }),
    asks: Object.values(all).filter(entry => isRunning(entry) && entry.awaitingPermission === true).length,
    failures: spent.failures ?? { denied: 0, error: 0 },
    runs: runCounts(spent, now, id => all[id]?.status ?? held[id]?.status),
  })
}
