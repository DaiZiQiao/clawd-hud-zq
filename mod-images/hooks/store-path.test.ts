import { describe, expect, test } from 'claude-code/testing'

import {
  imagesDirOf,
  isUserDirName,
  isWindowsLike,
  joinPath,
  listingOf,
  projectKeyOf,
  storeDoubtOf,
  storeOffReasonOf,
  tempBasesOf,
} from './store-path'
import { randomOf } from './strip-layout.fixtures'

// Where Claude Code keeps pasted images, checked against the folders it made
// on this machine: the project key for plain, long and non-ASCII roots (the
// 231-unit root with é and an emoji that Claude Code 2.1.295 stored under
// `-bj0q5t`) and for Windows roots; the temp bases on Linux, macOS and
// Windows; paths joined with the base's own separator; the sessions with no
// image folder; and what a listing of a folder holds.

/** The robustness probe's launch folder: 231 UTF-16 code units, an ö, an é and an emoji among them. */
const LONG_ROOT = `/tmp/claude-0/-home-user-clawd-hud-zq/d53cb6db-ad4b-5f43-b300-48bcbbbedde2/scratchpad/wf2/robustness/w\u00f6rk \u00e9\u{1f600} ${'x'.repeat(70)}/${'y'.repeat(50)}`
/** The folder Claude Code 2.1.295 made for it, as its debug log and the disk name it. */
const LONG_KEY = '-tmp-claude-0--home-user-clawd-hud-zq-d53cb6db-ad4b-5f43-b300-48bcbbbedde2-scratchpad-wf2-robustness-w-rk-----xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-yyyyyyyyyyyyyyyyyyy-bj0q5t'
/** A sibling run's launch folder, and the session that stored 1.png, 2.jpg, 3.gif and 4.webp from it. */
const WORK_ROOT = '/tmp/claude-0/-home-user-clawd-hud-zq/d53cb6db-ad4b-5f43-b300-48bcbbbedde2/scratchpad/wf1/empirical/work'
const WORK_SESSION = '7deb0037-46a8-4916-860a-d6e39ddff89f'

// Claude Code's own sanitiser, as its source reads (strings line 419033), for the sweep below.
const engineKeyOf = (p: string): string => {
  const n = p.replace(/[^a-zA-Z0-9]/g, '-')
  if (n.length <= 200) return n
  let h = 0
  for (let i = 0; i < p.length; i++) h = (h << 5) - h + p.charCodeAt(i) | 0

  return n.slice(0, 200) + '-' + Math.abs(h).toString(36)
}

describe('the project key', () => {
  test('this repository and a sibling run\'s folder, as Claude Code named them', () => {
    expect(projectKeyOf('/home/user/clawd-hud-zq')).toBe('-home-user-clawd-hud-zq')
    expect(projectKeyOf(WORK_ROOT)).toBe('-tmp-claude-0--home-user-clawd-hud-zq-d53cb6db-ad4b-5f43-b300-48bcbbbedde2-scratchpad-wf1-empirical-work')
    expect(projectKeyOf('/tmp/claude-0/-home-user-clawd-hud-zq-d53cb6db-ad4b-5f43-b300-48bcbbbedde2/scratchpad/wf1/empirical/work')).toBe(projectKeyOf(WORK_ROOT))
  })

  test('the 231-unit root with é and an emoji: the first 200, then the hash, -bj0q5t', () => {
    expect(LONG_ROOT).toHaveLength(231)
    expect(projectKeyOf(LONG_ROOT)).toBe(LONG_KEY)
    expect(LONG_KEY).toHaveLength(207)
  })

  test('every code unit but a letter or digit is a dash: an accent one, an emoji two', () => {
    expect(projectKeyOf('/home/alice/caf\u00e9')).toBe('-home-alice-caf-')
    expect(projectKeyOf('/home/alice/\u{1f600}')).toBe('-home-alice---')
    expect(projectKeyOf('/Users/alice/my proj')).toBe('-Users-alice-my-proj')
    expect(projectKeyOf('/mnt/c/Users/alice/proj')).toBe('-mnt-c-Users-alice-proj')
  })

  test('Windows roots: C:\\Users\\alice\\proj is C--Users-alice-proj', () => {
    expect(projectKeyOf('C:\\Users\\alice\\proj')).toBe('C--Users-alice-proj')
    expect(projectKeyOf('\\\\server\\share\\proj')).toBe('--server-share-proj')
  })

  test('200 units stay whole; 201 are cut and hashed', () => {
    expect(projectKeyOf(`/${'a'.repeat(199)}`)).toBe(`-${'a'.repeat(199)}`)
    expect(projectKeyOf(`/${'a'.repeat(200)}`)).toMatch(new RegExp(`^-${'a'.repeat(199)}-[0-9a-z]+$`))
  })

  test('the same key as Claude Code\'s own code for a sweep of roots, short and long, any characters', () => {
    const random = randomOf(231)
    const alphabet = ['a', 'Z', '7', '/', '\\', ' ', '-', '.', ':', '\u00e9', '\u00f6', '\u{1f600}', '\u4e2d', '_']
    for (let round = 0; round < 500; round += 1) {
      const length = random(4) === 0 ? 195 + random(12) : random(260)
      const root = Array.from({ length }, () => alphabet[random(alphabet.length)] ?? 'a').join('')
      expect(projectKeyOf(root), root).toBe(engineKeyOf(root))
    }
  })
})

