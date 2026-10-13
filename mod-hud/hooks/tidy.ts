import type { HudMainFacts, HudTidied, HudTidyFacts, HudTidyGate } from '../types'
import { formatLeft, formatSpan, formatTokens } from './hud'
import { TIDY_AFTER, TIDY_AGAIN, TIDY_MIN, TIDY_RESULT_MS, tidyCostsOf } from './tidy-policy'
import { TIDY_STALE_MS } from './scene-phases'
import { displayWidth, printable, truncate } from './text-width'

export { TIDY_AFTER, TIDY_AGAIN, TIDY_FRESH, TIDY_MIN, TIDY_RESULT_MS, TIDY_SUMMARY } from './tidy-policy'

// Tidying up: compacting the main conversation once its context has grown
// past the `tidyAt` option, offered in the band above the prompt (`ask`),
// counted down and started there (`auto`), or never (`off`); and what the band
// says while any compaction of the main conversation runs and after it. Pure
// functions of the facts and the time: the hooks (hooks/register.tsx) write
// the facts and draw the lines.

export type TidyMode = 'ask' | 'auto' | 'off'

/** What the summary is told to keep, as typed after `/compact`. */
export const TIDY_INSTRUCTIONS = 'Keep the task in progress and its plan, the todo list with each item\'s status, the decisions made and why, open questions, and the files being worked on with what is left to do in each.'

/** `auto`: the band counts down this long after a main turn ends before it tidies up. */
export const TIDY_COUNTDOWN_MS = 30_000

/** Mod-started summaries include the work that can be invisible to the model. */
export const tidyInstructionsOf = (gate: Pick<HudTidyGate, 'todos' | 'tasks'>, edited: readonly string[] = []): string => [
  TIDY_INSTRUCTIONS,
  ...gate.todos.map(item => `Todo [${item.status}]: ${item.content}`),
  ...gate.tasks.filter(item => !['completed', 'deleted'].includes(item.status)).map(item => `Task [${item.status}]: ${item.subject}`),
  ...edited.slice(-10).map(path => `File: ${path}`),
].join('\n').slice(0, 2000)

type PendingCopy = { decision?: HudTidyFacts['pending']; feedback?: string }

/** What the band shows of tidying, if anything. */
export type BandTidy =
  | { kind: 'tidying'; since: number; before?: number }
  | { kind: 'tidied'; tidied: HudTidied }
  | { kind: 'failed'; reason: string }
  | { kind: 'toggle'; reason: string }
  | ({ kind: 'countdown'; leftMs: number; tokens?: number } & PendingCopy)
  | ({ kind: 'offer'; tokens?: number; payback?: number; intro?: true; saving?: number } & PendingCopy)
  | ({ kind: 'waiting'; reason: string } & PendingCopy)

export type TidyInputs = {
  mode: TidyMode
  /** The `tidyAt` option, in tokens. */
  at: number
  /** The context's tokens as the last main response counted them; absent before one and right after a compaction. */
  tokens?: number
  main: HudMainFacts
  tidy: HudTidyFacts
  /** The main loop's model, for the estimate's prices. */
  model?: string
  now: number
  /** Hook-built pending decisions; pure legacy callers can still use the floor-only inputs. */
  scheduled?: true
}

/** A compaction of the main conversation running now (and not left over from a reload mid-way). */
const isTidying = (tidy: HudTidyFacts, now: number): boolean =>
  tidy.runningSince !== undefined && now - tidy.runningSince >= 0 && now - tidy.runningSince < TIDY_STALE_MS

/**
 * Whether the context is due a tidy: the option on, the context past
 * `tidyAt` (and TIDY_MIN), the main loop idle and not compacting, not put
 * off by Not now within TIDY_AGAIN tokens, and grown TIDY_AGAIN tokens past
 * what the last compaction left (a context that stays past `tidyAt` after
 * one, its tools and instructions alone, is not tidied again and again).
 */
export const isTidyDue = ({ mode, at, tokens, main, tidy, now }: TidyInputs): boolean =>
  mode !== 'off'
  && tokens !== undefined
  && tokens >= Math.max(at, TIDY_MIN)
  && main.busySince === undefined
  && !isTidying(tidy, now)
  && (tidy.dismissedAt === undefined || tokens >= tidy.dismissedAt + TIDY_AGAIN)
  && (tidy.last?.after === undefined || tokens >= tidy.last.after + TIDY_AGAIN)

/**
 * After how many main requests a tidy pays for itself, at the model's list
 * prices: what it costs once (the summarizer reading the context from the
 * cache, writing its summary, the next request caching what is left plus
 * fresh input) over what every request after it saves. Without a TTL input,
 * the estimate uses the conservative one-hour write price.
 * Undefined for a model with no price, or nothing to save.
 */
export const paybackOf = (model: string | undefined, tokens: number, after: number): number | undefined =>
  tidyCostsOf({ model, tokens, after, ttl: '1h' })?.payback

