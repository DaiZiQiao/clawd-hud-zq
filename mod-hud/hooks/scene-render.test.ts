import { describe, expect, test } from 'claude-code/testing'

import { sceneOf } from './scene-model'
import { NOW, SCENE_COLOURS, hotHud, trio } from './scene-model.fixtures'
import { renderMascots } from './scene-render'
import { mascotLines, textsIn } from './scene-render.fixtures'

// The scene's tree: one keyed row per scene row, each one Text cut to the pane.

const SURFACES = ['terminal', 'desktop'] as const

const SCENE = 'scene-under-test'
const VIEWPORT = { columns: 160, rows: 40, isFullscreen: true }
const PANE_PROPS = { title: 'HUD', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

describe('the tree', () => {
  test('one keyed row per scene row, each one Text cut to the pane, contract keys and raw colours, no background', { timeoutMs: 20_000 }, async ($, on) => {
    const scene = sceneOf(trio, hotHud, NOW)
    on('ui.render', { component: 'Pane', requestId: SCENE }, ($$, e) => {
      const table = $$.ui.resolve(e)

      return renderMascots(table, scene, { columns: e.props.bodyColumns, rows: 8, tick: 0 }) ?? table.Box({})
    })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', props: PANE_PROPS, requestId: SCENE, viewport: VIEWPORT })
      const root = await ui.find({ type: 'Box', key: 'mascots' })
      expect(root?.props.flexShrink).toBe(0)
      const rows = (await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('mascots:') === true)
      const lines = mascotLines(scene, { columns: 72, rows: 8, tick: 0 }) ?? []
      expect(rows.map(row => row.key)).toEqual(lines.map((_, index) => `mascots:${index}`))
      expect(rows.map(row => row.text.trimEnd())).toEqual(lines.map(line => line.trimEnd()))
      for (const row of rows) {
        expect(row.props.height).toBe(1)
        const texts = textsIn(row)
        expect(texts[0]?.props?.wrap).toBe('truncate-end')
        for (const text of texts) {
          expect(text.props?.backgroundColor).toBe(undefined)
          expect(text.props?.inverse).toBe(undefined)
          if (text.props?.color !== undefined) expect(SCENE_COLOURS).toContain(text.props.color)
        }
      }
      await ui.unmount()
    }
  })
})
