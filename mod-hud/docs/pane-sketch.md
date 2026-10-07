# mod-hud: pane HUD sketch

The HUD is the block at the top of the `hud` pane, above the agent
list. `renderHud()` in `hooks/hud.tsx` draws it from one `HudData` value.
Every sketch below is the renderer's own output (`hudLines()`) for the
fixtures in `hooks/hud.fixtures.ts`, in UTC. The `full` fixture is:
- opus 5.5 at xhigh effort through a gateway, 72 minutes in, $4.21 spent;
  the main loop working for 42 s
- two subagents waiting on a permission ask
- 412k of a 1M context window used, growing 65k a turn, auto-compaction at
  800k
- 5h limit at 31 % (up from 11 % 35 minutes ago, so it runs out at ~13:43,
  before its 14:20 reset), 7d limit at 12 %
- `main` dirty (3 paths added, 1 deleted), 2 commits ahead
- `npm test -- hud` running in Bash for 4 s; 7 files edited this
  conversation (its five-item todo list is drawn by the TODO section under
  the HUD, below)

The sketches leave the motto out: since 1.2.0 the `motto` option defaults to
empty. A motto set is drawn dim and italic as the HUD's last row.

## Wide: 60 columns and up (shown at 72)

```
◆ opus 5.5 · xhigh · gateway          ● working 00:42   1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M     compact in ~6 turns
  5h    ━━──────  31% ↻14:20    7d  ━───────  12% ↻Tue
  now   Bash  npm test -- hud                   00:04 · 7 files edited
```

Row by row:
- **Identity.** The model, effort and provider, then three right-hand
  cells: the main loop `● working 00:42` (the accent; how long this turn
  has run) or `○ idle 3m` (dim; how long since it stopped), the session's
  age, and its cost. Working/idle is read from the main loop's facts, kept
  with mascots on; nothing shows before either is known. When the row runs
  short the provider gives way first, then the working cell, then the
  effort.
- **Alerts** (`⚠`). Drawn only while something needs attention; otherwise
  the row is not there at all. The alerts, most severe first, joined by
  ` · ` and cut to the card with `…`:
  1. `N agents waiting for permission`: running subagents with a lingering
     permission ask (`error`).
  2. `5h out ~13:43, before ↻14:20`: a window whose burn over the last 30
     minutes reaches 100 % before it resets (`error`; the 7d and spend
     windows the same).
  3. `N agents stalled`: running subagents and workflow agents quiet past
     `stalledAfterSec` (`warning`).
  4. `compact in ~N turns`: the context compacts within three turns
     (`warning`).
  5. `N calls denied or failed`: tool calls, in any loop, that ended denied
     or in an error this conversation, from the ledger (dim `warning`).
  6. `↓3 behind`: the branch is behind its upstream (dim `warning`).

  The `⚠` takes the colour of the most severe.
- **Place.** The path, the branch and its marks.
- **ctx.** The bar marks the auto-compact threshold with a dim `┃` when the
  context breakdown names one below the window. After the token counts,
  `compact in ~N turns`: the turns until the context reaches that threshold
  (else the window) at its mean growth over the last ten main turns. With no
  growth known it shows the compaction count, as before.
- **Limits.** Wide, the 5h and 7d windows share one row: 8-cell bars, the
  resets tight against their percent (`↻14:20`), the 7d half always starting
  at the same column. A spend limit keeps a 20-cell gauge of its own. With
  only one of the 5h and 7d windows known, it takes its own 20-cell gauge.
- **now.** The main loop's tool running now and its main argument (a path
  from `~`, losing its leading directories first; a command or pattern cut
  with `…`), its elapsed time, and `N files edited`: the distinct
  `file_path`/`notebook_path` of the main loop's Edit, Write, MultiEdit and
  NotebookEdit calls that ended ok (starts over at `/clear`). Between tools
  it reads `—` with the count; with neither, no row. `showTools` switches it
  off.

The token and cache rows, the per-tool counts (`tools Read ×41 …`) and the
MCP/skill counts are no longer drawn. The Session tab's Overview has the
tokens; `/mod-hud facts` has the tool counts and the inventory.

The HUD is a card at most 72 cells wide. On a 100-column pane it draws
exactly as at 74: the right-hand cells stay next to what they describe
instead of drifting to the far edge. At 74 the whole card fits beside the
close button's reserve:

```
◆ opus 5.5 · xhigh · gateway            ● working 00:42   1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M       compact in ~6 turns
  5h    ━━──────  31% ↻14:20    7d  ━───────  12% ↻Tue
  now   Bash  npm test -- hud                     00:04 · 7 files edited
```

At 60, the narrowest wide layout, the provider and the runway give way, the
alerts are cut, and every right-aligned cell stops two cells short of the
pane's edge (see "Close button" below):

```
◆ opus 5.5 · xhigh        ● working 00:42   1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before…
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M
  5h    ━━──────  31% ↻14:20    7d  ━───────  12% ↻Tue
  now   Bash  npm test -- hud       00:04 · 7 files edited
```

The context full and the limits hot (`fullContext`). Bars below 60 % are
`success`, 60 to 84 % `warning`, and 85 % and up `error`. With no growth
samples the runway is unknown and the compaction count stands in; a spend
limit gets its own gauge:

