import { describe, expect, test } from 'claude-code/testing'

import { formatAge, formatTile, reportOf } from './images-report'
import type { ReportFacts } from './images-report'

// /mod-images' words: one fact a line, the tips only where they apply, and
// the strip it reports being the last one drawn.

const BASE: ReportFacts = {
  version: '1.0.0',
  claudeVersion: '2.1.295',
  active: true,
  mode: { mode: 'blocks', why: 'this terminal draws no pictures for Claude Code' },
  confirmed: false,
  colour: { level: '256', why: 'WSL, no COLORTERM', tip: 'Windows Terminal draws full colour: add `export COLORTERM=truecolor` to your WSL shell profile.' },
  store: { kind: 'found', dir: '/tmp/claude-1000/-home-alice-proj/s1/images', files: 2 },
  lastStrip: {
    ageMs: 40_000,
    tiles: [
      { id: 1, state: 'ready', format: 'png', width: 1920, height: 1080, seenAt: 0 },
      { id: 3, state: 'failed', format: 'webp', reason: 'no preview', seenAt: 0 },
    ],
  },
  band: { maxRows: 7, bodyColumns: 75, viewportRows: 24, viewportColumns: 80, isFullscreen: true, rows: 6 },
  settings: { height: 8, pictures: 'auto' },
  pasteKeys: 'Alt+V or Ctrl+V, or drag a file in',
}

describe('the report', () => {
  test('a half-block terminal: its colours, the tip, the folder, the last strip and the room', () => {
    expect(reportOf(BASE).split('\n')).toEqual([
      'version 1.0.0 on Claude Code 2.1.295.',
      'Pictures: half-block cells in 256 colours (WSL, no COLORTERM).',
      '  Tip: Windows Terminal draws full colour: add `export COLORTERM=truecolor` to your WSL shell profile.',
      '  Real pixels need kitty 0.28 or newer, or Ghostty, outside tmux.',
      'Image folder: /tmp/claude-1000/-home-alice-proj/s1/images (found, 2 images this session).',
      'Last strip, 40 s ago: #1 PNG 1920x1080 shown · #3 WebP: no preview.',
      'Room: 7 rows above the prompt, 75 columns (80x24, fullscreen); thumbnails were 6 rows.',
      'Not seeing it? "▸ plugin panel hidden" means the strip is collapsed: press ctrl+x ctrl+a.',
      'Options (/plugin, then mod-images): height 8, pictures auto.',
      'Paste: Alt+V or Ctrl+V, or drag a file in.',
      '/mod-images test draws a sample strip for 10 seconds.',
    ])
  })

  test('kitty says whether the terminal confirmed pixels, with no colour tip', () => {
    const lines = reportOf({ ...BASE, mode: { mode: 'pixels', why: 'kitty: TERM=xterm-kitty' }, confirmed: true, colour: { level: 'full', why: 'kitty' } }).split('\n')
    expect(lines[1]).toBe('Pictures: real pixels (kitty: TERM=xterm-kitty, confirmed by the terminal).')
    expect(lines.some(line => line.includes('Tip:') || line.includes('Real pixels need'))).toBe(false)
  })

  test('half-blocks say why not pixels when there is more to it than the terminal', () => {
    const lines = reportOf({ ...BASE, mode: { mode: 'blocks', why: 'pictures do not pass through tmux' }, colour: { level: 'full', why: 'COLORTERM=truecolor' } }).split('\n')
    expect(lines.slice(1, 4)).toEqual([
      'Pictures: half-block cells in full colour (COLORTERM=truecolor).',
      '  Pictures do not pass through tmux.',
      '  Real pixels need kitty 0.28 or newer, or Ghostty, outside tmux.',
    ])
  })

  test('another Claude Code version is named beside the one it was checked with', () => {
    expect(reportOf({ ...BASE, claudeVersion: '2.1.300' }).split('\n')[0]).toBe('version 1.0.0 on Claude Code 2.1.300 (verified with 2.1.295).')
  })

  test('no folder, a folder not found yet, and nothing drawn yet', () => {
    expect(reportOf({ ...BASE, store: { kind: 'off', reason: 'CLAUDE_CODE_SKIP_PROMPT_HISTORY is set' } })).toContain('Image folder: none (CLAUDE_CODE_SKIP_PROMPT_HISTORY is set): thumbnails cannot be read in this session.')
    const missing = reportOf({ ...BASE, store: { kind: 'not-found', tried: ['/tmp'] }, lastStrip: undefined })
    expect(missing).toContain('Image folder: not found yet. It appears with the first image pasted in this session.\n  Looked in: /tmp')
    expect(missing).toContain('Last strip: none drawn yet.')
    const doubted = reportOf({ ...BASE, store: { kind: 'not-found', tried: ['/tmp'], doubt: 'CLAUDE_CODE_CHILD_SESSION is set: a nested session may keep none' } })
    expect(doubted).toContain('Image folder: not found (CLAUDE_CODE_CHILD_SESSION is set: a nested session may keep none): tiles read no preview.')
  })

  test('the room says what the strip was drawn as when it had no thumbnails', () => {
    const roomOf = (band: ReportFacts['band']): string | undefined => reportOf({ ...BASE, band }).split('\n').find(line => line.startsWith('Room:'))
    const band = { maxRows: 3, bodyColumns: 75, viewportRows: 24, viewportColumns: 80, isFullscreen: false }
    expect(roomOf({ ...band, shape: 'compact' })).toBe('Room: 3 rows above the prompt, 75 columns (80x24); the strip was one line.')
    expect(roomOf({ ...band, shape: 'text' })).toBe('Room: 3 rows above the prompt, 75 columns (80x24); the strip was one line of text.')
    expect(roomOf({ ...band, maxRows: 0, shape: 'none' })).toBe('Room: 0 rows above the prompt, 75 columns (80x24); no room for the strip.')
  })

  test('outside a terminal it says so and stops', () => {
    expect(reportOf({ ...BASE, active: false }).split('\n')).toEqual([
      'version 1.0.0 on Claude Code 2.1.295.',
      'It draws in a terminal session only: nothing shows here (the desktop app, VS Code, the mobile app and -p runs).',
    ])
  })
})

describe('formats', () => {
  test('ages round to seconds, minutes and hours', () => {
    expect(formatAge(400)).toBe('0 s')
    expect(formatAge(89_000)).toBe('89 s')
    expect(formatAge(5 * 60_000)).toBe('5 min')
    expect(formatAge(3 * 3_600_000)).toBe('3 h')
  })

  test('a tile names its number, format, size and state', () => {
    expect(formatTile({ id: 2, state: 'not-attached', seenAt: 0 })).toBe('#2 not attached')
    expect(formatTile({ id: 5, state: 'reading', format: 'jpeg', width: 3000, height: 2000, seenAt: 0 })).toBe('#5 JPEG 3000x2000 still reading')
  })
})
