import type { BoxProps, ElementConstructor, RenderElement, SvgProps } from 'claude-code'

import type { HudElements } from './hud'
import { paint } from './scene-canvas'
import { ACCENT, ASK, DROP, GOOD, HOT, WARN } from './scene-model'
import { mascotPlan } from './scene-plan'
import { sceneAlt, sceneSvg } from './scene-svg'
import type { Cell, MascotLayout, MascotPlan, MascotScene } from './scene-types'

// The painted scene (hooks/scene-canvas.ts) drawn: rows of text runs in the
// contract's keys and raw colours (the terminal, and the smooth scene's
// surface module), or one `Svg` (hooks/scene-svg.ts) where the surface's
// text is no grid; the classic scene's pick Buttons over either.

type Style = { color?: string; dimColor?: boolean; backgroundColor?: string }

/** A cell's style: its ink's colour, and a two-colour cell's background under its glyph. */
export const styleOf = (cell: Cell): Style => (cell.bg === undefined ? inkOf(cell) : { ...inkOf(cell), backgroundColor: cell.bg })

const inkOf = (cell: Cell): Style => {
  switch (cell.ink) {
    case 'b':
      return { color: cell.colour }
    case 'f':
      return {}
    case 'd':
      return { dimColor: true }
    case 'a':
      return { color: ACCENT }
    case 'g':
      return { color: GOOD }
    case 'y':
      return { color: WARN }
    case 'r':
      return { color: HOT }
    case 'p':
      return { color: ASK }
    case 'i':
      return { color: DROP }
    case 'k':
      return { color: cell.colour }
  }
}

type Span = { text: string; style: Style }

const keyOf = (style: Style): string => `${style.color ?? ''}|${style.dimColor === true ? 'd' : ''}|${style.backgroundColor ?? ''}`

/** A row's cells as runs of one style, trailing blanks dropped. */
const spansOf = (row: readonly (Cell | undefined)[]): Span[] => {
  let last = row.length - 1
  while (last >= 0 && row[last] === undefined) last -= 1
  const spans: Span[] = []
  for (let x = 0; x <= last; x += 1) {
    const cell = row[x]
    const style = cell === undefined ? {} : styleOf(cell)
    const text = cell?.ch ?? ' '
    const previous = spans.at(-1)
    if (previous !== undefined && keyOf(previous.style) === keyOf(style)) previous.text += text
    else spans.push({ text, style })
  }

  return spans
}

/** The glyph of an agent's pick Button, between its feet. */
export const PICK_LABEL = '▾'

/** Pressing a mascot: its Button's constructor and what a press selects. */
export type MascotPick = { Button: (props: { key?: string; label?: string; plain?: true; dimColor?: boolean; onPress: () => void }) => RenderElement; onPick: (id: string) => void }

/** A row's runs as one Text cut at the region's edge (a blank for an empty row). */
const spanText = (ui: HudElements, spans: readonly Span[], key?: string): RenderElement => {
  const { Text } = ui

  return (
    <Text key={key} wrap="truncate-end">
      {spans.length === 0
        ? ' '
        : spans.map(span => (span.style.color === undefined && span.style.dimColor !== true && span.style.backgroundColor === undefined ? span.text : <Text {...span.style}>{span.text}</Text>))}
    </Text>
  )
}

/**
 * A canvas drawn as the scene's rows: a column of `rows` keyed Boxes
 * (`mascots:0`, ...), each one row high holding one Text cut to the region
 * (`truncate-end`), the contract keys and raw colours of the cells. What the
 * smooth scene's surface module draws each frame.
 */
export const renderCanvas = (ui: HudElements, grid: readonly (readonly (Cell | undefined)[])[], key = 'mascots'): RenderElement => {
  const { Box } = ui

  return (
    <Box key={key} flexDirection="column" flexShrink={0} height={grid.length}>
      {grid.map((row, index) => (
        <Box key={`mascots:${index}`} height={1} flexShrink={0}>
          {spanText(ui, spansOf(row))}
        </Box>
      ))}
    </Box>
  )
}

