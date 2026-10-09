import type { ImagesTile } from '../types'
import { FORMAT_NAMES } from './image-types'
import { NO_PICTURES } from './images-mode'
import type { ColourChoice, ModeChoice } from './images-mode'
import type { ImagesSettings } from './images-options'

// What `/mod-images` prints: what the plugin sees, one fact a line, so the
// person can tell at a glance why a strip looks the way it does (or is not
// there) in a terminal nobody could test it in. Pure: the hooks module
// gathers the facts. The command runs with the draft emptied, so the strip it
// reports is the last one drawn, never the draft's.

/** Where Claude Code keeps this session's pasted images, as far as the plugin found. */
export type ReportStore =
  | { kind: 'off'; reason: string }
  | { kind: 'found'; dir: string; files: number }
  | { kind: 'not-found'; tried: readonly string[]; doubt?: string }
  | { kind: 'unknown' }

/** The band's room and the thumbnails' height when the strip was last drawn. */
export type ReportBand = {
  /** The rows the strip could take: the band's, at most half the screen less the prompt. */
  maxRows: number
  bodyColumns: number
  viewportRows?: number
  viewportColumns?: number
  isFullscreen?: boolean
  /** Thumbnail rows in that drawing; absent when it was one line, or none. */
  rows?: number
  /** What it was drawn as: thumbnails, one compact row, a line of text, or nothing for want of room. */
  shape?: 'strip' | 'compact' | 'text' | 'none'
}

export type ReportFacts = {
  /** mod-images' own version, from its plugin.json. */
  version?: string
  /** Claude Code's version (`$.session.version()`). */
  claudeVersion?: string
  /** The session draws in a terminal and a person is at the prompt. */
  active: boolean
  mode: ModeChoice
  /** A pixels guess that a blit has confirmed. */
  confirmed: boolean
  colour: ColourChoice
  store: ReportStore
  /** The last strip drawn: how long ago and its tiles. */
  lastStrip?: { ageMs: number; tiles: readonly ImagesTile[] }
  band?: ReportBand
  settings: ImagesSettings
  pasteKeys: string
}

/** The version this code was written against and checked with. */
const VERIFIED_WITH = '2.1.295'

/** `40 s`, `3 min`, `2 h`: how long ago, roughly. */
export const formatAge = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 90) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min`

  return `${Math.round(minutes / 60)} h`
}

/** `#1 PNG 1920x1080 shown`, `#3 WebP: no preview`, `#4 not attached`. */
export const formatTile = (tile: ImagesTile): string => {
  const name = tile.format === undefined ? '' : ` ${FORMAT_NAMES[tile.format] ?? tile.format}`
  const size = tile.width === undefined || tile.height === undefined ? '' : ` ${tile.width}x${tile.height}`
  const what = tile.state === 'ready'
    ? ' shown'
    : tile.state === 'not-attached'
      ? ' not attached'
      : tile.state === 'failed'
        ? `: ${tile.reason ?? 'no preview'}`
        : ' still reading'

  return `#${tile.id}${name}${size}${what}`
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

// How the pictures draw; for half-blocks, the colours, then why not pixels
// where there is more to it than a terminal that draws none.
const pictureLines = (facts: ReportFacts): string[] => {
  const { mode, why } = facts.mode
  if (mode === 'text') return [`Pictures: one line of text (${why}).`]
  if (mode === 'pixels') return [`Pictures: real pixels (${why}, ${facts.confirmed ? 'confirmed by the terminal' : 'not yet confirmed'}).`]
  const colours = facts.colour.level === '256' ? '256 colours' : facts.colour.level === 'full' ? 'full colour' : 'colours as the terminal allows'

  return [`Pictures: half-block cells in ${colours} (${facts.colour.why}).`, ...(why === NO_PICTURES ? [] : [`  ${capitalised(why)}.`])]
}

const storeLines = (store: ReportStore): string[] => {
  if (store.kind === 'off') return [`Image folder: none (${store.reason}): thumbnails cannot be read in this session.`]
  if (store.kind === 'found') return [`Image folder: ${store.dir} (found, ${store.files} ${store.files === 1 ? 'image' : 'images'} this session).`]
  if (store.kind === 'not-found') {
    return [
      store.doubt === undefined
        ? 'Image folder: not found yet. It appears with the first image pasted in this session.'
        : `Image folder: not found (${store.doubt}): tiles read no preview.`,
      ...(store.tried.length === 0 ? [] : [`  Looked in: ${store.tried.join(', ')}`]),
    ]
  }

  return ['Image folder: not looked for yet (it is found at the first paste).']
}

const roomLine = (band: ReportBand): string => {
  const size = band.viewportColumns === undefined || band.viewportRows === undefined ? '' : ` (${band.viewportColumns}x${band.viewportRows}${band.isFullscreen === true ? ', fullscreen' : ''})`
  const rows = band.rows !== undefined
    ? `thumbnails were ${band.rows} rows`
    : band.shape === 'none' ? 'no room for the strip' : band.shape === 'text' ? 'the strip was one line of text' : 'the strip was one line'

  return `Room: ${band.maxRows} rows above the prompt, ${band.bodyColumns} columns${size}; ${rows}.`
}

// One fact a line, the most telling first; tips only where they apply. Claude
// Code puts the plugin's name before a command's reply, so the first line
// starts with the version.
export const reportOf = (facts: ReportFacts): string => {
  const version = `version ${facts.version ?? 'unknown'}`
  const claude = facts.claudeVersion === undefined ? '' : ` on Claude Code ${facts.claudeVersion}`
  const verified = facts.claudeVersion === VERIFIED_WITH ? '' : ` (verified with ${VERIFIED_WITH})`
  const lines = [`${version}${claude}${verified}.`]
  if (!facts.active) {
    lines.push('It draws in a terminal session only: nothing shows here (the desktop app, VS Code, the mobile app and -p runs).')

    return lines.join('\n')
  }
  lines.push(...pictureLines(facts))
  if (facts.mode.mode === 'blocks' && facts.colour.tip !== undefined) lines.push(`  Tip: ${facts.colour.tip}`)
  if (facts.mode.mode !== 'pixels') lines.push('  Real pixels need kitty 0.28 or newer, or Ghostty, outside tmux.')
  lines.push(...storeLines(facts.store))
  lines.push(facts.lastStrip === undefined
    ? 'Last strip: none drawn yet.'
    : `Last strip, ${formatAge(facts.lastStrip.ageMs)} ago: ${facts.lastStrip.tiles.map(formatTile).join(' · ')}.`)
  if (facts.band !== undefined) lines.push(roomLine(facts.band))
  lines.push('Not seeing it? "▸ plugin panel hidden" means the strip is collapsed: press ctrl+x ctrl+a.')
  lines.push(`Options (/plugin, then mod-images): height ${facts.settings.height}, pictures ${facts.settings.pictures}.`)
  lines.push(`Paste: ${facts.pasteKeys}.`)
  lines.push('/mod-images test draws a sample strip for 10 seconds.')

  return lines.join('\n')
}
