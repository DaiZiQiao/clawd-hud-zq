// What the pane's documents in pixels share (hooks/scene-svg.ts, the
// scene; hooks/text-svg.ts, the text rows): a cell's size in CSS pixels, the
// font's, the theme keys' colours for a dark and a light page, and how
// numbers and text are written into a document.

/** One cell in CSS pixels: 8 across and 16 down, the terminal's 1:2 cell. */
export const CELL_WIDTH = 8
export const CELL_HEIGHT = 16

/** A glyph's size, and its baseline from its cell's top, so it sits centred in the cell. */
export const FONT_SIZE = 13
export const BASELINE = 12

/** The theme keys the scene draws in, and the foreground and dim text. */
export type ThemeKey = 'claude' | 'success' | 'warning' | 'error' | 'text' | 'inactive'

/**
 * The theme keys as colours: an image reads no theme, so the scene carries
 * Claude Code's dark theme's (the default) and its light theme's, picked by
 * the surface's colour scheme (`prefers-color-scheme`).
 */
export const SCENE_THEMES: Readonly<Record<'dark' | 'light', Readonly<Record<ThemeKey, string>>>> = {
  dark: { claude: '#D77757', success: '#4EBA65', warning: '#FFC107', error: '#FF6B80', text: '#FFFFFF', inactive: '#999999' },
  light: { claude: '#D77757', success: '#2C7A39', warning: '#966C1E', error: '#AB2B3F', text: '#000000', inactive: '#666666' },
}

/** Each theme key's class in the document, for the light scheme's rule. */
export const CLASSES: Readonly<Record<ThemeKey, string>> = { claude: 'a', success: 'g', warning: 'y', error: 'r', text: 'f', inactive: 'd' }

export const isThemeKey = (value: string): value is ThemeKey => value in CLASSES

/** A number for an attribute: at most two decimals, no `-0`. */
export const num = (value: number): string => {
  const rounded = Math.round(value * 100) / 100

  return String(rounded === 0 ? 0 : rounded)
}

export const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The theme keys a drawing uses, as the light scheme's rule: each class's light colour. */
export const lightRule = (used: ReadonlySet<ThemeKey>): string => {
  if (used.size === 0) return ''
  const rules = [...used].sort().map(key => `.${CLASSES[key]}{fill:${SCENE_THEMES.light[key]}}`).join('')

  return `<style>@media (prefers-color-scheme:light){${rules}}</style>`
}
