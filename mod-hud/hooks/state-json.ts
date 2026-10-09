// What the facts (hooks/facts.ts), the workflow agents' record
// (hooks/agent-shadows.ts) and the smooth scene's props (hooks/scene-model.ts)
// share to stay JSON, and the HUD and the scene to read it back, in a module
// of its own: the smooth scene's surface module imports it, and nothing else
// with it.

// State is JSON: leave a key out rather than hold `undefined` under it.
export const defined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, one]) => one !== undefined)) as T

/** A number read back from state: a finite one, not NaN or a string. */
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
