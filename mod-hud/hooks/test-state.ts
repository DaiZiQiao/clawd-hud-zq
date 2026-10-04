import type { On } from 'claude-code'

// `$.state` as a session answers it, for the tests that draw the pane: each
// key's value and version in memory, a write a compare-and-set on the version.
// A test that delays or refuses writes keeps its own.

/** What a test's `$.state` holds: each key's value and its version. */
export type Held = Map<string, { value: unknown; version: number }>

/** Answers `state.get` and `state.set` from `held`, listing each key written in `writes` and, given `reads`, each key read. */
export const stateCells = (on: On, held: Held, writes: string[], reads?: string[]): void => {
  on('state.get', (_$, e) => {
    reads?.push(e.key)

    return { value: held.get(e.key) ?? { value: undefined, version: 0 } }
  })
  on('state.set', (_$, e) => {
    const version = held.get(e.key)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false as const, version } }
    writes.push(e.key)
    held.set(e.key, { value: e.value, version: version + 1 })

    return { value: { isSet: true as const, version: version + 1 } }
  })
}