describe('the image folder', () => {
  test('Linux: the folder a sibling run\'s pastes went to', () => {
    expect(imagesDirOf('/tmp/claude-0', WORK_ROOT, WORK_SESSION))
      .toBe(`/tmp/claude-0/-tmp-claude-0--home-user-clawd-hud-zq-d53cb6db-ad4b-5f43-b300-48bcbbbedde2-scratchpad-wf1-empirical-work/${WORK_SESSION}/images`)
    expect(imagesDirOf('/tmp/claude-0', LONG_ROOT, '1ea8b664-0a11-496b-9bf7-7a63c69a0a63'))
      .toBe(`/tmp/claude-0/${LONG_KEY}/1ea8b664-0a11-496b-9bf7-7a63c69a0a63/images`)
  })

  test('macOS and Windows: the base\'s own separator throughout', () => {
    expect(imagesDirOf('/var/folders/xy/T/claude-501', '/Users/alice/proj', 'sid')).toBe('/var/folders/xy/T/claude-501/-Users-alice-proj/sid/images')
    expect(imagesDirOf('C:\\Users\\alice\\AppData\\Local\\Temp\\claude-0', 'C:\\Users\\alice\\proj', 'sid'))
      .toBe('C:\\Users\\alice\\AppData\\Local\\Temp\\claude-0\\C--Users-alice-proj\\sid\\images')
  })

  test('isUserDirName: claude- and something, whatever the uid reads as', () => {
    for (const name of ['claude-0', 'claude-1000', 'claude--1', 'claude-x']) expect(isUserDirName(name), name).toBe(true)
    for (const name of ['claude-', 'claude', 'claude_cli_latest_screenshot.png', 'Claude-0', 'xclaude-0', '']) expect(isUserDirName(name), name).toBe(false)
  })
})

describe('sessions with no image folder', () => {
  test('none is said when nothing turns the folder off', () => {
    expect(storeOffReasonOf({})).toBeUndefined()
    expect(storeOffReasonOf({ forcePersistence: '1' })).toBeUndefined()
  })

  test('CLAUDE_CODE_SKIP_PROMPT_HISTORY on, as Claude Code reads a switch: 1, true, yes or on, any case', () => {
    for (const value of ['1', 'true', 'YES', ' on ']) expect(storeOffReasonOf({ skipPromptHistory: value }), value).toBe('CLAUDE_CODE_SKIP_PROMPT_HISTORY is set')
    for (const value of ['0', 'false', '', 'no', 'off', 'maybe']) expect(storeOffReasonOf({ skipPromptHistory: value }), value).toBeUndefined()
  })

  test('a nested session may keep none: a doubt, since tmux and teammates inherit the marker and keep one', () => {
    const nested = 'CLAUDE_CODE_CHILD_SESSION is set: a nested session may keep none'
    expect(storeOffReasonOf({ childSession: '1' })).toBeUndefined()
    expect(storeDoubtOf({ childSession: '1' })).toBe(nested)
    expect(storeDoubtOf({ childSession: 'true', forcePersistence: '0' })).toBe(nested)
    expect(storeDoubtOf({ childSession: '1', forcePersistence: 'true' })).toBeUndefined()
    expect(storeDoubtOf({ childSession: '0' })).toBeUndefined()
    expect(storeOffReasonOf({ childSession: '1', skipPromptHistory: '1' })).toBe('CLAUDE_CODE_SKIP_PROMPT_HISTORY is set')
  })
})

