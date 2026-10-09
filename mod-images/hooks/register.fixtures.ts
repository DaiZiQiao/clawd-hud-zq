import type { CommandSpec, FsEntry, On, UiBlitArgs, UiBlitResult } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// The engine beneath mod-images as its tests answer it: a session with a
// draft, the folder Claude Code keeps pasted images in, the plugin's state,
// the band and a clock that moves when the test says.

export const NOW = 1_800_000_000_000
export const SID = 'aaaaaaaa-1111-4222-8333-444444444444'
export const NEXT_SID = 'bbbbbbbb-1111-4222-8333-444444444444'
export const ROOT = '/work'
export const USER_DIR = '/tmp/claude-1000'
export const imagesDirOf = (sid = SID): string => `${USER_DIR}/-work/${sid}/images`
export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
export const REPORT = { command: 'mod-images', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
export const SAMPLE = { ...REPORT, args: 'test' } as const

// A 16 x 10 RGB gradient and a 4 x 4 picture whose right half is transparent.
export const PNG_GRADIENT = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAABK0lEQVR42g3LIREFIRRA0VdhPWorYAhABLYCGkcFBAXWXclQAYukAjMk2ATM8P/xR0S4hFvQghUewQtRSMIrVKEJQ5jCJxxBRHEpboVWWMWj8IqoSIpXURVNMRRT8SmO+gfDZbgN2mANj8EboiEZXkM1NMMwTMNnOOYfHJfjdmiHdTwO74iO5Hgd1dEcwzEdn+O4fwhcgTugAzbwBHwgBlLgDdRAC4zADHyBE/4hc2XujM7YzJPxmZhJmTdTMy0zMjPzZU7+h8JVuAu6YAtPwRdiIRXeQi20wijMwlc45R86V+fu6I7tPB3fiZ3UeTu10zqjMztf5/R/WFyLe6EXdvEs/CIu0uJd1EVbjMVcfIuz/mFzbe6N3tjNs/GbuEmbd1M3bTM2c/NtzuYHB8kCgKKXq9cAAAAASUVORK5CYII='
export const PNG_HALF = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEElEQVR42mP4DwUMMEC6AAC7wB/haqkNYAAAAABJRU5ErkJggg=='

/** The band's props in a 120 x 30 fullscreen terminal with a one-line draft (measured). */
export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 115,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
} as const
export const VIEWPORT = { columns: 120, rows: 30, isFullscreen: true }

type FileOf = { base64: string; size: number; mtimeMs: number }

const sizeOf = (base64: string): number => Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/'

