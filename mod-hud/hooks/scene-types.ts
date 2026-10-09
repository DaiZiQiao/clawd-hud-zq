import type { AgentBoardEntry, HudMainFacts, ShadowAgentEntry } from '../types'
import type { Accessory, Ink } from './mascot-sprites'
import type { CollisionMode, FlightReason, Memo, Motion } from './motion-types'

// The mascot scene's shapes, shared by its modules: the scene the hooks'
// facts make (`MascotScene`), what the hooks hand the smooth scene
// (`SceneInputs`), where the layout puts everyone (`MascotPlan`), and what a
// renderer draws (`PlacedSprite`, `SceneLayer`). Types only.

/** What a subagent is doing, read from its current tool. */
export type MascotActivity = 'thinking' | 'typing' | 'reading' | 'searching' | 'lifting' | 'fetching' | 'asking'

/** A type with a letter of its own above its head (`ROLE_LETTERS`). */
export type MascotRole = 'reviewer' | 'debugger' | 'planner' | 'worker' | 'frontend' | 'explorer'

/** Energy by effort: 0 none (low, medium, unknown), 1 high, 2 xhigh or max. */
export type Energy = 0 | 1 | 2

/** A scene a reviewer or debugger plays at another agent's desk. */
export type MascotLink = { kind: 'review' | 'fix'; target: string }

export type MascotAgent = {
  id: string
  colour: string
  /** Its parent's id, when the parent is in the scene too: it then stands beside it, smaller. */
  parentId?: string
  role?: MascotRole
  /** Its type as the board names it (`worker`, `reviewer`, ...). */
  type?: string
  activity: MascotActivity
  status: 'running' | 'stalled' | 'done' | 'failed'
  /** Its energy mark, by its reasoning effort: none when unknown. */
  energy?: Energy
  /** What it wears on its air row (`accessoryOf`), and at which end (`sideOf`). */
  accessory?: Accessory
  side?: 'left' | 'right'
  /** Quiet this long with no tool running, or stalled: it does idle bits. */
  idleMs?: number
  /** Since its spawn; absent when that is unknown (an agent seeded from the engine's list). */
  ageMs?: number
  /** Since it finished, done or failed. */
  endedMs?: number
  /** A workflow agent (`mod-hud.shadows`): no letter, its colour and `wf-` name tell it. */
  workflow?: boolean
  /** Who handed it its task and takes its report: `main`, or its parent's id. */
  spawner?: string
  /** The desk it reviews or fixes. */
  link?: MascotLink
  /** A finished workflow agent's next running squad-mate, who takes over. */
  squadNext?: string
  /** How long its calls have been only Read, Grep and Glob (its reading streak), while running. */
  readingMs?: number
  /** Arriving with others spawned within two seconds of the first: one pipe for them all; absent, a pipe of its own. */
  pipe?: PipeShare
}

/**
 * A pipe several newcomers share (`pipeBatch`): the batch's first, over whose
 * slot it hangs; this one's spawn after the first's; and, in ms after the
 * first's spawn, when this one drops out and when the pipe goes back up.
 */
export type PipeShare = { anchor: string; after: number; drop: number; up: number }

/** The session's own mascot. */
export type MascotMain = {
  /** Idle with nothing running (idle bits, then the blanket); thinking while the main loop works alone; watching while subagents run. */
  mood: 'idle' | 'thinking' | 'watching'
  /** How long the main loop has been idle, while idle. */
  idleMs?: number
  /** The context is at least 85 % full. */
  sweating: boolean
  /** Since the last compaction, while the stretch lasts. */
  stretchMs?: number
  /** Its energy mark, by the session's effort. */
  energy?: Energy
  /** Tidying up: a compaction of the main conversation running this long (it squashes a pile of pages beside it). */
  tidyMs?: number
}

/** A message between two mascots: a bubble that travels from one to the other. */
export type SceneEvent = { kind: 'message'; from: string; to: string; tick: number }

/** Everything the scene draws: the session's mascot and the subagents', in spawn order. */
/** Who the mascots are: Clawd (the default), or Usagi (the `character` option). */
export type Character = 'clawd' | 'usagi'

/**
 * Which mascots a scene holds: the session's alone (`main`, the band above
 * the prompt) or the agents' alone (`agents`, the pane under a band that has
 * the session's); absent, all of them.
 */
