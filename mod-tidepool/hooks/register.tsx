import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './scene'

// Sea-glass and wet sand by day; a tidepool at night, lit by what glows in it.
// Every gray is tinted toward the water's teal, and the roles keep their meaning:
// danger a coral red, success a kelp green, warning a sun amber, pro an anemone violet.
const { theme, problems } = makeColors({
  label: 'Tidepool',
  roles: { accent: '#1b8f96', danger: '#d0453a', success: '#4f9a34', warning: '#b97a12', pro: '#8156c8' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e8efeb',
        'surface-1': '#eff5f2',
        'surface-2': '#f7faf8',
        'text-primary': '#0f2427',
        'text-secondary': '#30464a',
        'text-muted': '#4a6064',
      },
    },
    git: { added: '#25733a', removed: '#b03329', modified: '#8a5f0a', merged: '#6c45b0', closed: '#b03329', conflicting: '#97501a', draft: '#526669' },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a181b',
        'surface-1': '#0e1f22',
        'surface-2': '#122629',
        'surface-3': '#162b2f',
        'text-primary': '#e3f1ee',
        'text-secondary': '#b7ccc8',
        'text-muted': '#91aaa6',
      },
    },
    git: { added: '#62c27a', removed: '#f07a6c', modified: '#e0b04e', merged: '#b394ec', closed: '#f07a6c', conflicting: '#ee9a5c', draft: '#9fb3b0' },
  },
})

const SCENE_NAME = 'tidepool'

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 18, opacity: 0.6 } },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Only shown if a later build's contrast check would stop Desktop painting the look.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(`Tidepool: ${unpainted}`)
    }
    // The terminal and editors draw no look; the desktop and mobile apps draw it
    // when they attach, so there is nothing to report when isDrawn is false.
    await $.theme.set(LOOK)

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // This hook hears every mod's backdrop: draw only the one this mod set.
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== $.plugin.name || e.props.scene !== SCENE_NAME) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt="Caustic light drifting across a tidepool, with light shafts from the top right" isInteractive />
  })
}
