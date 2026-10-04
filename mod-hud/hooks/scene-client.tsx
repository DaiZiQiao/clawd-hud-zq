import type { ClientElements, ClientModule, ElementConstructor, JsonValue, RenderElement, SvgProps } from 'claude-code'

import { sceneCanvas } from './scene-canvas'
import { renderCanvas } from './scene-render'
import { sceneAlt, sceneSvg } from './scene-svg'
import type { SceneSvg } from './scene-svg'
import type { SceneInputs } from './scene-types'
import { layoutAt, sceneAt, viewOf } from './scene-view'
import { FRAME_MS, createWorld, pointer, receive, tick } from './scene-world'
import type { World } from './scene-world'

// The mascot scene as a `Client` surface module: it runs on the surface's
// own frame clock, keeps every bit of motion in its local state, and takes
// the person's pointer: a click inspects a mascot, a press lifts one up to
// drag and throw. The hooks hand it the scene's inputs as props on each of
// their redraws and hear from it only when a click asks to inspect.
//
// Two clocks: the choreography (hooks/motion-arbitrate.ts, through
// `mascotPlan`) steps in its 250 ms frames, a frame ahead of the drawing,
// which glides between the two at FRAME_MS (sub-cell positions, drawn at the
// nearest cell; hooks/scene-view.ts); the person's bodies
// (hooks/motion-physics.ts) step at FRAME_MS (hooks/scene-world.ts).
// docs/mascots.md, "Physics and controls".

type State = { world: World; frame: number; drawing?: string; stopEvery?: () => void }

/** What the module draws with: its table's Box and Text, and `Svg` where the table has it. */
export type SceneElements = Pick<ClientElements, 'Box' | 'Text'> & { Svg?: ElementConstructor<SvgProps> }

/**
 * `Svg` where the table hands it out; else the plain element itself, which
 * the surface's own table validates (the desktop's has `Svg`; the module's
 * table, typed as the terminal's, does not carry its constructor).
 */
const svgOf = (elements: SceneElements): ElementConstructor<SvgProps> => elements.Svg ?? (props => h('Svg', props) as RenderElement)

/**
 * The scene in pixels: the `Svg` the region's size, and over it a box as big
 * with nothing in it, the region's hit layer. The desktop draws an `Svg` as an
 * image, and a press on an image starts the page's own drag of it, which
 * takes the pointer's moves and its release from the region: the layer over it
 * is what the press lands on, so the region's `onPointer` hears the whole
 * gesture; whose mascot was pressed still comes from the frame's cells.
 */
const pixelsOf = (elements: SceneElements, drawn: SceneSvg, room: { columns: number; rows: number }): RenderElement => {
  const { Box } = elements
  const Svg = svgOf(elements)

  return (
    <Box key="scene" width={room.columns} height={room.rows} flexShrink={0}>
      <Svg source={drawn.source} alt={drawn.alt} width={drawn.width} height={drawn.height} />
      <Box position="absolute" top={0} left={0} width={room.columns} height={room.rows} />
    </Box>
  )
}

/**
 * The frame drawn: the scene at its time, every row of the region, whose
 * sprite owns each cell kept for the pointer. As rows of text (the terminal),
 * or, where the hooks say the surface draws pixels (`svg`, the desktop) or
 * the table has `Svg`, as one `Svg` the region's size under a hit layer
 * (`pixelsOf`): each sprite at its unrounded place, so a move glides by the
 * pixel.
 */
export const draw = (world: World, elements: SceneElements): RenderElement => {
  if (world.props.paused === true) {
    const { Box } = elements
    return <Box key="scene" height={0} />
  }
  const plan = world.cur
  const pixels = world.props.svg === true || elements.Svg !== undefined
  const room = { columns: world.props.columns, rows: Math.max(1, world.props.rows) }
  const blank = (): RenderElement => {
    if (!pixels) return renderCanvas(elements, Array.from({ length: room.rows }, () => []), 'scene')

    return pixelsOf(elements, sceneSvg([], room, sceneAlt(sceneAt(world, world.sceneNow), [])), room)
  }
  if (plan === undefined) return blank()
  const view = viewOf(world)
  const scene = sceneAt(world, world.sceneNow)
  const canvas = sceneCanvas(scene, layoutAt(world, plan.tick), plan, view.sprites)
  world.owners = canvas?.owners
  if (canvas === undefined) return blank()
  if (!pixels) return renderCanvas(elements, canvas.grid, 'scene')

  return pixelsOf(elements, sceneSvg(canvas.layers, room, sceneAlt(scene, canvas.layers, plan.collapsed.length)), room)
}

/** The surface module: the scene on its own frame clock, the person's pointer, and a post when a click inspects. */
const SceneClient: ClientModule<JsonValue, State> = (props, surface) => {
  const inputs = props as unknown as SceneInputs
  let state = surface.state
  if (state === undefined) {
    const world = createWorld(inputs)
    state = { world, frame: 0 }
    surface.onPointer(event => {
      const held = surface.state
      if (held === undefined) return
      if (pointer(held.world, event, data => surface.post(data))) surface.setState({ ...held, frame: held.frame + 1 })
    })
    surface.setState(state)
  }
  receive(state.world, inputs)
  if (inputs.paused === true) {
    state.stopEvery?.()
    state.stopEvery = undefined
  } else if (state.stopEvery === undefined) {
    state.stopEvery = surface.every(FRAME_MS, () => {
      const held = surface.state
      if (held === undefined || held.world.props.paused === true) return
      tick(held.world)
      const drawing = JSON.stringify(draw(held.world, surface.elements))
      if (drawing !== held.drawing) surface.setState({ ...held, frame: held.frame + 1, drawing })
    })
  }
  const rendered = draw(state.world, surface.elements)
  state.drawing = JSON.stringify(rendered)

  return rendered
}

export default SceneClient