export type SceneCast = 'main' | 'agents'

/**
 * The scene: the session's mascot, the agents', the messages between them,
 * and who they all are (absent, Clawd); `withoutMain`, the session's mascot is
 * elsewhere (the band) and the field leaves it out.
 */
export type MascotScene = { main: MascotMain; agents: MascotAgent[]; events?: SceneEvent[]; character?: Character; withoutMain?: true }

/**
 * The room the scene is drawn into: the rows the HUD and the list leave, and
 * the tick it shows; `wander` lets mascots roam the line between tools and
 * `scenes` plays the orchestration scenes. Both are off unless asked for.
 */
export type MascotLayout = {
  columns: number
  rows: number
  tick: number
  wander?: boolean
  scenes?: boolean
  collisions?: CollisionMode
  /**
   * `smooth`: the `Client` surface's scene (flights asked by real signals, the
   * ground packed a cell a frame); `classic` (the default) the Box/Text one.
   */
  motion?: 'classic' | 'smooth'
  /** Mascots out of the choreography this frame (held or thrown by the person): no mover, no scene's target. */
  held?: readonly string[]
  /** The mascot grown into the TV (hooks/tv-model.ts): out of the choreography, and not drawn. */
  away?: string
  /** Back from the TV this long ago (ms), within STARTLED_MS: shaken. */
  startled?: { id: string; ms: number }
}

export type SceneOptions = {
  /** A running agent quiet this long is stalled (the board's own setting). */
  stalledMs?: number
  /** The main loop's activity: when it started or stopped working, and its last compaction. */
  main?: HudMainFacts
  /** Workflow agents (`mod-hud.shadows`): more agents, those shown in the list. */
  shadows?: readonly ShadowAgentEntry[] | Readonly<Record<string, ShadowAgentEntry>>
  /** Play the orchestration scenes: their frames lengthen a finished agent's stay. */
  scenes?: boolean
  /** Messages sent between agents, by scene frame. */
  events?: readonly SceneEvent[]
  /** What the agents left out of the smooth scene's props settled (`SceneHistory`): read in place of working it out again. */
  history?: SceneHistory
  /** Who the mascots are: Usagi, else Clawd. */
  character?: Character
  /** The session's mascot alone, or the agents' alone (SceneCast); absent, all of them. */
  only?: SceneCast
  /** A compaction of the main conversation running since then (`mod-hud.tidy`): the session's mascot tidies up. */
  tidyingSince?: number
}

/**
 * What the agents before them settled for the agents the smooth scene's props
 * carry, worked out by the hooks over the whole board: the props leave out
 * agents finished a while ago, which still decide each one's accessory (what
 * those present at its spawn wore), the parents it knows, and whether a
 * debugger came after a review.
 */
export type SceneHistory = {
  /** Each agent's accessory, by id. */
  worn: Record<string, Accessory>
  /** Parents on the board that the props leave out. */
  known: string[]
  /** The debuggers spawned soon after a reviewer finished. */
  fixes: string[]
}

/** A board entry as the scene reads it: the rest (its task, its answer) stays in the hooks. */
export type SceneActorInput = Pick<AgentBoardEntry, 'id' | 'type' | 'startedAt' | 'lastActivityAt' | 'status'>
  & Partial<Pick<AgentBoardEntry, 'parentId' | 'endedAt' | 'currentTool' | 'awaitingPermission' | 'effort' | 'readingSince'>>

/** A shown workflow agent as the scene reads it. */
export type SceneShadowInput = Pick<ShadowAgentEntry, 'id' | 'firstSeen' | 'lastSeen' | 'steps' | 'toolCalls' | 'status'>
  & Partial<Pick<ShadowAgentEntry, 'visibleAt' | 'endedAt' | 'currentTool' | 'effort' | 'readingSince'>>

/**
 * The smooth scene's props (`Client` `props`): plain data, handed on each of
 * the hooks' redraws (the pane's one-second tick and every change it reads).
 * Everything the scene is made of (the board, the workflow agents shown, the
 * HUD's few facts it reads, the main loop's, the messages), the options and
 * the room; the time it was drawn at, which the surface's own frame clock runs
 * on from.
 */
