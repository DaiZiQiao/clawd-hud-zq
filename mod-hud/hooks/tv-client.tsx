import type { ClientElements, ClientModule, ElementConstructor, JsonValue, RenderElement, SvgProps } from 'claude-code'

import type { TvInputs } from './tv-model'
import { TV_FRAME_MS } from './tv-model'
import { paintCells, paintSvg, tvAlt } from './tv-paint'
import type { TvOut } from './tv-paint'
import { createTv, keyTv, lookOf, osdOf, pointerTv, receiveTv, tickTv } from './tv-world'
import type { TvWorld } from './tv-world'

// The TV as a `Client` surface module: over the whole pane while an agent (or
// the session) is inspected, on its own frame clock. It takes every press in
// the pane: on the TV its controls, the glass's presses, the ✕; anywhere else
// it closes. The hooks hand it the rows to show (`TvInputs`) on each of their
// redraws and hear from it a channel, a press or, once it has played its
// closing out, the close.

type State = { tv: TvWorld; frame: number }

/** What the module draws with: its table's Box and Text, and `Svg` where the table has it. */
export type TvElements = Pick<ClientElements, 'Box' | 'Text'> & { Svg?: ElementConstructor<SvgProps> }

const svgOf = (elements: TvElements): ElementConstructor<SvgProps> => elements.Svg ?? (props => h('Svg', props) as RenderElement)

type Look = { color?: string; backgroundColor?: string; bold?: boolean; dimColor?: boolean; italic?: boolean; strikethrough?: boolean }

const lookOfCell = (cell: Exclude<TvOut, { tail: true }>): Look => ({
  ...(cell.color === undefined ? {} : { color: cell.color }),
  ...(cell.bg === undefined ? {} : { backgroundColor: cell.bg }),
  ...(cell.bold === true ? { bold: true } : {}),
  ...(cell.dim === true ? { dimColor: true } : {}),
  ...(cell.italic === true ? { italic: true } : {}),
  ...(cell.strike === true ? { strikethrough: true } : {}),
})

/** A row's runs of cells the TV draws: where each starts, its cells across, and its spans of one look. */
export const runsOf = (row: readonly (TvOut | undefined)[]): { x: number; width: number; spans: { text: string; look: Look }[] }[] => {
  const runs: { x: number; width: number; spans: { text: string; look: Look }[] }[] = []
  let current: (typeof runs)[number] | undefined
  row.forEach((cell, x) => {
    if (cell === undefined) {
      current = undefined
      return
    }
    if (current === undefined) {
      current = { x, width: 0, spans: [] }
      runs.push(current)
    }
    current.width += 1
    if ('tail' in cell) return
    const look = lookOfCell(cell)
    const last = current.spans.at(-1)
    if (last !== undefined && JSON.stringify(last.look) === JSON.stringify(look)) last.text += cell.ch
    else current.spans.push({ text: cell.ch, look })
  })

  return runs
}

/**
 * A frame drawn: on the terminal each run of the TV's cells in an absolute
 * Box over the pane (the rest of the region drawn nothing, so the pane shows
 * through); on the desktop one `Svg` the region's size and over it a box as
 * big with nothing in it, which the press lands on (an `Svg` is an image).
 */
export const drawTv = (tv: TvWorld, elements: TvElements): RenderElement => {
  const { Box, Text } = elements
  const { inputs } = tv
  const look = lookOf(tv)
  if (inputs.svg === true || elements.Svg !== undefined) {
    const Svg = svgOf(elements)
    const drawn = paintSvg(inputs, look, tv.scroll, tv.sprite, osdOf(tv), tv.ms)

    return (
      <Box key="tv" width={inputs.columns} height={inputs.rows} flexShrink={0}>
        <Svg source={drawn.source} alt={tvAlt(inputs, look)} width={drawn.width} height={drawn.height} />
        <Box position="absolute" top={0} left={0} width={inputs.columns} height={inputs.rows} />
      </Box>
    )
  }
  const grid = paintCells(inputs, look, tv.scroll, tv.sprite, osdOf(tv))

  return (
    <Box key="tv" width={inputs.columns} height={inputs.rows} flexShrink={0}>
      {grid.flatMap((row, y) => runsOf(row).map(run => (
        <Box key={`tv:${y}:${run.x}`} position="absolute" top={y} left={run.x} width={run.width} height={1}>
          <Text wrap="truncate-end">
            {run.spans.map(span => (Object.keys(span.look).length === 0 ? span.text : <Text {...span.look}>{span.text}</Text>))}
          </Text>
        </Box>
      )))}
    </Box>
  )
}

/** The surface module: the TV on its own frame clock, the person's presses and keys, a post when a channel, a press or the close is the hooks'. */
const TvClient: ClientModule<JsonValue, State> = (props, surface) => {
  const inputs = props as unknown as TvInputs
  let state = surface.state
  if (state === undefined) {
    state = { tv: createTv(inputs), frame: 0 }
    const post = (data: JsonValue): void => surface.post(data)
    const redraw = (held: State): void => surface.setState({ ...held, frame: held.frame + 1 })
    surface.onPointer(event => {
      const held = surface.state
      if (held !== undefined && pointerTv(held.tv, event, post)) redraw(held)
    })
    surface.onKey(event => {
      const held = surface.state
      if (held !== undefined && keyTv(held.tv, event, post)) redraw(held)
    })
    surface.every(TV_FRAME_MS, () => {
      const held = surface.state
      if (held !== undefined && tickTv(held.tv, post)) redraw(held)
    })
    surface.setState(state)
  }
  receiveTv(state.tv, inputs)

  return drawTv(state.tv, surface.elements)
}

export default TvClient
