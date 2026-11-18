import type { Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { PALETTES } from './palettes'
import { STILLS } from './stills'

// Five living backgrounds, each a GPU shader over a still that shows where the
// shader is not played. /living switches between them and remembers the choice.
const NAMES = ['ink', 'aurora', 'coral', 'lava', 'meadow'] as const
type Name = (typeof NAMES)[number]
const isName = (x: unknown): x is Name => typeof x === 'string' && (NAMES as readonly string[]).includes(x)
const DEFAULT: Name = 'meadow'

const LABELS: Record<Name, string> = {
  ink: 'Ink in water',
  aurora: 'Aurora',
  coral: 'Living coral',
  lava: 'Lava lamp',
  meadow: 'Summer meadow',
}
const ALTS: Record<Name, string> = {
  ink: 'Glowing ink drifting and curling through dark water',
  aurora: 'Curtains of green and violet light over dark mountains under stars',
  coral: 'A growing pattern of teal and gold coral in deep water',
  lava: 'Glossy orange wax blobs drifting in warm light',
  meadow: 'Towering summer clouds over blue mountains, green hills with round trees, and wind in the grass',
}

const COLORS = Object.fromEntries(NAMES.map(n => [n, makeColors(PALETTES[n])])) as Record<Name, ReturnType<typeof makeColors>>

const look = (name: Name): ThemeSetArgs => ({
  colors: COLORS[name].theme,
  backdrop: { scene: `living-${name}`, glass: { blur: 18, opacity: name === 'meadow' ? 0.55 : 0.6 } },
  overrideColorScheme: name === 'meadow' ? 'light' : 'dark',
})

const LIST = NAMES.map(n => `${n} (${LABELS[n]})`).join(', ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'living', description: 'Switch the living background, or turn it off', argumentHint: '[ink|aurora|coral|lava|meadow|off]' })
    const saved = await $.store.get('scene')
    if (saved !== 'off') {
      await $.theme.set(look(isName(saved) ? saved : DEFAULT))
    }
    return next(e)
  })

  on('command.run', { command: 'living' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    const saved = await $.store.get('scene')
    if (asked === '') {
      const now = saved === 'off' ? 'off' : LABELS[isName(saved) ? saved : DEFAULT]
      return { text: `Living background: ${now}. Choose one with /living and its name: ${LIST}, or off.` }
    }
    if (asked === 'off') {
      await $.store.set('scene', 'off')
      await $.theme.clear()
      return { text: 'Living background off. /living and a name turns it back on.' }
    }
    if (!isName(asked)) {
      return { text: `There is no scene called "${asked}". Choose one of: ${LIST}, or off.` }
    }
    await $.store.set('scene', asked)
    const set = await $.theme.set(look(asked))
    return { text: set.isDrawn ? `${LABELS[asked]} is on.` : `${LABELS[asked]} is set; it shows in the Claude desktop app. (${set.reason})` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // This hook hears every mod's backdrop: draw only the ones this mod set.
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== $.plugin.name) {
      return next(e)
    }
    const { Shader, Svg } = $.ui.resolve(e)
    switch (e.props.scene) {
      case 'living-ink':
        return <Shader module="./shaders/ink.ts"><Svg source={STILLS.ink} alt={ALTS.ink} /></Shader>
      case 'living-aurora':
        return <Shader module="./shaders/aurora.ts"><Svg source={STILLS.aurora} alt={ALTS.aurora} /></Shader>
      case 'living-coral':
        return <Shader module="./shaders/coral.ts"><Svg source={STILLS.coral} alt={ALTS.coral} /></Shader>
      case 'living-lava':
        return <Shader module="./shaders/lava.ts"><Svg source={STILLS.lava} alt={ALTS.lava} /></Shader>
      case 'living-meadow':
        return <Shader module="./shaders/meadow.ts"><Svg source={STILLS.meadow} alt={ALTS.meadow} /></Shader>
      default:
        return next(e)
    }
  })
}
