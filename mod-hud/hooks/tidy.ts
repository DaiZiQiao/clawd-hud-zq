import type { HudMainFacts, HudTidied, HudTidyFacts } from '../types'
import { formatLeft, formatSpan, formatTokens } from './hud'
import { priceOf } from './hud-ledger'
import { TIDY_STALE_MS } from './scene-phases'

// Tidying up: compacting the main conversation once its context has grown
// past the `tidyAt` option, offered in the band above the prompt (`ask`),
// counted down and started there (`auto`), or never (`off`); and what the band
// says while any compaction of the main conversation runs and after it. Pure
// functions of the facts and the time: the hooks (hooks/register.tsx) write
// the facts and draw the lines.

export type TidyMode = 'ask' | 'auto' | 'off'

/** What the summary is told to keep, as typed after `/compact`. */
export const TIDY_INSTRUCTIONS = 'Keep the task in progress and its plan, the todo list with each item\'s status, the decisions made and why, open questions, and the files being worked on with what is left to do in each.'

/** Never offered below this many tokens, whatever `tidyAt` says: there is too little to save. */
export const TIDY_MIN = 40_000
/** Not now: offered again once the context holds this many tokens more. */
export const TIDY_AGAIN = 50_000
/** `auto`: the band counts down this long after a main turn ends before it tidies up. */
export const TIDY_COUNTDOWN_MS = 10_000
/** The result (or a failure) stays in the band this long. */
export const TIDY_RESULT_MS = 20_000
/** The summary the compaction writes, in tokens, for the estimate. */
export const TIDY_SUMMARY = 12_000
/** The context after a compaction, in tokens, for the estimate until one has been seen. */
export const TIDY_AFTER = 30_000

/** What the band shows of tidying, if anything. */
export type BandTidy =
  | { kind: 'tidying'; since: number; before?: number }
  | { kind: 'tidied'; tidied: HudTidied }
  | { kind: 'failed'; reason: string }
  | { kind: 'countdown'; leftMs: number; tokens: number }
  | { kind: 'offer'; tokens: number; payback?: number }

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
}

/** A compaction of the main conversation running now (and not left over from a reload mid-way). */
export const isTidying = (tidy: HudTidyFacts, now: number): boolean =>
  tidy.runningSince !== undefined && now - tidy.runningSince >= 0 && now - tidy.runningSince < TIDY_STALE_MS

/**
 * Whether the context is due a tidy: the option on, the context past
 * `tidyAt` (and TIDY_MIN), the main loop idle and not compacting, and not
 * put off by Not now within TIDY_AGAIN tokens.
 */
export const isTidyDue = ({ mode, at, tokens, main, tidy, now }: TidyInputs): boolean =>
  mode !== 'off'
  && tokens !== undefined
  && tokens >= Math.max(at, TIDY_MIN)
  && main.busySince === undefined
  && !isTidying(tidy, now)
  && (tidy.dismissedAt === undefined || tokens >= tidy.dismissedAt + TIDY_AGAIN)

/**
 * After how many main requests a tidy pays for itself, at the model's list
 * prices: what it costs once (the summarizer reading the context from the
 * cache, writing its summary, the next request caching what is left) over what
 * every request after it saves (reading that much less from the cache).
 * Undefined for a model with no price, or nothing to save.
 */
export const paybackOf = (model: string | undefined, tokens: number, after: number): number | undefined => {
  const rate = model === undefined ? undefined : priceOf(model)
  const saved = (tokens - after) * (rate?.cacheRead ?? 0)
  if (rate === undefined || !(saved > 0)) return undefined
  const cost = tokens * rate.cacheRead + TIDY_SUMMARY * rate.output + after * rate.cacheWrite

  return Math.max(1, Math.ceil(cost / saved))
}

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
  if (!isTidyDue(inputs)) return undefined
  const tokens = inputs.tokens as number
  if (inputs.mode === 'auto' && tidy.countdownSince !== undefined) return { kind: 'countdown', leftMs: Math.max(0, tidy.countdownSince + TIDY_COUNTDOWN_MS - now), tokens }
  const payback = paybackOf(inputs.model, tokens, tidy.last?.after ?? TIDY_AFTER)

  return { kind: 'offer', tokens, ...(payback === undefined ? {} : { payback }) }
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

/** The band's lines for a tidy: at most two rows of runs; the buttons are the hooks'. */
export const bandLinesOf = (shown: BandTidy, now: number): BandRun[][] => {
  switch (shown.kind) {
    case 'tidying':
      return [
        [{ text: 'tidying up', color: ACCENT, bold: true }, { text: shown.before === undefined ? '' : ` · ${formatTokens(shown.before)} tokens`, dim: true }],
        [{ text: `squashing the conversation into a summary · ${formatSpan(now - shown.since)}`, dim: true }],
      ]
    case 'tidied': {
      const { before, after } = shown.tidied
      const less = before !== undefined && after !== undefined && before > after ? before - after : undefined

      return [
        [{ text: '✓ tidied ', color: GOOD, bold: true }, ...shrinkOf(shown.tidied)],
        [{ text: less === undefined ? 'a summary stands in for the conversation' : `every request from here reads ${formatTokens(less)} tokens less`, dim: true }],
      ]
    }
    case 'failed':
      return [[{ text: 'could not tidy up', color: WARN, bold: true }], [{ text: shown.reason, dim: true }]]
    case 'countdown':
      return [
        [{ text: `tidying up in ${formatLeft(shown.leftMs)}`, color: ACCENT, bold: true }, { text: ` · ${formatTokens(shown.tokens)} tokens`, dim: true }],
        [{ text: 'the conversation becomes a summary; the todos and the plan stay', dim: true }],
      ]
    case 'offer':
      return [
        [{ text: `${formatTokens(shown.tokens)} tokens of context · tidy up?`, color: ACCENT, bold: true }],
        [{ text: shown.payback === undefined ? 'a summary stands in for the conversation' : `pays for itself in ~${shown.payback} requests`, dim: true }],
      ]
  }
}