/**
 * The scene, drawn under the agent list: a column of rows that sits on the
 * bottom of the rows it is given (`flexGrow`), one keyed Box per row
 * (`mascots:0`, `mascots:1`, ...), each one row high holding one Text cut to
 * `columns` (a row holding pick Buttons splits around them). Undefined when
 * nothing fits: fewer than 4 rows, or fewer columns than the session's slot.
 */
export const renderMascots = (ui: HudElements, scene: MascotScene, layout: MascotLayout, plan?: MascotPlan, pick?: MascotPick): RenderElement | undefined => {
  const painted = paint(scene, layout, plan)
  if (painted === undefined) return undefined
  const { Box } = ui
  const text = (spans: readonly Span[], key?: string) => spanText(ui, spans, key)

  return (
    <Box key="mascots" flexDirection="column" flexShrink={0} flexGrow={1} justifyContent="flex-end">
      {painted.grid.map((row, index) => {
        const picks = pick === undefined ? [] : painted.picks.filter(one => one.row === index).sort((a, b) => a.x - b.x)
        if (picks.length === 0 || pick === undefined) {
          return (
            <Box key={`mascots:${index}`} height={1} flexShrink={0}>
              {text(spansOf(row))}
            </Box>
          )
        }
        // Text up to each pick, the pick's one-cell Button, and the rest after the last.
        const parts: RenderElement[] = []
        let from = 0
        for (const one of picks) {
          if (one.x < from) continue
          const before = spansOf(row.slice(from, one.x).map(cell => cell ?? { ch: ' ', ink: 'f' as const, colour: ACCENT }))
          if (before.length > 0) parts.push(text(before, `mascots:${index}:${from}`))
          parts.push(pick.Button({ key: `pick:${one.id}`, label: PICK_LABEL, plain: true, dimColor: true, onPress: () => pick.onPick(one.id) }))
          from = one.x + 1
        }
        const after = spansOf(row.slice(from))
        if (after.length > 0) parts.push(text(after, `mascots:${index}:${from}`))

        return (
          <Box key={`mascots:${index}`} height={1} flexShrink={0}>
            {parts}
          </Box>
        )
      })}
    </Box>
  )
}

/** What the scene in pixels draws with: a Box, and the surface's `Svg`. */
export type SvgElements = { Box: ElementConstructor<BoxProps>; Svg: ElementConstructor<SvgProps> }

/**
 * The classic scene where the surface's text is no grid (the desktop): the
 * same frame as `renderMascots` as one `Svg` (hooks/scene-svg.ts), sitting
 * on the bottom of its rows, as many rows high as the text scene and the
 * room's columns wide; each agent's pick a one-cell Button laid over the cell
 * between its feet. Undefined when nothing fits.
 */
export const renderMascotsSvg = (ui: SvgElements, scene: MascotScene, layout: MascotLayout, plan = mascotPlan(scene, layout), pick?: MascotPick): RenderElement | undefined => {
  const painted = paint(scene, layout, plan)
  if (painted === undefined || plan === undefined) return undefined
  const { Box, Svg } = ui
  const rows = painted.grid.length
  const drawn = sceneSvg(painted.layers, { columns: plan.columns, rows }, sceneAlt(scene, painted.layers, plan.collapsed.length))

  return (
    <Box key="mascots" flexDirection="column" flexShrink={0} flexGrow={1} justifyContent="flex-end">
      <Box height={rows} width={plan.columns} flexShrink={0}>
        <Svg source={drawn.source} alt={drawn.alt} width={drawn.width} height={drawn.height} />
        {pick === undefined
          ? []
          : painted.picks.map(one => (
            <Box position="absolute" top={one.row} left={one.x} width={1} height={1}>
              {pick.Button({ key: `pick:${one.id}`, label: PICK_LABEL, plain: true, dimColor: true, onPress: () => pick.onPick(one.id) })}
            </Box>
          ))}
      </Box>
    </Box>
  )
}
