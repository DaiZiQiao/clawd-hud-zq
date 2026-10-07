import type { HudSelection, HudTab } from '../types'
import { TAB_LABELS } from './inspect'
import type { InspectAction, InspectHeader, InspectRow } from './inspect'
import { colourFor } from './scene-model'
import type { MascotScene } from './scene-types'
import { displayWidth, truncate } from './text-width'
import { whoOfAgent, whoOfMain } from './tv-figure'
import type { Who } from './tv-figure'
import type { TvCell, TvRow, TvSpan } from './tv-model'

// What the hooks hand the TV to show (hooks/tv-model.ts): the inspect view's
// header and tabs as the glass's pinned rows, its tab's rows as the rows that
// scroll, and who is in the TV. Each press on the glass keeps what it runs in
// the hooks, by its key, for the TV's post to name.

/** The channel's number on the glass takes the title row's last cells: `CH 2` and a blank. */
export const OSD_ROOM = 5

/** Spans cut to `width` cells, the cut one ending in `…`. */
const cut = (spans: readonly TvSpan[], width: number): TvSpan[] => {
  const kept: TvSpan[] = []
  let used = 0
  for (const span of spans) {
    const cells = displayWidth(span.text)
    if (used + cells <= width) {
      kept.push(span)
      used += cells
      continue
    }
    const text = truncate(span.text, Math.max(0, width - used))
    if (text !== '') kept.push({ ...span, text })
    break
  }

  return kept
}

/**
 * The glass's pinned rows: the title (the glyph, the name in its colour and
 * the facts dim, one row, clear of the channel's number), the tabs (the one
 * shown `[ Trail ]`, the rest dim; each presses its tab), and a blank row.
 */
export const tvHeadOf = (header: InspectHeader, tabs: readonly HudTab[], active: HudTab, content: number): TvRow[] => {
  const facts = header.facts.filter(one => one !== '').join(' · ')
  const title: TvSpan[] = [
    { text: `${header.glyph} `, color: header.glyphColour },
    { text: header.name, bold: true, ...(header.colour === undefined ? {} : { color: header.colour }) },
    ...(facts === '' ? [] : [{ text: ` · ${facts}`, dim: true as const }]),
  ]
  const tabCells = tabs.flatMap((tab, index): TvCell[] => {
    const isActive = tab === active
    const press: TvCell = { press: `tab:${tab}`, label: TAB_LABELS[tab], ...(isActive ? { primary: true as const } : { dim: true as const }) }

    return index === tabs.length - 1 ? [press] : [press, { text: isActive ? '  ' : '   ' }]
  })

  return [
    { key: 'title', cells: cut(title, Math.max(1, content - OSD_ROOM)) },
    { key: 'tabs', cells: tabCells },
    { key: 'gap', cells: [] },
  ]
}

/** An inspect row as the glass's: its parts as spans, its Buttons as presses running `onAction` with their action. */
export const tvRowOfInspect = (row: InspectRow, onAction: (action: InspectAction) => void, presses: Map<string, () => void>): TvRow => ({
  key: row.key,
  cells: row.cells.map((cell): TvCell => {
    if ('button' in cell) {
      const { key, label, primary, dimColor, cover, action } = cell.button
      presses.set(key, () => onAction(action))

      return { press: key, label, ...(primary === true ? { primary: true as const } : {}), ...(dimColor === true ? { dim: true as const } : {}), ...(cover === undefined ? {} : { cover }) }
    }

    return {
      text: cell.text,
      ...(cell.color === undefined ? {} : { color: cell.color }),
      ...(cell.bold === true ? { bold: true as const } : {}),
      ...(cell.dimColor === true ? { dim: true as const } : {}),
      ...(cell.italic === true ? { italic: true as const } : {}),
    }
  }),
})

/** The characters the glass's rows may take in the TV's props, which a tree bounds (100,000 serialized): the rest for the layout, who and the drawing. */
export const TV_ROWS_BUDGET = 60_000

/**
 * The tab's rows kept within TV_ROWS_BUDGET with the head: the oldest
 * dropped first (a trail's and a conversation's newest are last), one kept
 * whatever its size.
 */
export const budgeted = (head: readonly TvRow[], body: readonly TvRow[]): TvRow[] => {
  const sizes = body.map(row => JSON.stringify(row).length)
  let total = JSON.stringify(head).length + sizes.reduce((sum, one) => sum + one, 0)
  let from = 0
  while (total > TV_ROWS_BUDGET && from < body.length - 1) {
    total -= sizes[from] ?? 0
    from += 1
  }

  return from === 0 ? [...body] : body.slice(from)
}

/** Who is in the TV: the session's mascot, or the agent's (its colour and what it wears, as the scene has it). */
export const tvWhoOf = (choice: HudSelection, scene: MascotScene | undefined, character: 'clawd' | 'usagi'): Who => {
  if (choice.kind === 'main') return whoOfMain(character)
  const agent = scene?.agents.find(one => one.id === choice.id)

  return agent === undefined ? { character, colour: character === 'usagi' ? whoOfMain(character).colour : colourFor(choice.id) } : whoOfAgent(agent, character)
}