```
◆ opus 5.5 · xhigh · gateway            ● working 00:42   1h 12m   $4.21
  ⚠ 2 agents waiting for permission
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━━━━━━━━━━━━━┃━━━ 100%  1.0M / 1.0M             3 compactions
  5h    ━━━━━━━─  92% ↻14:20    7d  ━━━━━───  64% ↻Tue
  spend ━━━━━━━━━━━━━━━━━───  85%  ↻ Nov 1
  now   Bash  npm test -- hud                     00:04 · 7 files edited
```

Everything at once (`alarmed`, at 74): the main loop idle three minutes, a
stalled agent, a compaction two turns off, three failed calls and the branch
three behind. The strip is cut to the card; the least severe go first:

```
◆ opus 5.5 · xhigh · gateway                  ○ idle 3m   1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20 · 1…
  ~/.claude/mods · main* +3 −1 ↑2 ↓3
  ctx   ━━━━━━━━━━━━━━──┃───  70%  700k / 1.0M       compact in ~2 turns
  5h    ━━──────  31% ↻14:20    7d  ━───────  12% ↻Tue
  now   Bash  npm test -- hud                     00:04 · 7 files edited
```

Nothing needing attention (`calm`): no alert row at all.

```
◆ opus 5.5 · xhigh · gateway            ● working 00:42   1h 12m   $4.21
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━━━━━────────┃───  41%  412k / 1.0M       compact in ~6 turns
  5h    ━━──────  31% ↻14:20    7d  ━───────  12% ↻Tue
  now   Bash  npm test -- hud                     00:04 · 7 files edited
```

## Narrow: below 60 columns, at 56

The narrow layout is the wide one stacked: every section the wide layout
shows, in the same order, one per row, the 5h and 7d windows each a gauge of
its own. The bars are 10 cells and the token count reads `412k/1.0M`:

```
◆ opus 5.5 · xhigh    ● working 00:42   1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~13:43, be…
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━────┃─  41%  412k/1.0M
  5h    ━━━───────  31%  ↻ 14:20
  7d    ━─────────  12%  ↻ Tue
  now   Bash  npm test -- hud   00:04 · 7 files edited
```

Right-hand cells (the runway, the elapsed time and files edited) end where
the identity row ends, two cells short of the edge, so they line up in one
column and the close button stands alone.

## Narrow at 48

Here the working cell would leave the model and its effort too little room,
so it gives way; with it gone the provider fits again. The `now` row's
argument is cut to what is left beside its right-hand cells:

```
◆ opus 5.5 · xhigh · gateway    1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~1…
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━━────┃─  41%  412k/1.0M
  5h    ━━━───────  31%  ↻ 14:20
  7d    ━─────────  12%  ↻ Tue
  now   Bash  npm te…   00:04 · 7 files edited
```

## Narrow at 40

Below 44 columns the bars are 8 cells. The provider gives way first, then
the effort; an argument with fewer than four cells left goes:

```
◆ opus 5.5 · xhigh      1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5…
  ~/.claude/mods · main* +3 −1 ↑2
  ctx   ━━━───┃─  41%  412k/1.0M
  5h    ━━──────  31%  ↻ 14:20
  7d    ━───────  12%  ↻ Tue
  now   Bash    00:04 · 7 files edited
```

## Narrow at 36

At 36 columns and under there is no room for a bar worth reading: the
gauges keep their label and right-aligned percent. With no room for its
right-hand cells beside the tool, the `now` row keeps the argument instead:

```
◆ opus 5.5          1h 12m   $4.21
  ⚠ 2 agents waiting for permission…
  ~/.claude/mods · main* +3 −1 ↑2
  ctx    41%  412k/1.0M
  5h     31%  ↻ 14:20
  7d     12%  ↻ Tue
  now   Bash  npm test -- hud
```

A long branch and motto at 48 (`longBranch`). The path gives way first, the
branch keeps at least eight cells, and free text ends in `…`:

```
◆ opus 5.5 · xhigh · gateway    1h 12m   $4.21
  ⚠ 2 agents waiting for permission · 5h out ~1…
  …/mods · feature/very-long-branch-n…* +3 −1 ↑2
  ctx   ━━━━────┃─  41%  412k/1.0M
  5h    ━━━───────  31%  ↻ 14:20
  7d    ━─────────  12%  ↻ Tue
  now   Bash  npm te…   00:04 · 7 files edited
  a motto long enough to run past the edge of e…
```

## Sparse and early states

A session twelve seconds old, with a model and a clock and nothing
measured yet, is two rows. Nothing prints a zero for a fact that has not
arrived. `ctx —` holds the context's place until the first response:

```
◆ opus 5.5 · xhigh                                         00:12   $0.00
  ctx   —
```

Each missing fact removes only its own row or cell, wide and narrow alike:
- Nothing needing attention: no alert row.
- No rate-limit data: no limits or spend row.
- No git: the place row is just the path.
- No auto-compact threshold (or the breakdown not read): no `┃`, and the
  runway runs to the window. No context growth: no runway.
- No tool running and no file edited: no `now` row. No main-loop activity
  known: no working/idle cell. No todos: no TODO section.
- No data at all: the HUD draws nothing and the agent list stands alone.
  A motto is the HUD's last row, never a HUD of its own: with nothing
  else known it is not drawn either.