describe('the temp bases', () => {
  test('Linux with nothing set: /tmp', () => {
    expect(tempBasesOf({}, '/home/alice/proj')).toEqual(['/tmp'])
  })

  test('macOS: TMPDIR first, its trailing slash trimmed, then /tmp', () => {
    expect(tempBasesOf({ tmpdir: '/var/folders/xy/yyyy/T/' }, '/Users/alice/proj')).toEqual(['/var/folders/xy/yyyy/T', '/tmp'])
  })

  test('CLAUDE_CODE_TMPDIR alone, trimmed, when set; a blank one counts as unset', () => {
    expect(tempBasesOf({ claudeTmpdir: ' /scratch/tmp/ ', tmpdir: '/var/tmp' }, '/home/alice/proj')).toEqual(['/scratch/tmp'])
    expect(tempBasesOf({ claudeTmpdir: '   ', tmpdir: '/var/tmp/' }, '/home/alice/proj')).toEqual(['/var/tmp', '/tmp'])
    expect(tempBasesOf({ claudeTmpdir: 'D:\\claude-tmp\\', temp: 'C:\\Temp' }, 'C:\\x')).toEqual(['D:\\claude-tmp'])
  })

  test('TMPDIR, TMP, TEMP and /tmp in that order, empty ones skipped, each folder once, a root kept whole', () => {
    expect(tempBasesOf({ tmpdir: '', tmp: '/tmp/', temp: '/data/tmp' }, '/home/alice/proj')).toEqual(['/tmp', '/data/tmp'])
    expect(tempBasesOf({ tmpdir: '/' }, '/home/alice/proj')).toEqual(['/', '/tmp'])
  })

  test('Windows: TEMP, TMP, then LOCALAPPDATA\\Temp, the same folder named once in any case or spelling', () => {
    const env = {
      os: 'Windows_NT',
      tmpdir: '/tmp',
      temp: 'C:\\Users\\alice\\AppData\\Local\\Temp',
      tmp: 'C:\\Users\\alice\\AppData\\Local\\Temp\\',
      localAppData: 'C:\\Users\\alice\\AppData\\Local',
    }
    expect(tempBasesOf(env, 'C:\\Users\\alice\\proj')).toEqual(['C:\\Users\\alice\\AppData\\Local\\Temp'])
    expect(tempBasesOf({ temp: 'C:\\TEMP', tmp: 'c:/temp/' }, 'C:\\x')).toEqual(['C:\\TEMP'])
    expect(tempBasesOf({ temp: 'D:\\Temp', tmp: 'D:\\tmp' }, 'D:\\work')).toEqual(['D:\\Temp', 'D:\\tmp'])
    expect(tempBasesOf({ localAppData: 'C:\\Users\\bob\\AppData\\Local' }, 'C:\\x')).toEqual(['C:\\Users\\bob\\AppData\\Local\\Temp'])
    expect(tempBasesOf({ temp: 'C:\\' }, 'C:\\x')).toEqual(['C:\\'])
    expect(tempBasesOf({ tmpdir: '/tmp' }, 'C:\\x')).toEqual([])
  })

  test('isWindowsLike: OS Windows_NT, or a drive or network root; WSL\'s /mnt/c is Linux', () => {
    expect(isWindowsLike({ os: 'Windows_NT' }, '/x')).toBe(true)
    for (const root of ['C:\\Users\\a', 'c:/proj', 'C:', '\\\\server\\share\\proj']) expect(isWindowsLike({}, root), root).toBe(true)
    for (const root of ['/home/a', '/mnt/c/Users/a', '', 'proj']) expect(isWindowsLike({}, root), root).toBe(false)
  })
})

