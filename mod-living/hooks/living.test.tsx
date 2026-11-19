import type { On, ThemeSetArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { checkColors } from './make-colors.js'

const engine = (on: On, sets: ThemeSetArgs[], clears: number[]) => {
  on('command.register', () => ({ value: { command: 'living' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('theme.set', (_, e) => { sets.push(e); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('theme.clear', () => { clears.push(1); return { value: { isDrawn: false, reason: 'the theme was cleared' } } })
}
const sceneOf = (a: ThemeSetArgs | undefined) => (a?.backdrop !== undefined && 'scene' in a.backdrop ? a.backdrop.scene : undefined)
const backdrop = (scene: string, surface: 'desktop' | 'mobile', setBy = 'mod-living') => ({
  plugin: 'mod-living', component: 'Backdrop', requestId: 'backdrop', surface,
  props: { scene, plugin: setBy, glass: { blur: 18, opacity: 0.6 } },
} as const)

test('a first session starts on the meadow, in light mode, with colours Desktop paints', async ($, on) => {
  const sets: ThemeSetArgs[] = []
  engine(on, sets, [])
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.length).toBe(1)
  expect(sceneOf(sets[0])).toBe('living-meadow')
  expect(sets[0]?.overrideColorScheme).toBe('light')
  expect(checkColors(sets[0]?.colors).filter(l => l.startsWith("Desktop won't paint"))).toEqual([])
})

test('the saved scene comes back at session start', async ($, on) => {
  const sets: ThemeSetArgs[] = []
  engine(on, sets, [])
  mock.store(on, { scene: 'aurora' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sceneOf(sets[0])).toBe('living-aurora')
  expect(sets[0]?.overrideColorScheme).toBe('dark')
})

test('"off" saved: no theme at session start', async ($, on) => {
  const sets: ThemeSetArgs[] = []
  engine(on, sets, [])
  mock.store(on, { scene: 'off' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.length).toBe(0)
})

test('/living switches, remembers, turns off, and refuses a name it does not know', async ($, on) => {
  const sets: ThemeSetArgs[] = []
  const clears: number[] = []
  engine(on, sets, clears)
  mock.store(on)
  const run = async (args: string) =>
    (await $.command.run({ command: 'living', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text

  expect(await run('lava')).toBe('Lava lamp is on.')
  expect(sceneOf(sets.at(-1))).toBe('living-lava')
  expect(await run('')).toContain('Living background: Lava lamp.')
  expect(await run('Coral ')).toBe('Living coral is on.')
  expect(sceneOf(sets.at(-1))).toBe('living-coral')
  expect(await run('dragons')).toContain('There is no scene called "dragons"')
  expect(await run('off')).toBe('Living background off. /living and a name turns it back on.')
  expect(clears.length).toBe(1)
  expect(await run('')).toContain('Living background: off.')
})

test('every scene draws its shader over its still, on desktop and mobile', async ($, on) => {
  for (const name of ['ink', 'aurora', 'coral', 'lava', 'meadow']) {
    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount(backdrop(`living-${name}`, surface))
      const shader = await ui.find({ type: 'Shader' })
      expect(shader?.props.module).toBe(`hooks/shaders/${name}.ts`)
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source).startsWith('<svg ')).toBe(true)
      expect(String(svg?.props.source).length < 131072).toBe(true)
      await ui.unmount()
    }
  }
})

test("another mod's backdrop is left to it", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const [scene, setBy] of [['tidepool', 'mod-tidepool'], ['living-ink', 'someone-else']] as const) {
    const ui = await $.ui.mount(backdrop(scene, 'desktop', setBy))
    expect(await ui.find({ type: 'Shader' })).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})