`/mod-hud facts` prints the `HudData` the HUD is drawing from as JSON (the
alert counts under `alerts`, the main loop's activity under `main`, the tool
counts and the inventory included), with the workflow agents' record
(`shadows`), the ledger's summary (`ledger`: each model's estimated cost and
tokens, the loops counted, the failed calls) and the lists' expansion
(`listView`), each left out while empty, and says whether the last
`session.measure` carried any rate limits. Use it when a row you expect is
missing.

## TODO

The main conversation's todo list is a section of its own between the HUD
and the agents, one blank row above and below. Folded (the default) it is
one line: a `▸` Button (dim), `TODO` bold, a bar of the items done (10 cells;
8 below 44 columns, none at 36 and under; the fill `success`, the track
dim), `done/total`, then the item in progress (its active form, `◐` in the
accent), else the next pending (`☐`), cut to the pane with `…`. Seven
items, three done, one in progress (`sevenTodos`), at 72 and 48 columns:

```
▸ TODO  ━━━━────── 3/7  ◐ Wiring the detail view
```

A press on `▸` opens it (`mod-hud.listView.todosExpanded`, written on a
press only, like the lists' expansion): the line turns `▾`, drops the item
after the count, and lists every item under it, one per row, two cells in.
In progress first, then pending (`☐`), then completed (`☑`, the whole row
struck through and dim). At most `todoRows` items (6 by default), then a dim
`+n more`. `▾` folds it again:

```
▾ TODO  ━━━━────── 3/7
  ◐ Wiring the detail view
  ☐ Test the scenes
  ☐ Update the sprite sheet
  ☐ Sketch the pane at 72 and 48 columns
  ☑ Read the brief
  ☑ Split the sprites out
  +1 more
```

At 48 the rows are the same, each cut to the pane. No todos (or `showTodos`
off): no section. Its rows count like the agent list: they never shrink the
HUD, and the mascot scene gets what is left.

## Status line (opt-in helper)

`statusLineText(data)` returns plain text. Segments are joined by ` │ `,
absent facts are dropped, and the result is at most 100 characters; the
last segments give way first (todo, then git, then cost). `⚠ n` counts the
alert strip's alerts, right after who, when there are any. The caller
appends its agents summary. The pane is the HUD's real surface; this line
is only for a caller that opts in.

```
opus 5.5 · xhigh │ ⚠ 2 │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5
```

## Inspect view (click to inspect)

Each agent row's `▸`, each mascot (a click in the smooth scene, the `▾` pick
in the classic one) and the session's own row (`▸◆ Session`, above the
Agents header; the crowned mascot's click posts `{ kind: 'inspect', id:
'main' }`) selects it (`mod-hud.selected`: `{ id, kind, tab? }`, written only
on a press, or when the selected agent leaves the board and the workflow
record). The view then takes the pane under the HUD: the TODO section, the
lists and the scene give way (the smooth scene's `Client` stays mounted,
paused, at no height, so its bodies are kept until Back). It draws every
row it has; a view taller than the pane scrolls with the pane's own scroll.

- **Header:** `◂ Back` (an inline Button, not the pane's close control),
  three blanks, the status glyph, the name (bold, its mascot's colour), then
  dim ` · `-joined facts: model, effort (as its last `turn.step` named it),
  status, elapsed time, calls. Below 60 columns the facts take a row of
  their own, two cells in.
- **Tabs:** a row of Buttons. The active one is a primary Button, which the
  terminal draws `[ Task ]` in the accent; the others are plain and dim,
  three cells apart (two after the active one). A press writes the tab
  into `selected`; pressing the active tab writes nothing.
- **Keyboard:** with the pane focused (ctrl+x tab, or a click), Tab walks
  the Buttons and Enter presses one. `[`, `]` and Esc cannot be bound: a
  Button's `hotkey` is one digit or one lowercase letter, and Esc never
  reaches a pane (it hands the keys back to the prompt). Back is the way
  out.

An agent's tabs: **Task**, **Trail**, **Said**, **Agents**.

- **Task:** the description (bold), then the prompt it was given (the first
  user message of its conversation, at most 8,000 characters), its
  paragraphs kept, wrapped to the pane; a long word breaks across rows.
  A workflow agent has neither: a dim note says so.
- **Trail:** every call held (`mod-hud.trails`: 200 an agent, 800 in all,
  the oldest of other agents going first past that), the newest last. Each
  call: its start time, how long it took, how it ended (`ok`, `denied` in
  `warning`, `error` in `error`), then the tool and its main argument (at
  most 160 characters) wrapped under it. The current call (open, its agent
  running) reads `now` with its time so far, in the accent; an open call of
  an agent no longer running reads `?`. One full write as each call starts;
  one as it ends only if its open entry is still held, none per tick. The
  engine's state contract has `get`/`set`, not a patch operation, so the end
  cannot patch just one entry. Below 60 columns a call that does not fit
  its row puts its argument on rows of its own, two cells in.
- **Said:** a subagent's last ten assistant messages (each at most 2,000
  characters), wrapped, a blank row between, the newest at the bottom; a
  workflow agent's conversation is not exposed, so a dim note says so.
- **Agents:** the lists, as under the HUD. A row's `▸` there jumps to that
  agent on the same tab.

The conversation (`mod-hud.detail`: the prompt and the last ten messages) is
read with `$.session.messages({ agentId })` when a subagent is newly
selected, when its Task or Said tab opens and none is held for it, and at
each of that agent's turn ends; never per frame, never for a workflow agent
or the session. A late read is ignored if another agent was selected or the
selection cleared.

At 72 columns, a frontend agent seven minutes in, eight calls made, one
failed, one denied and one running (real mounted output, under the HUD):

```
◂ Back   ● frontend · opus-5-5 · high · running · 6m56s · 8 calls
[ Task ]  Trail   Said   Agents

