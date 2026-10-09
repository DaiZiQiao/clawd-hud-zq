import type { Pictures } from './images-options'
import type { LayoutMode } from './strip-layout'

// How the strip draws in this terminal, read from the environment Claude Code
// runs in: real pixels where the engine can draw them (kitty 0.28 or newer and
// Ghostty, outside tmux and screen), half-block cells elsewhere, one line of
// text for a screen reader or NO_COLOR. Pure: the hooks module reads each
// variable by its literal name, and a pixels guess is only a guess until a
// `$.ui.blit` on a drawn Image confirms it (hooks/register.tsx `probePixels`).

/** The variables the choice reads, by meaning; a variable left out is unset. */
export type TermEnv = {
  /** TERM */
  term?: string
  /** TERM_PROGRAM */
  termProgram?: string
  /** KITTY_WINDOW_ID */
  kittyWindowId?: string
  /** COLORTERM */
  colorterm?: string
  /** TMUX */
  tmux?: string
  /** STY, set inside GNU screen */
  sty?: string
  /** CLAUDE_CODE_FORCE_TERMINAL_IMAGES */
  forceImages?: string
  /** NO_COLOR */
  noColor?: string
  /** CLAUDE_AX_SCREEN_READER */
  screenReader?: string
  /** WSL_DISTRO_NAME, set inside WSL */
  wslDistro?: string
  /** OS, `Windows_NT` on native Windows */
  os?: string
}

/** How the strip draws, and the words `/mod-images` gives for why. */
export type ModeChoice = { mode: LayoutMode; why: string }

/** How many colours the engine paints a Raster with here, and how to get more. */
export type ColourChoice = { level: 'full' | '256' | 'unknown'; why: string; tip?: string }

/** Why a terminal with no clue to pixels draws half-blocks: what `/mod-images` need not repeat. */
export const NO_PICTURES = 'this terminal draws no pictures for Claude Code'

const isSet = (value: string | undefined): value is string => value !== undefined && value !== ''

const lower = (value: string | undefined): string => (value ?? '').toLowerCase()

/** What says the terminal is one the engine draws pixels in, or undefined. */
export const pixelClueOf = (env: TermEnv): string | undefined => {
  if (isSet(env.forceImages)) return 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set'
  if (env.term === 'xterm-kitty') return 'kitty: TERM=xterm-kitty'
  if (isSet(env.kittyWindowId)) return 'kitty: KITTY_WINDOW_ID is set'
  if (lower(env.termProgram) === 'kitty') return 'kitty: TERM_PROGRAM=kitty'
  if (lower(env.termProgram) === 'ghostty' || env.term === 'xterm-ghostty') return 'Ghostty'

  return undefined
}

// The engine settles pixels as unavailable inside a multiplexer, whatever the
// terminal outside it; only the forcing variable is let through, and the blit
// probe has the last word on it.
export const modeOf = (pictures: Pictures, env: TermEnv): ModeChoice => {
  if (pictures === 'text') return { mode: 'text', why: 'the Pictures option is text' }
  if (pictures === 'blocks') return { mode: 'blocks', why: 'the Pictures option is blocks' }
  if (isSet(env.noColor)) return { mode: 'text', why: 'NO_COLOR is set' }
  if (env.screenReader === '1' || lower(env.screenReader) === 'true') return { mode: 'text', why: 'screen-reader mode is on' }
  const clue = pixelClueOf(env)
  if (clue === undefined) return { mode: 'blocks', why: NO_PICTURES }
  if (!isSet(env.forceImages) && (isSet(env.tmux) || isSet(env.sty))) {
    return { mode: 'blocks', why: `pictures do not pass through ${isSet(env.tmux) ? 'tmux' : 'screen'}` }
  }

  return { mode: 'pixels', why: clue }
}

const TIP_WSL = 'Windows Terminal draws full colour: add `export COLORTERM=truecolor` to your WSL shell profile.'
const TIP_MAC = 'If your Terminal draws 24-bit colour (macOS 26 or newer), add `export COLORTERM=truecolor` to your shell profile.'
const TIP_256 = 'If this terminal draws 24-bit colour, `export COLORTERM=truecolor` gives full-colour thumbnails.'

// A rough copy of the colour levels Claude Code picks (its supports-color):
// full colour where COLORTERM says so, in kitty and Ghostty and on native
// Windows; 256 colours in Terminal.app and, without COLORTERM, inside WSL.
export const colourOf = (env: TermEnv): ColourChoice => {
  const colorterm = lower(env.colorterm)
  if (colorterm === 'truecolor' || colorterm === '24bit') return { level: 'full', why: `COLORTERM=${env.colorterm ?? ''}` }
  // Forcing pictures says nothing about colours: only the terminal's own clues count.
  const clue = pixelClueOf({ ...env, forceImages: undefined })
  if (clue !== undefined) return { level: 'full', why: clue }
  if (env.os === 'Windows_NT' && !isSet(env.wslDistro)) return { level: 'full', why: 'Windows' }
  const program = lower(env.termProgram)
  if (program === 'iterm.app' || program === 'wezterm' || program === 'vscode') return { level: 'full', why: env.termProgram ?? '' }
  if (program === 'apple_terminal') return { level: '256', why: 'macOS Terminal, no COLORTERM', tip: TIP_MAC }
  if (isSet(env.wslDistro)) return { level: '256', why: 'WSL, no COLORTERM', tip: TIP_WSL }
  if (/256col/.test(env.term ?? '')) return { level: '256', why: `TERM=${env.term ?? ''}, no COLORTERM`, tip: TIP_256 }

  return { level: 'unknown', why: 'no colour hint in the environment' }
}

/** The keys that paste an image here (Claude Code binds Alt+V on Windows and WSL). */
export const pasteKeysOf = (env: TermEnv): string => {
  if (isSet(env.wslDistro)) return 'Alt+V or Ctrl+V, or drag a file in'
  if (env.os === 'Windows_NT') return 'Alt+V, or drag a file in'
  if (lower(env.termProgram) === 'apple_terminal') return 'Ctrl+V or Cmd+V, or drag a file in'

  return 'Ctrl+V (Cmd+V on macOS, Alt+V on Windows), or drag a file in'
}
