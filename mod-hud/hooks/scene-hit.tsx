import type { ClientModule, JsonValue } from 'claude-code'

import type { HitEvent } from './scene-image'

// The pointer's layer over the vector scene's picture in a terminal
// (hooks/scene-image.ts): a `Client` drawing nothing, the region's size, so
// the picture shows through it; each pointer event over it numbered and
// posted with the ones before it, since a post may give way to a later one
// before the hooks hear it. Its own name, so the hooks tell it from one
// mounted afresh.

type Props = { columns: number; rows: number }

type State = { layer: string; seq: number; recent: HitEvent[] }

/** The events each post carries: enough for a press, a drag's moves and the release between two of the hooks' hearings. */
const RECENT = 32

const SceneHit: ClientModule<JsonValue, State> = (props, surface) => {
  const { columns, rows } = props as Props
  if (surface.state === undefined) {
    const state: State = { layer: Math.random().toString(36).slice(2, 10), seq: 0, recent: [] }
    surface.onPointer(event => {
      // Kept in place, not set: the drawing never changes.
      state.seq += 1
      state.recent = [...state.recent, { ...event, seq: state.seq }].slice(-RECENT)
      surface.post({ layer: state.layer, hits: state.recent } as unknown as JsonValue)
    })
    surface.setState(state)
  }
  const { Box } = surface.elements

  return <Box key="hit" width={columns} height={rows} />
}

export default SceneHit