Desktop: draw mascots in pixels, keep the terminal rows

Draw the mascots in pixels on the desktop: one Svg per frame, a rect per
cell.

Keep the terminal's rows exactly as they were and prove it: record a
hash of the tree before and after.
```

```
◂ Back   ● frontend · opus-5-5 · high · running · 6m56s · 8 calls
Task   [ Trail ]  Said   Agents

12:07:41   0.4s ok     Read /work/hooks/scene-client.tsx
12:07:42   0.2s ok     Grep surface.post
12:07:42   0.3s ok     Read /work/hooks/scene-svg.ts
12:07:42   0.6s ok     Edit /work/hooks/scene-svg.ts
12:07:43    41s error  Bash claude plugin test
                       /work/.claude/mods-staging/mod-hud --reporter
                       dots --bail
12:08:24   0.5s ok     Edit /work/hooks/scene-svg.ts
12:08:24   0.1s denied Bash rm -rf /work/.cache
12:08:24    12s now    Bash claude plugin test .
```

```
◂ Back   ● frontend · opus-5-5 · high · running · 6m56s · 8 calls
Task   Trail   [ Said ]  Agents

Reading the scene module first: the Client draws Text rows today.

The desktop now draws an Svg, one rect per cell, from the same grid the
terminal draws.

Tests: the hash of the terminal tree is unchanged; one desktop test
fails on a rounding error, fixing it now.
```

```
◂ Back   ● frontend · opus-5-5 · high · running · 6m56s · 8 calls
Task   Trail   Said   [ Agents ]

▸◆ Session
▾ Agents · 2 running · 5 done · 1 stalled · workflow 3 running
▸● frontend         opus-5-5     6m56s 8 calls    Bash  Desktop: draw …
▸◌ reviewer         sonnet-5-5   6m56s 0 calls    thinking  Review the…
▸✓ Explore          haiku-4-5      20s 0 calls    Find the pane props …
…
```

At 48 the header stacks and the rest wraps to the pane:

```
◂ Back   ● frontend
  opus-5-5 · high · running · 6m56s · 8 calls
[ Task ]  Trail   Said   Agents

Desktop: draw mascots in pixels, keep the
terminal rows

Draw the mascots in pixels on the desktop: one
Svg per frame, a rect per cell.

Keep the terminal's rows exactly as they were
and prove it: record a hash of the tree before
and after.
```

```
◂ Back   ● frontend
  opus-5-5 · high · running · 6m56s · 8 calls
Task   [ Trail ]  Said   Agents

12:07:41   0.4s ok     Read
  /work/hooks/scene-client.tsx
12:07:42   0.2s ok     Grep surface.post
12:07:42   0.3s ok     Read
  /work/hooks/scene-svg.ts
12:07:42   0.6s ok     Edit
  /work/hooks/scene-svg.ts
12:07:43    41s error  Bash
  claude plugin test
  /work/.claude/mods-staging/mod-hud --reporter
  dots --bail
12:08:24   0.5s ok     Edit
  /work/hooks/scene-svg.ts
12:08:24   0.1s denied Bash rm -rf /work/.cache
12:08:24    12s now    Bash claude plugin test .
```

```
◂ Back   ● frontend
  opus-5-5 · high · running · 6m56s · 8 calls
Task   Trail   [ Said ]  Agents

Reading the scene module first: the Client draws
Text rows today.

The desktop now draws an Svg, one rect per cell,
from the same grid the terminal draws.

