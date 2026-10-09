import type { PluginOptions } from 'claude-code'

// The mod's options (`userConfig` in plugin.json) as the hooks use them: how
// tall the thumbnails may get, a whole number of rows from 3 to 20, and how
// the pictures are drawn. A value Claude Code would not store (out of range,
// not a number, not one of the choices) falls back rather than failing the
// load.

/**
 * How the strip draws: `auto`, real pixels where the terminal draws them,
 * half-block cells elsewhere, one line of text for a screen reader or
 * NO_COLOR; `blocks`, always half-block cells; `text`, one line naming the
 * images.
 */
export type Pictures = 'auto' | 'blocks' | 'text'

export type ImagesSettings = {
  /** The tallest the thumbnails get, in rows; the strip shrinks below it to fit the room above the prompt. */
  height: number
  pictures: Pictures
}

/** Thumbnail rows when the option is left as it is. */
export const HEIGHT_DEFAULT = 8
/** Fewer rows than this and a thumbnail no longer reads as a picture. */
export const HEIGHT_MIN = 3
export const HEIGHT_MAX = 20

/** The options as the hooks use them: `height` rounded and kept within 3..20, an unknown `pictures` read as `auto`. */
export const settingsOf = (options: PluginOptions): ImagesSettings => ({
  height: typeof options.height === 'number' && Number.isFinite(options.height)
    ? Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Math.round(options.height)))
    : HEIGHT_DEFAULT,
  pictures: options.pictures === 'blocks' || options.pictures === 'text' ? options.pictures : 'auto',
})