export type SceneInputs = {
  now: number
  columns: number
  rows: number
  agents: SceneActorInput[]
  shadows: SceneShadowInput[]
  hud: { contextPercent?: number; effort?: string; startedAt?: number; toolRunning?: boolean }
  main: HudMainFacts
  events: SceneEvent[]
  /** What the agents left out settled for those carried. */
  history?: SceneHistory
  stalledMs: number
  wander: boolean
  scenes: boolean
  collisions: CollisionMode
  /** Clicking a mascot inspects it (the `inspect` option). */
  inspect: boolean
  /** Retained during inspect: no drawing, pointer or frame work until Back. */
  paused?: boolean
  /**
   * The surface draws the scene in pixels, an `Svg` (the desktop, whose text
   * is no grid of equal cells); absent, as rows of text (the terminal).
   */
  svg?: true
  /** Usagi for the mascots (the `character` option); absent, Clawd. */
  character?: 'usagi'
  /** The mascot grown into the TV: not drawn, out of the choreography, its place kept. */
  away?: string
  /** The mascot back from the TV, and when (the hooks' clock): shaken for STARTLED_MS. */
  startled?: { id: string; at: number }
  /** The session's mascot alone (the band), or the agents' alone (the pane under it); absent, all of them. */
  only?: SceneCast
  /** A compaction of the main conversation running since then: the session's mascot tidies up. */
  tidyingSince?: number
}

/** Where an agent is in its life, at this tick. */
export type Phase =
  /** Arriving by the pipe: inside it, then dropping out of its mouth to its floor. */
  | { kind: 'arrive'; step: number }
  /** Delegation: it takes its task from its spawner (scenes only). */
  | { kind: 'take'; step: number }
  /** Start of work: 0 it turns to its desk, 1 and 2 at its laptop. */
  | { kind: 'setup'; step: number }
  | { kind: 'work' }
  | { kind: 'stalled' }
  /** Done or failed: 0 and 1 at its laptop, 2 the laptop gone (done only). */
  | { kind: 'pack'; step: number }
  /** Hand back (scenes only): walking to its spawner, then handing over. */
  | { kind: 'deliver'; step: number }
  | { kind: 'hand'; step: number }
  /** A workflow agent handing on (scenes only). */
  | { kind: 'baton'; step: number }
  /** The cheer's dance, frame by frame. */
  | { kind: 'cheer'; step: number }
  | { kind: 'sit' }
  /** Leaving by the pipe: it comes down over it, sucks it up, goes. */
  | { kind: 'leave'; step: number }

/** A momentary gesture a scene asks of a mascot this frame. */
export type Cue =
  | 'give-scroll'
  | 'take-report'
  | 'take-baton'
  | 'nod'
  | 'glance'
  | 'point'

/**
 * One drawn cell: its glyph, its ink and the colour `b` or `k` resolves to;
 * `bg`, a raw colour under the glyph, for a cell of two colours (Usagi's
 * face: its every quarter drawn, the glyph's in its ink, the rest in `bg`);
 * `hat` for a crown, accessory, cap or energy cell.
 */
export type Cell = { ch: string; ink: Ink; colour: string; bg?: string; hat?: true }
export type Grid = (Cell | undefined)[][]

/** One mascot, the strip or the session's own, where the layout put it. */
export type Placement = {
  id: string
  kind: 'main' | 'full' | 'mini' | 'strip'
  /** Its slot: its left column, and its depth. */
  x: number
  slotD: number
  /** Where it is this tick: its column and depth (its slot, wandering, on an errand, set down elsewhere). */
  drawnX: number
  d: number
  /** Its cells across: a full mascot's slot (its box, and its laptop's or thought's place), a mini, the strip. */
  width: number
  /** Its body's cells across, from its left column: a full mascot's box. */
  body: number
  phase?: Phase
  /** The strip's text, and the agents its dots stand for, in order. */
  text?: string
  dots?: string[]
  /** How it moves this frame, which way it faces, and the gestures a scene asks of it. */
  motion?: Motion
  facing?: 'left' | 'right'
  cues?: Cue[]
  /** Rows above its floor, in a hop or a flight. */
  lift?: number
  /** The smooth scene: why it flies, when it does, and the frame a loop of its flight began. */
  flight?: FlightReason
  loop?: number
}

/** A one-cell mark a scene lays on the canvas: a message's bubble, a stamp, sparks. `row` counts from the back row's box top (its air row). */
export type Mark = { x: number; row: number; ch: string; ink: Ink; colour: string }