Tests: the hash of the terminal tree is
unchanged; one desktop test fails on a rounding
error, fixing it now.
```

### The session's tab

`▸◆ Session` heads the lists (with `inspect` on). Its view's header is the
session's model, effort, `busy` or `idle` (from the main loop's facts, kept
with mascots on), its age and its turns; its tabs are **Overview**,
**Cost** and **Agents**.

- **Overview:** a dim label column, then ` · `-joined facts, flowing onto
  more rows when the pane is narrow:
  - `time`: the session's age, and its busy and idle share (the main
    turns' summed `durationMs`, kept in `usage.busyMs`, plus the turn
    running now).
  - `turns`: main `turn.complete`s (`usage.turns`), the compactions, and
    how long since the last (`main.compactedAt`).
  - `context`: used and window, the percent, the growth per turn (the mean
    of the last ten main turns' context deltas, from `usage.contextSamples`,
    a compaction's drop left out) and the turns until it compacts (at the
    auto-compact threshold the inventory's breakdown names, else the
    window).
  - `tokens`: in, out, cache read and write, and the cache hit share.
  - `limits`: each window's percent, the time to its cap at the burn of the
    last 30 minutes (`usage.limitSamples`: each change of its percent, the
    one before the window kept as its base), `resets before the cap` when
    the reset comes first, `—` without at least three changed samples
    spanning five minutes or when no rising rate is known; and its reset.
  - `asks`: subagents waiting on a permission ask.
  - `failures`: tool calls, in any loop, that ended denied or in an error.
  - `agents`: subagents and workflow agents spawned, running, done, failed,
    and their minutes (the engine's one-request forks left out).
- **Cost:** the session's total (`costUsd`, from `$.session.usage()`: the
  headline) and its rate an hour, then a tree by model, the costliest
  first: each model a Button line (`▸ opus-5-5 … $181.36  72%`) that opens
  (`▾`) to its users by cost: `• main`, each subagent with its description
  cut to the row, `• workflow ×n`, the engine's `• forks ×n` and the
  compacted `• others ×n`. The open models are kept in
  `mod-hud.listView.models`, written on a press only. When `costUsd` is known,
  each model and user gets that total multiplied by its estimated list-price
  share, not its raw list-price cost. Display rounding can differ by a cent.
  With no reported total, the headline has `~` and the tree uses list-price
  estimates. A dim note names which split is shown; unknown prices show `—`.
- **Agents:** the lists.

Per-loop and per-model spend is kept in `mod-hud.ledger`: each request's
`turn.step` usage booked to its loop (`main`, a subagent, a workflow agent,
or a `fork`) and the model that answered. The compaction summarizer emits a
request with its own fork `agentId`, so its tokens and spend are booked only
from `turn.step`; `session.compact.usage` repeats that accounting and is not
booked again under the compacted loop. An installed main compaction still
increments the compaction count (a precompute does not). Also kept: a loop's run end; and the failed calls. One write per request,
per agent turn end and per failed call; never per tick. It holds at most 500
loops: a finished loop is folded into its models' `others` an hour after it
ended, and past 500 the oldest finished go first. It is priced when drawn,
with `PRICES` in `hooks/hud-ledger.ts` (USD per million tokens: input, output,
cache read, cache write at 1.25× input; approximate first-party list prices;
provider prefixes, date suffixes and trailing `-vN[:N]` deployment suffixes
are stripped before exact matching; unknown versions and providers stay
unpriced, shown as `—`, rather than inheriting a family's latest price). `/clear` empties it; the lists' expansion stays.

At 72 columns (real mounted output):

```
◂ Back   ◆ Session · opus-5-5 · xhigh · busy · 1h20m · 23 turns
[ Overview ]  Cost   Agents

time     1h20m · busy 59% · idle 41%
turns    23 turns · 3 compactions · last 22m ago
context  412k / 1.0M · 41% · +18k/turn · compacts in ~30 turns
tokens   21M in · 2.8M out · 250M cache read · 24M cache write
         85% cache hit
limits   5h 31% · resets before the cap · ↻ 14:20
         7d 12% · — · ↻ Tue
asks     none waiting
failures 1 denied · 1 error
agents   22 spawned · 5 running · 17 done · 37 agent-min
```

```
◂ Back   ◆ Session · opus-5-5 · xhigh · busy · 1h20m · 23 turns
Overview   [ Cost ]  Agents

Cost $251.40 · $187/h

▸ opus-5-5                                      $181.36  72%
▸ sonnet-5-5                                     $66.36  26%
▸ haiku-4-5                                       $3.68   1%

The session total is split by model and agent using estimated list-price
shares.
```

```
◂ Back   ◆ Session · opus-5-5 · xhigh · busy · 1h20m · 23 turns
Overview   [ Cost ]  Agents

Cost $251.40 · $187/h

▾ opus-5-5                                      $181.36  72%
  • main                                        $141.85
  • frontend  Desktop: draw mascots in pixels…   $39.51
▾ sonnet-5-5                                     $66.36  26%
  • workflow ×15                                 $53.19
  • reviewer  Review the desktop scene agains…   $13.17
▸ haiku-4-5                                       $3.68   1%

The session total is split by model and agent using estimated list-price
shares.
```

At 48:

```
◂ Back   ◆ Session
  opus-5-5 · xhigh · busy · 1h20m · 23 turns
[ Overview ]  Cost   Agents

time     1h20m · busy 59% · idle 41%
turns    23 turns · 3 compactions · last 22m ago
context  412k / 1.0M · 41% · +18k/turn
         compacts in ~30 turns
tokens   21M in · 2.8M out · 250M cache read
         24M cache write · 85% cache hit
limits   5h 31% · resets before the cap
         ↻ 14:20
         7d 12% · — · ↻ Tue
asks     none waiting
failures 1 denied · 1 error
agents   22 spawned · 5 running · 17 done
         37 agent-min
```

```
◂ Back   ◆ Session
  opus-5-5 · xhigh · busy · 1h20m · 23 turns
Overview   [ Cost ]  Agents

Cost $251.40 · $187/h

▾ opus-5-5                          $181.36  72%
  • main                            $141.85
  • frontend  Desktop: draw masco…   $39.51
▾ sonnet-5-5                         $66.36  26%
  • workflow ×15                     $53.19
  • reviewer  Review the desktop…    $13.17
▸ haiku-4-5                           $3.68   1%