describe('joining paths', () => {
  test('a slash, none doubled, a root kept', () => {
    expect(joinPath('/tmp/claude-0', 'a', 'b')).toBe('/tmp/claude-0/a/b')
    expect(joinPath('/tmp/', 'claude-0')).toBe('/tmp/claude-0')
    expect(joinPath('/', 'tmp')).toBe('/tmp')
    expect(joinPath('/tmp', '/x/', '', 'y')).toBe('/tmp/x/y')
    expect(joinPath('/tmp')).toBe('/tmp')
  })

  test('a backslash when the base has one and no slash: drives and shares', () => {
    expect(joinPath('C:\\Users\\alice\\AppData\\Local\\Temp', 'claude-0', 'images')).toBe('C:\\Users\\alice\\AppData\\Local\\Temp\\claude-0\\images')
    expect(joinPath('C:\\', 'claude-0')).toBe('C:\\claude-0')
    expect(joinPath('\\\\server\\share\\tmp\\', 'claude-0')).toBe('\\\\server\\share\\tmp\\claude-0')
    expect(joinPath('C:\\Temp', '\\x\\', '/y/')).toBe('C:\\Temp\\x\\y')
  })

  test('a slash when the base has one, on Windows too', () => {
    expect(joinPath('C:/Users/alice', 'x')).toBe('C:/Users/alice/x')
    expect(joinPath('C:/', 'x')).toBe('C:/x')
  })
})

describe('a listing of the folder', () => {
  const ENTRIES = [
    { name: '1.png', kind: 'file', size: 100, mtimeMs: 1000 },
    { name: '2.jpg', kind: 'file', size: 200, mtimeMs: 2000 },
    { name: '3.gif.tmp.6feab4d7', kind: 'file', size: 0, mtimeMs: 3000 },
    { name: '4.webp', kind: 'file', size: 400, mtimeMs: 4000 },
    { name: '5.bmp', kind: 'file', size: 500, mtimeMs: 5000 },
    { name: 'notes.txt', kind: 'file', size: 1, mtimeMs: 1 },
    { name: '6.png', kind: 'dir', size: 0, mtimeMs: 0 },
    { name: '7.png', kind: 'other', size: 0, mtimeMs: 0 },
    { name: '8.png', kind: 'file', size: 800, mtimeMs: 5000 },
    { name: '8.jpg', kind: 'file', size: 801, mtimeMs: 6000 },
    { name: '9.png', kind: 'file', size: 900, mtimeMs: 7000 },
    { name: '9.gif', kind: 'file', size: 901, mtimeMs: 7000 },
    { name: '0.png', kind: 'file', size: 1, mtimeMs: 1 },
    { name: '10.PNG', kind: 'file', size: 1, mtimeMs: 1 },
    { name: 'a1.png', kind: 'file', size: 1, mtimeMs: 1 },
    { name: '11.png.tmp.abcd1234', kind: 'file', size: 0, mtimeMs: 8000 },
    { name: '11.png', kind: 'file', size: 1100, mtimeMs: 7900 },
    { name: '99999999999999999999.png', kind: 'file', size: 1, mtimeMs: 1 },
    { name: '12.png.tmp.', kind: 'file', size: 0, mtimeMs: 1 },
  ] as const

  test('the stored pictures by id, the newer of two for one id, and the ids still being written', () => {
    const listing = listingOf(ENTRIES)
    expect([...listing.files.values()].map(file => [file.id, file.name, file.ext, file.size, file.mtimeMs])).toEqual([
      [1, '1.png', 'png', 100, 1000],
      [2, '2.jpg', 'jpg', 200, 2000],
      [4, '4.webp', 'webp', 400, 4000],
      [8, '8.jpg', 'jpg', 801, 6000],
      [9, '9.gif', 'gif', 901, 7000],
      [11, '11.png', 'png', 1100, 7900],
    ].sort((a, b) => Number(a[0]) - Number(b[0])))
    expect([...listing.tmpIds].sort((a, b) => a - b)).toEqual([3, 11, 12])
  })

  test('the order of the listing changes nothing', () => {
    const forward = listingOf(ENTRIES)
    const backward = listingOf([...ENTRIES].reverse())
    expect(new Map([...backward.files].sort(([a], [b]) => a - b))).toEqual(new Map([...forward.files].sort(([a], [b]) => a - b)))
    expect([...backward.tmpIds].sort((a, b) => a - b)).toEqual([...forward.tmpIds].sort((a, b) => a - b))
  })

  test('an empty folder holds nothing', () => {
    const listing = listingOf([])
    expect([listing.files.size, listing.tmpIds.size]).toEqual([0, 0])
  })
})
