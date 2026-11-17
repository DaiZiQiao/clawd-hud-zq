import type { ThemeSetArgs } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { checkColors } from './make-colors.js'

const backdrop = (scene: string, surface: 'desktop' | 'mobile', setBy = 'mod-tidepool') => ({
  plugin: 'mod-tidepool',
  component: 'Backdrop',
  requestId: 'backdrop',
  surface,
  props: { scene, plugin: setBy, glass: { blur: 18, opacity: 0.6 } },
} as const)

test('session.start sets the whole look once: both modes, and the tidepool scene', async ($, on) => {
  const sets: ThemeSetArgs[] = []

  on('theme.set', (_, e) => {
    sets.push(e)

    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(sets.length).toBe(1)
  const look = sets[0]!

  expect(look.colors?.label).toBe('Tidepool')
  expect(Object.keys(look.colors?.inputs.light ?? {}).length > 90).toBe(true)
  expect(Object.keys(look.colors?.inputs.dark ?? {}).length > 90).toBe(true)
  expect(look.backdrop !== undefined && 'scene' in look.backdrop ? look.backdrop.scene : undefined).toBe('tidepool')
  expect(look.overrideColorScheme).toBe(undefined)
  // the one kind of line that makes Desktop ignore the whole theme
  expect(checkColors(look.colors).filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
})

test('the backdrop draws the scene on desktop and mobile, within the limits a scene is held to', async ($, on) => {
  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount(backdrop('tidepool', surface))
    const svg = await ui.find({ type: 'Svg' })

    expect(svg?.props.alt).toBe('Caustic light drifting across a tidepool, with light shafts from the top right')
    const source = String(svg?.props.source)

    expect(source.startsWith('<svg ')).toBe(true)
    expect(source.length < 131072).toBe(true)
    // nothing a scene may not hold: pictures, fonts, outside links, escapes
    for (const banned of ['<image', 'data:', 'base64', 'foreignObject', '@import', '@font-face', '\\', '<![CDATA[', '&#']) {
      expect(source.includes(banned)).toBe(false)
    }
    // every url() and href is a local #fragment
    expect((source.match(/url\((?!#)/g) ?? []).length).toBe(0)
    expect((source.match(/href="(?!#)/g) ?? []).length).toBe(0)
    await ui.unmount()
  }
})

test("another plugin's scene is left to it", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  for (const [scene, setBy] of [['someone-elses', 'mod-tidepool'], ['tidepool', 'another-mod']] as const) {
    const ui = await $.ui.mount(backdrop(scene, 'desktop', setBy))

    expect(await ui.find({ type: 'Svg' })).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})