The session total is split by model and agent using
estimated list-price shares.
```

## Rationale

**Hierarchy.** One glyph heads the card: `◆` at column 0, in the same
gutter as the agent list's `●`, `✓` and `✗`, so the pane reads as "the
session, then its agents". Every other row hangs two cells in.

The identity row is the only bold row (model, effort, cost), and the model
name alone carries the accent. Below it, rows follow how often you need
them: what needs attention now, where you are, how full the context is and
how soon it compacts, how close the limits are, what is running, what is
next. Labels (`ctx`, `5h`, `now`) sit in one dim six-cell gutter, so the eye
can skip them once learned.

**Close button.** The engine draws the pane's close button (`×`) over the
last cell of the first body row. The first row, the identity row whenever
it draws, ends at least two cells short of the pane's edge (`CLOSE_RESERVE`),
so the `×` never covers the cost. Every right-aligned cell shares that edge;
free text on later rows may use the full width. From
74 columns up, the 72-cell card fits whole beside the reserve.

**Alignment and stability.** The gauges share one grid: label 6, then the
bar (20 cells wide; 10 narrow, 8 below 44 columns, none at 36 and under),
then the percent right-aligned in 4, then the detail after two spaces. The
bars stack into one column and the percentages line up.

Every value that changes on the 1 s tick sits in a fixed cell:
- working/idle: 16 cells (`● working 1h 12m` at its widest), right-anchored
  before the clock
- session clock: 7 cells, right-anchored
- cost: 6 cells below $100, always two decimals (`$0.07`, `$52.60`,
  `$123.45`); it changes on a measurement, never on the tick
- the `now` row's elapsed time: 6 cells, before `N files edited`, which
  ends at the identity's edge
- token count: 4 cells

A tick can change a digit but never moves a neighbour. The files-edited
count stays at the edge whether or not a tool runs. A long MCP tool name
keeps its tool half (`browser_tak…`, not `playwright:…`).

**Colour.** Colour is reserved for the bars, the status glyphs, the model
name, `● working`, and the alert strip. It is all theme keys, so the HUD follows the
person's theme (Dracula's purple accent, Latte's darker greens on white)
instead of hard-coding ANSI colours that wash out on a light background:

| What | Theme key |
| --- | --- |
| `◆`, model name, `● working`, in-progress `◐` | `claude` |
| alert strip: asks, a limit running out (and `⚠` when one leads) | `error` |
| alert strip: stalled agents, a compaction soon | `warning` |
| alert strip: failed calls, behind upstream | `warning`, dim |
| TODO progress fill | `success` |
| bar fill below 60 % | `success` |
| 60 to 84 % | `warning` |
| 85 % and up | `error` |
| dirty-tree `*` | `warning` |
| in-progress todo `◐` (TODO section) | `claude` |
| active tab `[ Task ]`, the trail's current call (inspect view) | `claude` |
| a `denied` call (Trail tab) | `warning` |
| an `error` call (Trail tab) | `error` |

The threshold uses the percent as displayed, so a value shown as `85%` is
always red. The bar's track, the compaction mark `┃`, labels, paths, reset
times, token counts, the runway, `○ idle`, the tool's argument and elapsed
time, git marks and the motto are dim. No element sets a background colour or
`inverse`, and no text is both bold and dim (the two share one reset code
in most terminals).

**Bar glyphs.** The fill is `━` and the empty track `─`, drawn as separate
spans: the fill in the level's colour, the track dim. A shade glyph such as
`░` renders as a solid grey block in some terminal fonts, and stacked bar
rows then merge into one blob. A heavy line over a light line stays two
distinct weights in any font, and leaves a gap between rows.

**Redundant encoding.** Nothing depends on colour alone:
- Bars show level by length: a heavy `━` against a light `─`.
- At 36 columns and under, where no bar fits, the percent itself is the
  reading.
- Todo items show state by shape: `☑` done (and struck through), `◐` doing,
  `☐` pending.
- A dirty tree shows as `*`.
- The alert strip is words, led by `⚠`; colour only ranks them.
- The compaction threshold is a `┃` in the bar, and the runway is written
  out.
- The git marks are `+` paths added, `~` modified, `−` deleted, `↑`/`↓`
  commits ahead and behind.

**Density.** The wide layout is eight rows at most (alerts, a spend limit
and a motto); the narrow one is nine, since the 5h and 7d windows take a
row each. Given `rows`, the HUD takes at most half the pane (never fewer
than four rows). It drops the motto first, then `now`, the place row, and
then the limits, the spend gauge first. It never drops the identity, the
alert strip or ctx.

The HUD never depends on how many agents run. Its root and rows set
`flexShrink={0}`, so the agent list scrolls instead of squeezing it.

**Truncation.** Every row is measured in terminal cells (CJK and emoji
count two) and fits both `columns` and the 72-cell card. Free text (path,
branch, alerts, the tool's argument, motto) is cut with `…`. A path loses its leading directories
first (`…/mods`), and the branch keeps at least eight cells. Newlines and
control characters in any text are flattened to spaces.

**Wiring note.** The caller should leave one blank row between the HUD and
the agent list (`gap={1}` on their shared column, or `marginBottom={1}`
around the HUD), so the bold agent header does not sit flush under the
HUD's last row. When the HUD draws no rows (no data yet), drop the gap too.

## Agent call counts

The per-agent tally is labelled, not a multiplication sign. Wide rows use
`1 call` or `91 calls` in a ten-cell count column (four digits: `1234 calls`)
and one blank cell before the detail, so `138 calls` never runs into it;
narrow rows use `1c` or
`91c` before the current tool to leave room for its name. This is separate
from the per-tool counts `/mod-hud facts` prints (`Read: 41`). Example agent rows:

```
▸● Explore          sonnet-5-5   1m12s 91 calls   Read  Find the bug
▸● debugger         sonnet-5-5      4s 1 call     Edit  Fix it
▸● worker           sonnet-5-5   9m40s 138 calls  Bash  Build the HUD
```

At narrow widths the running row is stacked:

```
▸● Explore · sonnet-5-5 · 1m12s
  Find the bug
  91c · Read