// `kitState`: the test kit holds the plugin's state, so a write redraws what
// read it, as in a session; otherwise the test holds it, to read and to wipe.
export const arrange = (on: On, { kitState = false }: { kitState?: boolean } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  const world = {
    draft: '',
    sid: SID,
    surfaces: ['terminal'] as string[],
    files: new Map<string, FileOf>(),
    dirs: new Set<string>(['/tmp', USER_DIR, '/tmp/claude-0']),
    registered: [] as CommandSpec[],
    blits: [] as UiBlitArgs[],
    blit: (_args: UiBlitArgs): UiBlitResult => ({}),
    writes: [] as string[],
    logs: [] as string[],
    /** Every folder listed, in order. */
    listed: [] as string[],
  }
  const held = new Map<string, { value: unknown; version: number }>()

  if (kitState) {
    on('state.set', (_$, e, next) => {
      world.writes.push(e.key)

      return next(e)
    })
  } else {
    // The host's side of `$.state`, in memory; a /clear empties it (`wipe`).
    on('state.get', (_$, e) => ({ value: held.get(e.key) ?? { value: undefined, version: 0 } }))
    on('state.set', (_$, e) => {
      const version = held.get(e.key)?.version ?? 0
      if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false as const, version } }
      world.writes.push(e.key)
      held.set(e.key, { value: e.value, version: version + 1 })

      return { value: { isSet: true as const, version: version + 1 } }
    })
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => {
    world.registered.push(e)

    return { value: { command: e.name } }
  })
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: world.surfaces as never }))
  on('session.version', () => ({ value: { version: '2.1.295', base: '2.1.295', builtAt: '2026-10-08T16:50:59Z' } }))
  on('prompt.read', () => ({ value: { text: world.draft, cursor: world.draft.length } }))
  on('fs.exists', (_$, e) => ({ value: world.dirs.has(e.path) || world.files.has(e.path) }))
  on('fs.list', (_$, e) => {
    world.listed.push(e.path)
    if (!world.dirs.has(e.path)) return { deny: `${e.path}: no such directory` }
    const entries: FsEntry[] = []
    for (const dir of world.dirs) if (dir !== e.path && parentOf(dir) === e.path) entries.push({ name: dir.slice(e.path.length + 1), kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
    for (const [path, file] of world.files) if (parentOf(path) === e.path) entries.push({ name: path.slice(e.path.length + 1), kind: 'file', size: file.size, mtimeMs: file.mtimeMs, isLink: false })

    return { value: entries }
  })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('plugin.json')) return { value: JSON.stringify({ name: 'mod-images', version: '1.0.0' }) }
    const file = world.files.get(e.path)
    if (file === undefined) return { deny: `${e.path}: no such file` }

    return { value: e.as === 'bytes' ? { base64: file.base64 } : '' }
  })
  on('ui.blit', (_$, e) => {
    world.blits.push(e)

    return { value: world.blit(e) }
  })
  on('ui.log', (_$, e) => {
    world.logs.push(e.text)

    return { value: undefined }
  })
  // The typeahead has no rows of its own here.
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  // Core's band draws nothing of its own; its hint line is the engine's too.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine' as const, ref: 0 }))
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'engine' as const, ref: 0 }))

  // Claude Code storing a pasted image and putting its chip in the draft.
  const paste = (id: number, base64 = PNG_GRADIENT, options: { ext?: string; mtimeMs?: number; sid?: string; chip?: boolean } = {}): void => {
    const dir = imagesDirOf(options.sid ?? world.sid)
    for (let at = dir; at !== '/' && !world.dirs.has(at); at = parentOf(at)) world.dirs.add(at)
    world.files.set(`${dir}/${id}.${options.ext ?? 'png'}`, { base64, size: sizeOf(base64), mtimeMs: options.mtimeMs ?? clock.now() })
    if (options.chip !== false) world.draft = `${world.draft}${world.draft === '' || world.draft.endsWith(' ') ? '' : ' '}[Image #${id}]`
  }
  // What `/clear` does to the host: a new session id and the plugin's state gone.
  const wipe = (sid = NEXT_SID): void => {
    world.sid = sid
    world.draft = ''
    held.clear()
  }
  const stateOf = (key: string): unknown => held.get(key)?.value

  return { clock, world, held, paste, wipe, stateOf }
}

/** Lets timers due within `ms` run, a step at a time, as a session's would. */
export const runFor = async (clock: { advance: (ms: number) => Promise<void> }, ms: number, step = 50): Promise<void> => {
  for (let passed = 0; passed < ms; passed += step) await clock.advance(step)
}

export const mountBand = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', props: { hasSurvey?: boolean; maxRows?: number; bodyColumns?: number } = {}) =>
  $.ui.mount({ plugin: 'mod-images', surface, component: 'AbovePrompt', props: { ...BAND_PROPS, ...props }, viewport: VIEWPORT })

export const autocomplete = ($: Engine, text: string) =>
  ($.prompt as unknown as { autocomplete: (e: { text: string; cursor: number; token: string; start: number }) => Promise<unknown> })
    .autocomplete({ text, cursor: text.length, token: text.slice(text.lastIndexOf(' ') + 1), start: text.lastIndexOf(' ') + 1 })

/** The hint line under the prompt drawn again, as the engine does when the draft empties or fills. */
export const hintLine = async ($: Engine, isDraft: boolean): Promise<void> => {
  const ui = await $.ui.mount({ plugin: 'mod-images', surface: 'terminal', component: 'PromptHint', props: { isDraft, isWorking: false, hint: '' } })
  await ui.unmount()
}
