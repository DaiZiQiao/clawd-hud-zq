import { shortModel } from './facts'

/** First-party list prices, USD per million tokens. */
export type Prices = { input: number; write5m: number; write1h: number; read: number; output: number }

export type TieredPrices = { above: number; low: Prices; high: Prices }

const price = (input: number, output: number, read: number): Prices => ({ input, write5m: input * 1.25, write1h: input * 2, read, output })

// Opus 5.5, Sonnet 5.5, Fable 5.1 and Haiku 5.5 verified 2026-10-12;
// the other models keep the ledger's estimates. A gateway, partner cloud, fast
// mode or discount can price differently; the session's costUsd stays its real total.
export const PRICES: Readonly<Record<string, Prices | TieredPrices>> = {
  'fable-5-1': price(10, 50, 0.25),
  'fable-5': price(10, 50, 1),
  'mythos-5-1': price(10, 50, 0.25),
  'opus-5-5': price(4, 20, 0.2),
  'opus-5': price(5, 25, 0.5),
  'opus-4-8': price(5, 25, 0.5),
  'opus-4-7': price(5, 25, 0.5),
  'opus-4-6': price(5, 25, 0.5),
  'opus-4-5': price(5, 25, 0.5),
  'sonnet-5-5': price(2, 10, 0.1),
  'sonnet-5': price(2, 10, 0.2),
  'sonnet-4-6': price(3, 15, 0.3),
  'sonnet-4-5': price(3, 15, 0.3),
  'sonnet-4': price(3, 15, 0.3),
  '3-7-sonnet': price(3, 15, 0.3),
  'opus-4-1': price(15, 75, 1.5),
  'haiku-4-5': price(1, 5, 0.1),
  'haiku-5-5': { above: 100_000, low: price(0.1, 0.5, 0.01), high: price(0.5, 2.5, 0.05) },
}

/** The whole request's tier; without a prompt size, tiered models stay unpriced. */
export const pricesAt = (model: string | undefined, promptTokens?: number): Prices | undefined => {
  const id = shortModel(model)
  const rate = id === undefined || !Object.hasOwn(PRICES, id) ? undefined : PRICES[id]
  if (rate === undefined || !('above' in rate)) return rate
  if (promptTokens === undefined || !Number.isFinite(promptTokens) || promptTokens < 0) return undefined

  return promptTokens > rate.above ? rate.high : rate.low
}