```

**Row styling.** Every row starts with its inspect button `▸` (one cell,
plain, dim unless its agent is the one selected; with `inspect` off there is
none and the row starts at its glyph). In the headers (`Agents · …`,
`Workflow · …`) the counts are coloured: `N running` `success`, `N done`
`error`, `N failed` `error`, `N stalled` `warning`; the rest stays bold. A
finished row (done or failed, subagent or workflow, wide or narrow) is drawn
dim and struck through, all but its status glyph (coloured as before) and its
name (in its mascot's colour), so it still matches its mascot. Running and
stalled rows are unchanged.

## Finished agents, collapsed

Each group (the Agents group and the Workflow group) lists its running and
stalled agents whole, then only its three most recent finished ones (done
or failed), then one dim plain Button at the names' column: `▸ n more`,
which lists them all (`▾ collapse` folds them back). Each group's state is
kept in `mod-hud.listView` (`agents`, `workflow`), written on a press only.
`maxRows` still caps the rows of both groups together, and `+n more` still
counts what the cap left out. Narrow, the same, each agent on its stacked
rows. With `inspect` on, `▸◆ Session` heads the lists. At 72 columns (real
mounted output):

```
▸◆ Session
▾ Agents · 2 running · 5 done · 1 stalled · workflow 3 running
▸● frontend         opus-5-5     6m56s 8 calls    Bash  Desktop: draw …
▸◌ reviewer         sonnet-5-5   6m56s 0 calls    thinking  Review the…
▸✓ Explore          haiku-4-5      20s 0 calls    Find the pane props …
▸✓ Explore          haiku-4-5      20s 0 calls    Read the sprite shee…
▸✓ Explore          haiku-4-5      20s 0 calls    List the SVG callers…
   ▸ 2 more
▾ Workflow · 3 running · 0 done
▸● wf-0014          sonnet-5-5   6m55s 2 calls    thinking · last Grep
▸● wf-0013          sonnet-5-5   6m55s 2 calls    thinking · last Grep
▸● wf-0012          sonnet-5-5   6m55s 2 calls    thinking · last Edit
```

`▸ 2 more` pressed:

```
▸◆ Session
▾ Agents · 2 running · 5 done · 1 stalled · workflow 3 running
▸● frontend         opus-5-5     6m56s 8 calls    Bash  Desktop: draw …
▸◌ reviewer         sonnet-5-5   6m56s 0 calls    thinking  Review the…
▸✓ Explore          haiku-4-5      20s 0 calls    Find the pane props …
▸✓ Explore          haiku-4-5      20s 0 calls    Read the sprite shee…
▸✓ Explore          haiku-4-5      20s 0 calls    List the SVG callers…
▸✓ Explore          haiku-4-5      20s 0 calls    Find the pointer han…
▸✓ Explore          haiku-4-5      20s 0 calls    Map the scene module…
   ▾ collapse
…
```

At 48:

```
▸◆ Session
▾ Agents · 2 running · 5 done · 1 stalled · wor…
▸● frontend · opus-5-5 · 6m56s
  Desktop: draw mascots in pixels, keep the ter…
  8c · Bash
▸◌ reviewer · sonnet-5-5 · 6m56s
  Review the desktop scene against the brief
  0c · thinking
▸✓ Explore · haiku-4-5 · 20s
  Find the pane props
  Found it.
▸✓ Explore · haiku-4-5 · 20s
  Read the sprite sheet
  Found it.
▸✓ Explore · haiku-4-5 · 20s
  List the SVG callers
  Found it.
   ▸ 2 more
▾ Workflow · 3 running · 0 done
▸● wf-0014 · sonnet-5-5 · 6m55s
  2c · thinking · last Grep
▸● wf-0013 · sonnet-5-5 · 6m55s
  2c · thinking · last Grep
▸● wf-0012 · sonnet-5-5 · 6m55s
  2c · thinking · last Edit
