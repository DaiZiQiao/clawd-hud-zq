import { describe, expect, test } from 'claude-code/testing'

import { colourOf, modeOf, pasteKeysOf, pixelClueOf } from './images-mode'

// How the strip draws in each of the person's terminals, from the variables
// Claude Code runs with: kitty, Windows Terminal (PowerShell), WSL and macOS
// Terminal, and the cases that turn pixels off (tmux, NO_COLOR, a screen reader).

const KITTY = { term: 'xterm-kitty', kittyWindowId: '1', colorterm: 'truecolor' }
const WINDOWS = { os: 'Windows_NT' }
const WSL = { term: 'xterm-256color', wslDistro: 'Ubuntu' }
const MAC = { term: 'xterm-256color', termProgram: 'Apple_Terminal' }

describe('the drawing mode', () => {
  test('kitty and Ghostty get pixels; everything else half-blocks', () => {
    expect(modeOf('auto', KITTY)).toEqual({ mode: 'pixels', why: 'kitty: TERM=xterm-kitty' })
    expect(modeOf('auto', { term: 'xterm-ghostty', termProgram: 'ghostty' })).toEqual({ mode: 'pixels', why: 'Ghostty' })
    expect(modeOf('auto', { term: 'xterm-256color', kittyWindowId: '3' }).mode).toBe('pixels')
    for (const env of [WINDOWS, WSL, MAC, {}]) expect(modeOf('auto', env)).toEqual({ mode: 'blocks', why: 'this terminal draws no pictures for Claude Code' })
  })

  test('tmux and screen keep pixels out unless Claude Code is told to force them', () => {
    expect(modeOf('auto', { ...KITTY, tmux: '/tmp/tmux-1/default,1,0' })).toEqual({ mode: 'blocks', why: 'pictures do not pass through tmux' })
    expect(modeOf('auto', { ...KITTY, sty: '12.pts-1' })).toEqual({ mode: 'blocks', why: 'pictures do not pass through screen' })
    expect(modeOf('auto', { tmux: 'x', forceImages: '1' })).toEqual({ mode: 'pixels', why: 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set' })
  })

  test('the option wins, then NO_COLOR and screen-reader mode choose text', () => {
    expect(modeOf('blocks', KITTY).mode).toBe('blocks')
    expect(modeOf('text', KITTY).mode).toBe('text')
    expect(modeOf('auto', { ...KITTY, noColor: '1' })).toEqual({ mode: 'text', why: 'NO_COLOR is set' })
    expect(modeOf('auto', { ...MAC, screenReader: '1' })).toEqual({ mode: 'text', why: 'screen-reader mode is on' })
    // An empty NO_COLOR is unset, as the convention has it.
    expect(modeOf('auto', { ...KITTY, noColor: '' }).mode).toBe('pixels')
  })

  test('a clue names what told it', () => {
    expect(pixelClueOf({})).toBeUndefined()
    expect(pixelClueOf({ termProgram: 'kitty' })).toBe('kitty: TERM_PROGRAM=kitty')
  })
})

describe('colours', () => {
  test('kitty, native Windows and COLORTERM are full colour', () => {
    expect(colourOf(KITTY).level).toBe('full')
    expect(colourOf(WINDOWS)).toEqual({ level: 'full', why: 'Windows' })
    expect(colourOf({ ...WSL, colorterm: 'truecolor' })).toEqual({ level: 'full', why: 'COLORTERM=truecolor' })
  })

  test('macOS Terminal and WSL without COLORTERM are 256 colours, each with its own tip', () => {
    expect(colourOf(MAC)).toMatchObject({ level: '256', why: 'macOS Terminal, no COLORTERM' })
    expect(colourOf(MAC).tip).toContain('macOS 26')
    expect(colourOf(WSL)).toMatchObject({ level: '256', why: 'WSL, no COLORTERM' })
    expect(colourOf(WSL).tip).toContain('WSL shell profile')
  })

  test('forcing pictures says nothing about colours', () => {
    expect(colourOf({ forceImages: '1' }).level).toBe('unknown')
  })
})

describe('paste keys', () => {
  test('Alt+V on Windows and WSL, Ctrl+V or Cmd+V on macOS', () => {
    expect(pasteKeysOf(WINDOWS)).toBe('Alt+V, or drag a file in')
    expect(pasteKeysOf(WSL)).toBe('Alt+V or Ctrl+V, or drag a file in')
    expect(pasteKeysOf(MAC)).toBe('Ctrl+V or Cmd+V, or drag a file in')
    expect(pasteKeysOf(KITTY)).toBe('Ctrl+V (Cmd+V on macOS, Alt+V on Windows), or drag a file in')
  })
})