/**
 * The band's tidy at `now`, most pressing first: a compaction running, the
 * last one's result, a failed ask, then (while one is due) the `auto`
 * countdown or the offer.
 */
export const bandTidyOf = (inputs: TidyInputs): BandTidy | undefined => {
  const { tidy, now } = inputs
  if (isTidying(tidy, now)) return { kind: 'tidying', since: tidy.runningSince as number, ...(inputs.tokens === undefined ? {} : { before: inputs.tokens }) }
  if (tidy.last !== undefined && now - tidy.last.at >= 0 && now - tidy.last.at < TIDY_RESULT_MS) return { kind: 'tidied', tidied: tidy.last }
  if (tidy.failed !== undefined && now - tidy.failed.at >= 0 && now - tidy.failed.at < TIDY_RESULT_MS) return { kind: 'failed', reason: tidy.failed.reason }
  const feedback = tidy.toggle !== undefined && now - tidy.toggle.at >= 0 && now - tidy.toggle.at < TIDY_RESULT_MS ? tidy.toggle.reason : undefined
  const overlay = feedback === undefined ? {} : { feedback }
  const standalone = feedback === undefined ? undefined : { kind: 'toggle' as const, reason: feedback }
  if (inputs.scheduled === true) {
    const pending = inputs.mode === 'off' ? undefined : tidy.pending
    if (pending === undefined) return standalone
    const tokens = inputs.tokens
    const copy = { decision: pending, ...overlay }
    if (pending.state === 'waiting') return { kind: 'waiting', reason: pending.firstReason ?? 'the next turn to end', ...copy }
    if (pending.state === 'countdown') return { kind: 'countdown', leftMs: Math.max(0, (pending.endsAt ?? now) - now), tokens, ...copy }

    return { kind: 'offer', tokens, ...copy, ...(pending.intro === true ? { intro: true as const, saving: pending.saving } : {}), ...(pending.costs?.payback === undefined ? {} : { payback: pending.costs.payback }) }
  }
  if (!isTidyDue(inputs)) return standalone
  const tokens = inputs.tokens as number
  if (inputs.mode === 'auto' && tidy.countdownSince !== undefined) return { kind: 'countdown', leftMs: Math.max(0, tidy.countdownSince + TIDY_COUNTDOWN_MS - now), tokens, ...overlay }
  const payback = paybackOf(inputs.model, tokens, tidy.last?.after ?? TIDY_AFTER)

  return { kind: 'offer', tokens, ...overlay, ...(payback === undefined ? {} : { payback }) }
}

/** One run of a band line: its text, and the theme colour, dimness and weight it is drawn in. */
export type BandRun = { text: string; color?: string; dim?: true; bold?: true }

const ACCENT = 'claude'
const GOOD = 'success'
const WARN = 'warning'

/** `412k → 38k (−91%)`, or as much of it as is known. */
const shrinkOf = (tidied: HudTidied): BandRun[] => {
  const { before, after } = tidied
  if (before === undefined || after === undefined) return [{ text: after === undefined ? 'conversation compacted' : `now ${formatTokens(after)} tokens`, dim: true }]
  const cut = before > 0 ? Math.round(((before - after) / before) * 100) : 0

  return [{ text: `${formatTokens(before)} → ${formatTokens(after)}` }, { text: cut > 0 ? ` (−${cut}%)` : '', dim: true }]
}