```

## Minimised groups

Each group's header starts with a one-cell dim plain Button: `▾` minimises
the group to its header line, `▸` opens it again (`▾ Workflow · 8 running ·
0 done` ↔ `▸ Workflow · 8 running · 0 done`). A minimised group draws no
rows: no agents, no `▸ n more`, no `No agents yet.`; its header keeps its
coloured counts. Each group's state is kept in `mod-hud.listView`
(`agentsMinimised`, `workflowMinimised`), default open, written on a press
only; inside an open group the finished-agent collapse above still applies.
A minimised group spends none of `maxRows` (the other group takes the whole
cap) and adds nothing to `+n more`, and the rows it gives back go to the
scene. The Button is there with `inspect` off too.

```
▸◆ Session
▸ Agents · 2 running · 5 done · 1 stalled · workflow 3 running
▾ Workflow · 3 running · 0 done
▸● wf-0014          sonnet-5-5   6m55s 2 calls    thinking · last Grep
…
```

## Text in pixels on the desktop

The desktop sets the pane's text in a proportional font, so space-padded
columns drift and squash there. On the desktop (`e.surface === 'desktop'`)
every text row the pane draws (the HUD, the TODO section, the lists, the
inspect view) is drawn instead as an `Svg` of its own (`hooks/text-svg.ts`)
on the scene's grid: 8 by 16 pixels a cell, a `<text>` per run of words in a
monospace stack at 13 px, stretched to exactly its cells (`textLength`), in
the scene's theme colours (a class per theme key, which the light scheme
recolours; dim as opacity, bold and italic as the font's, struck runs
`line-through`), a bar's `━`/`─` run a rect. Each row keeps its keyed one-row
Box, so the rows read the same as the terminal's and line up cell for cell.
A row's Buttons (inspect `▸`, a group's `▾`, `▸ n more`, the TODO line's
`▸`/`▾`, the tabs, Back, a Cost-tree model's glyph and name) are not drawn in its document: each is the
same Button, keyed as on the terminal, in an absolutely placed one-row Box
over the cells the terminal draws it in, so a press reaches the same
handler. One document per row keeps every Button on its row whatever height
the surface gives a cell. The terminal, VS Code and mobile keep the Text rows.

## Workflow agents

The agents a Workflow run starts carry ids no `$.agent.list()` names and
are not the Agent tool's, so the board (`mod-hud.agents`, which other mods
read) never holds them. Their loops' events still name them: each
`turn.step` carries the loop's `agentId`, `model` and `effort`, each
`tool.call` its `agentId` and tool, and the run's `turn.complete` its
`agentId` and `reason`. A loop neither the board nor the latest list knows is
kept in `mod-hud.shadows` instead, and drawn as a second group under the
subagents. The board's shape does not change.

At 72 columns, two subagents and three workflow agents (one editing, one
between calls, one done), as the pane draws them:

```
▾ Agents · 1 running · 1 done · workflow 2 running, 1 done
▸● Explore          sonnet-5-5     33s 1 call     thinking  Find the bug
▸✓ general-purpose  sonnet-5-5     32s 0 calls    Fix it — Fixed in parser.ts
▾ Workflow · 2 running · 1 done
▸● wf-4c21          sonnet-5-5     31s 2 calls    Edit
▸● wf-9e02          haiku-4-5      31s 1 call     thinking · last Grep
▸✓ wf-c1d3          sonnet-5-5     30s 1 call     answer · last Bash
```

Narrow (here 48), a workflow agent takes two lines, having no task
description to give a third:

```
▾ Workflow · 2 running · 1 done
▸● wf-4c21 · sonnet-5-5 · 31s
  2c · Edit
▸● wf-9e02 · haiku-4-5 · 31s
  1c · thinking · last Grep
▸✓ wf-c1d3 · sonnet-5-5 · 30s
  1c · answer · last Bash
```

- **Name.** `wf-` and the id's last four characters. The `agent.spawn` that
  would carry a description is the Agent tool's event, and a workflow's agents
  are not the Agent tool's: there is no description to match to the id.
- **Cells.** The subagent rows' grid: status glyph, the name in the type's
  16 cells (in its mascot's colour with mascots on), the last step's model
  (`-` before a step), elapsed time since it was first seen (frozen when it
  ends), and `N calls`. Then what it does: its tool while one runs, else
  `thinking · last <tool>`; once it ended, the reason and its last tool.
- **Status.** `●` running, `◌` quiet longer than `stalledAfterSec`, `✓` done
  (`turn.complete` reason `answer`), `✗` failed (any other reason: `error`,
  `refusal`, `aborted`), in the same theme keys as the subagents.
- **Header.** `Workflow · n running · m done`, with ` · k failed` and
  ` · s stalled` when there are any, bold like the board's. The board's
  header and the opt-in status line count the group too, after the
  subagents: `agents · 1 running · 0 done · workflow 3 running, 1 done`
  (`, k failed` when any). With no subagents the board's half reads
  `agents · 0 running · 0 done`, and `No agents yet.` gives way to the group.
- **Order and cap.** Running first, the newest first, as the subagents;
  only the three most recent finished until `▸ n more` is pressed (see
  "Finished agents, collapsed"). `maxRows` caps both groups together, the
  subagents first; the group's header stays while it has any agent, even
  when the cap leaves it no row, and `+n more` counts what either group
  left out.

What is shown, and for how long:
- A loop shows once it made a tool call or a second request. The engine's
  compaction and memory forks, which make one request, never show; their
  `turn.complete` drops them.
- An entry with no event for 10 minutes is dropped; a finished one 30 s
  after it ended, its mascot's farewell long over.
- At most 64 are held: the oldest finished go first, then the never-shown,
  then the oldest heard from.
- A loop the board or the latest list comes to know (a subagent whose first
  steps raced its spawn, a teammate the next reconciliation lists) leaves
  the group for the board.

`mod-hud.shadows` is written once per request, once as a call starts and
once as it ends, and once as the run ends: never per chunk of a streaming
response and never per tick. What expires is dropped by the next write, or
by the 5 s reconciliation while one is held (a held one keeps that clock
going with the pane closed, as a running subagent does), and the drawing
leaves out what expired before then. `/mod-hud facts` prints the record as
held under `shadows` (left out while it is empty). `/clear` and every other
session end drop it. The `showWorkflows` option (on by default) switches all
of it off: nothing kept, drawn, counted or printed (a session end still drops
a record an earlier session left, as it does the `main` facts).