/** A place in the field: what stands there, its left column and depth, its cells across and its body's. */
export type Slot = { kind: Placement['kind']; x: number; d: number; width: number; body: number }

/** Where everything stands at this tick, and who folded into the strip. */
export type MascotPlan = {
  /** The field's rows of floor, back to front. */
  depth: number
  placements: Placement[]
  collapsed: string[]
  tick: number
  columns: number
  /** Each one's slot, kept while it is in the scene (a resize lays them out afresh). */
  slots: ReadonlyMap<string, Slot>
  /** The field was full: its back row holds minis. */
  minis: boolean
  /** Where each leaving one stands while the pipe takes it, kept until sceneOf drops it. */
  exits: ReadonlyMap<string, Slot>
  /** Each settled mascot's position (column and depth) and intent, carried to the next frame. */
  memo: ReadonlyMap<string, Memo>
  /** Spare rows above the back row's box: the sky. A mascot at depth d has `headroom + d` rows over its box. */
  headroom: number
  marks: Mark[]
  wander: boolean
  scenes: boolean
  collisions: CollisionMode
  /** The frame each pair of mascots last collided, kept for the cooldown. */
  contacts: ReadonlyMap<string, number>
  /** The smooth scene's rules were in play (MascotLayout.motion). */
  smooth?: boolean
  /** Set down by the person away from its place: walking back to its slot (a mascot that does not wander). */
  homing?: ReadonlySet<string>
}

/** The pipe over a mascot this frame: its left column, its kind (a full mascot's or a mini's) and its lip's row (from the back row's box top, to the fraction). */
export type PlacedPipe = { x: number; kind: 'full' | 'mini'; lip: number }

/**
 * One sprite where the plan put it, renderer-agnostic: its grid of cells (a
 * mascot's sky row and box; the strip's four rows), its left column, the
 * canvas row of its grid's first row (counted from the back row's box top;
 * negative is the sky above it), its depth, and the cell a pick lands on (an
 * agent's, between its feet).
 */
export type PlacedSprite = {
  id: string
  kind: Placement['kind']
  /** Its depth, to the fraction in the smooth scene's glide: sprites are painted back to front. */
  d: number
  x: number
  top: number
  cells: (Cell | undefined)[][]
  /** On the move: drawn after the settled ones at its depth. */
  moving: boolean
  pick?: { x: number; row: number }
  /** In the person's hand or thrown: drawn last, anywhere in the canvas. */
  free?: boolean
  /**
   * Where the smooth scene's view has it to the fraction of a cell (its left
   * column, its top row): what a surface drawing pixels draws at; `x` and
   * `top` are those rounded to the cell, as a text row draws it.
   */
  exact?: { x: number; top: number }
  /** In the person's hand (`dangle`) or falling (`tumble`), as the view says. */
  pose?: 'dangle' | 'tumble'
  /** Inside the pipe at and above this row (counted as `top`): those of its cells are not drawn. */
  clip?: number
}

/**
 * How the smooth scene shows one mascot between the plan's frames: where it
 * is (its left column, depth and lift, fractional: drawn at the nearest
 * cell), how it moves and faces, and the person's touches (held, thrown, a
 * wobble, scanning).
 */
export type SpriteView = {
  x?: number
  d?: number
  lift?: number
  motion?: Motion
  facing?: 'left' | 'right'
  pose?: 'dangle' | 'tumble'
  kick?: number
  nudge?: -1 | 1
  scanning?: boolean
  /** Not drawn this frame (gone). */
  hidden?: boolean
}

/** The smooth scene's frame: the overrides by id over the plan's placements. */
export type SceneView = ReadonlyMap<string, SpriteView>

/**
 * One sprite, pipe or mark as a surface drawing pixels lays it
 * (hooks/scene-svg.ts): the cells the canvas shows of it (none another
 * sprite covers, none past the room's edges), at its place in the canvas's
 * cells from the top-left, to the fraction of a cell in the smooth scene.
 * Mascots carry their id and kind; a pipe `pipe`; a mark neither.
 */
export type SceneLayer = {
  x: number
  y: number
  cells: (Cell | undefined)[][]
  id?: string
  kind?: Placement['kind']
  pose?: 'dangle' | 'tumble'
  pipe?: true
}
