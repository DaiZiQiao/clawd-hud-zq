import type { BoxProps, ElementConstructor, ImageProps, RasterProps, RenderElement, TextProps } from 'claude-code'

import { COMPACT_SEPARATOR, SWATCH_COLUMNS } from './strip-layout'
import type { CompactItem, Layout, PlacedTile } from './strip-layout'

// The strip's elements, from a layout (hooks/strip-layout.ts) and what each
// tile draws. Pure: the hooks module builds the drawables from the decoded
// pictures and hands this the terminal's element table. Every size here is
// the layout's, so a tree never asks for more rows or columns than the band
// gave; a tile with no picture is a framed box of the same size, so the row
// keeps its shape while pictures arrive.

/** The terminal elements the strip draws with. */
export type StripElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Raster: ElementConstructor<RasterProps>
  Image: ElementConstructor<ImageProps>
}

/**
 * What one tile draws: half-block `cells` (a Raster), an `image` (kitty
 * pixels, with the words drawn where the terminal cannot), `wait` while its
 * picture is on its way, or a framed `note` (a reason; dashed for a chip that
 * is not attached).
 */
export type TileDrawable =
  | { kind: 'cells'; cells: string }
  | { kind: 'image'; source: { rgba: string; width: number; height: number }; alt: string }
  | { kind: 'wait' }
  | { kind: 'note'; lines: readonly string[]; dashed: boolean }

/** Keys the tests and the blit probe find elements by. */
export const pictureKeyOf = (id: number): string => `img:${id}`
export const swatchKeyOf = (id: number): string => `swatch:${id}`

// A note's lines, cut to the frame's inside; the frame needs two columns and two rows.
const noteLinesOf = (lines: readonly string[], columns: number, rows: number): string[] => {
  const width = Math.max(0, columns - 2)
  const room = Math.max(0, rows - 2)

  return lines.slice(0, room).map(line => (line.length <= width ? line : width <= 1 ? line.slice(0, width) : `${line.slice(0, width - 1)}…`))
}

const tileOf = (ui: StripElements, tile: PlacedTile, drawable: TileDrawable): RenderElement => {
  const { Box, Text, Raster, Image } = ui
  const key = pictureKeyOf(tile.id)
  if (drawable.kind === 'cells') return <Raster key={key} columns={tile.columns} rows={tile.rows} cells={drawable.cells} />
  if (drawable.kind === 'image') {
    // Fixed box: where the terminal draws the alt instead, it is one line, and the row keeps its shape.
    return (
      <Box key={`images:box:${tile.id}`} width={tile.columns} height={tile.rows} flexShrink={0}>
        <Image key={key} source={drawable.source} columns={tile.columns} rows={tile.rows} alt={drawable.alt} />
      </Box>
    )
  }
  const lines = drawable.kind === 'wait' ? ['…'] : noteLinesOf(drawable.lines, tile.columns, tile.rows)

  return (
    <Box
      key={`images:note:${tile.id}`}
      width={tile.columns}
      height={tile.rows}
      flexShrink={0}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      borderStyle={drawable.kind === 'note' && drawable.dashed ? 'dashed' : 'round'}
      borderDimColor
    >
      {lines.map(line => <Text dimColor wrap="truncate-end">{line}</Text>)}
    </Box>
  )
}

const labelOf = (ui: StripElements, tile: PlacedTile): RenderElement => {
  const { Box, Text } = ui

  return (
    <Box key={`images:label:${tile.id}`} width={tile.columns} flexShrink={0}>
      <Text wrap="truncate-end">
        <Text bold>{tile.label}</Text>
        {tile.detail !== undefined && <Text dimColor>{` ${tile.detail}`}</Text>}
      </Text>
    </Box>
  )
}

// One row: each item its swatch (two cells, then a blank), its bold label and
// dim detail; items, and the overflow note, apart by ` · ` (hooks/strip-layout.ts
// sized the row to exactly this).
const compactOf = (ui: StripElements, items: readonly CompactItem[], overflow: string | undefined, swatchOf: (id: number) => string | undefined): RenderElement => {
  const { Box, Text, Raster } = ui
  const parts: RenderElement[] = []
  items.forEach((item, at) => {
    if (at > 0) parts.push(<Text dimColor>{COMPACT_SEPARATOR}</Text>)
    const cells = item.swatch ? swatchOf(item.id) : undefined
    parts.push(
      <Box key={`images:item:${item.id}`} flexDirection="row" flexShrink={0}>
        {cells !== undefined && <Raster key={swatchKeyOf(item.id)} columns={SWATCH_COLUMNS} rows={1} cells={cells} />}
        <Text wrap="truncate-end">
          {cells !== undefined && ' '}
          <Text bold>{item.label}</Text>
          {item.detail !== undefined && <Text dimColor>{` ${item.detail}`}</Text>}
        </Text>
      </Box>,
    )
  })
  if (overflow !== undefined) parts.push(<Text dimColor wrap="truncate-end">{`${items.length > 0 ? COMPACT_SEPARATOR : ''}${overflow}`}</Text>)

  return (
    <Box key="images:compact" flexDirection="row" flexWrap="nowrap" height={1} overflow="hidden">
      {parts}
    </Box>
  )
}

/**
 * The strip for a layout that draws: a row of tiles over a row of labels, one
 * compact row, or one line of text. `drawableOf` says what each placed tile
 * draws; `swatchOf` gives a ready picture's 2 x 1 cell swatch for the compact row.
 */
export const renderStrip = (
  ui: StripElements,
  layout: Exclude<Layout, { kind: 'none' }>,
  drawableOf: (tile: PlacedTile) => TileDrawable,
  swatchOf: (id: number) => string | undefined,
): RenderElement => {
  const { Box, Text } = ui
  if (layout.kind === 'text') {
    return (
      <Box key="images:text">
        <Text wrap="truncate-end">{layout.line}</Text>
      </Box>
    )
  }
  if (layout.kind === 'compact') return compactOf(ui, layout.items, layout.overflow, swatchOf)

  return (
    <Box key="images:strip" flexDirection="column" flexShrink={0}>
      <Box key="images:tiles" flexDirection="row" columnGap={1} height={layout.rows}>
        {layout.tiles.map(tile => tileOf(ui, tile, drawableOf(tile)))}
      </Box>
      <Box key="images:labels" flexDirection="row" columnGap={1} height={1}>
        {layout.tiles.map(tile => labelOf(ui, tile))}
        {layout.overflow !== undefined && <Text dimColor wrap="truncate-end">{layout.overflow}</Text>}
      </Box>
    </Box>
  )
}