/** Cents for tidy estimates: zero is exact, a positive fraction of a cent is not. */
export const formatTidyCost = (usd: number): string =>
  !Number.isFinite(usd) || usd <= 0 ? '$0.00' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`

/** Conservative band cells: ambiguous ≈ and · each reserve two columns. */
export const tidyWidth = (text: string): number => displayWidth(text) + (text.match(/[≈·]/g)?.length ?? 0)

export const fitTidyText = (text: string, columns: number): string => {
  let cells = Math.max(0, Math.floor(columns))
  let fitted = truncate(text, cells)
  while (tidyWidth(fitted) > columns && cells > 0) fitted = truncate(text, --cells)

  return fitted
}

export const tidyToggleLabel = (mode: TidyMode): string => mode === 'auto' ? 'Turn auto off' : 'Turn auto on'

/** Non-plain band buttons reserve four chrome cells each, plus the one-cell gaps. */
export const tidyButtonLabels = (kind: 'offer' | 'waiting' | 'countdown', mode: TidyMode, columns: number): string[] => {
  const labels = [...(kind === 'waiting' ? [] : [kind === 'countdown' ? 'Tidy up now' : 'Tidy up']), kind === 'offer' ? 'Not now' : 'Cancel', ...(mode === 'off' ? [] : [tidyToggleLabel(mode)])]
  const width = (): number => labels.reduce((sum, label) => sum + displayWidth(label) + 4, Math.max(0, labels.length - 1))
  if (kind === 'countdown' && width() > columns) labels[0] = 'Tidy up'
  if (width() > columns && labels.at(-1)?.startsWith('Turn auto')) labels.pop()

  return labels
}

/** D2 offers tick until expiry; other offers and waiting tick only for feedback. */
export const bandHasClock = (shown: BandTidy | undefined, now: number): boolean =>
  shown !== undefined && (shown.kind !== 'offer' && shown.kind !== 'waiting' || shown.feedback !== undefined || shown.kind === 'offer' && shown.decision?.rule === 'D2' && (shown.decision.cacheExpiresAt ?? now) > now)

const savingOf = (shown: PendingCopy & { saving?: number }): string => `save ≈${formatTidyCost(shown.decision?.saving ?? shown.saving ?? 0)}`

const offerDetail = (shown: PendingCopy, now: number): string => {
  const decision = shown.decision
  if (decision?.rule === 'D2') return `cold in ${formatLeft(Math.max(0, (decision.cacheExpiresAt ?? now) - now), 'span')}; a cold return costs ${formatTidyCost(decision.costs?.coldCostAtTtl ?? 0)}`
  if (decision?.costs !== undefined) return `if this chat runs as long again · costs ${formatTidyCost(decision.costs.K)}`

  return decision?.why === 'cache' ? 'prompt cache not working here' : 'a summary stands in for the conversation'
}

/** The band's lines for a tidy: at most two rows of runs; the buttons are the hooks'. */
export const bandLinesOf = (shown: BandTidy, now: number, columns = 46): BandRun[][] => {
  const lines = rawBandLinesOf(shown, now)
  const limit = Math.max(0, Math.min(46, columns))

  return lines.map(line => {
    const text = line.map(run => run.text).join('')
    const fitted = fitTidyText(text, limit)
    if (fitted === text) return line
    let left = fitted.endsWith('…') ? fitted.slice(0, -1).length : fitted.length
    const kept: BandRun[] = []
    for (const run of line) {
      if (left <= 0) break
      const text = run.text.slice(0, left)
      left -= text.length
      kept.push({ ...run, text })
    }
    if (fitted.endsWith('…')) {
      const last = kept.at(-1)
      if (last === undefined) kept.push({ ...line[0], text: '…' })
      else last.text += '…'
    }

    return kept
  })
}

const rawBandLinesOf = (shown: BandTidy, now: number): BandRun[][] => {
  switch (shown.kind) {
    case 'tidying':
      return [
        [{ text: 'tidying up', color: ACCENT, bold: true }, { text: `${shown.before === undefined ? '' : ` · ${formatTokens(shown.before)} tokens`} · ${formatSpan(now - shown.since)}`, dim: true }],
        [{ text: 'squashing the conversation into a summary', dim: true }],
      ]
    case 'tidied': {
      const { before, after } = shown.tidied
      const less = before !== undefined && after !== undefined && before > after ? before - after : undefined

      return [
        [{ text: '✓ tidied ', color: GOOD, bold: true }, ...shrinkOf(shown.tidied)],
        [{ text: less === undefined ? 'a summary stands in for the conversation' : `every request from here reads ${formatTokens(less)} tokens less`, dim: true }],
      ]
    }
    case 'toggle':
      return [[{ text: 'auto-tidy', color: ACCENT }], [{ text: printable(shown.reason), dim: true }]]
    case 'failed':
      return [[{ text: 'could not tidy up', color: WARN, bold: true }], [{ text: printable(shown.reason), dim: true }]]
    case 'waiting':
      return [[{ text: `auto-tidy waiting · ${savingOf(shown)}`, color: ACCENT }], [{ text: shown.feedback === undefined ? `for: ${printable(shown.reason)}${(shown.decision?.otherReasons ?? 0) > 0 ? ` (+${shown.decision?.otherReasons} more)` : ''}` : printable(shown.feedback), dim: true }]]
    case 'countdown':
      return [
        [{ text: `auto-tidy in ${formatLeft(shown.leftMs, 'clock')} · ${savingOf(shown)}`, color: ACCENT, bold: true }],
        [{ text: shown.feedback === undefined ? shown.decision?.rule === 'D2' ? "if you're back after it goes cold" : 'if this chat runs as long again' : printable(shown.feedback), dim: true }],
      ]
    case 'offer': {
      const decision = shown.decision
      const head = shown.intro === true ? `auto-tidy is now on · ${savingOf(shown)}`
        : decision?.rule === 'D1' ? `${savingOf(shown)} · tidy up${shown.tokens === undefined ? '' : ` ${formatTokens(shown.tokens)}`}?`
          : decision?.rule === 'D2' ? `${savingOf(shown)} · tidy before the cache cools?`
            : decision?.rule === 'D3' ? `${savingOf(shown)} · tidy the cold cache first?`
              : shown.tokens === undefined ? 'tidy up?' : `${formatTokens(shown.tokens)} tokens · tidy up?`

      return [
        [{ text: head, color: ACCENT, bold: true }],
        [{ text: shown.feedback === undefined ? offerDetail(shown, now) : printable(shown.feedback), dim: true }],
      ]
    }
  }
}
