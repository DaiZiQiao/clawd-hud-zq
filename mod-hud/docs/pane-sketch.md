# mod-hud: pane HUD sketch

The HUD is the block at the top of the `hud` pane, above the agent
list. `renderHud()` in `hooks/hud.tsx` draws it from one `HudData` value.
Every sketch below is the renderer's own output (`hudLines()`, with
`todoLines()` for the TODO section) for the fixtures in
`hooks/hud.fixtures.ts`, in UTC. The `full` fixture is:
- opus 5.5 at xhigh effort through a gateway, 72 minutes in, $4.21 spent;
  the main loop working for 42 s
- two subagents waiting on a permission ask
- `main` dirty (3 paths added, 1 deleted; +142 −37 lines against HEAD),
  2 commits ahead, last commit 48 minutes ago
- `npm test -- hud` running in Bash for 4 s
- 412k of a 1M context window used, growing 65k a turn, auto-compaction at
  800k; the main loop's last request 18 minutes ago on a 1-hour prompt cache
- 5h limit at 31 % (up from 11 % 35 minutes ago, so it runs out at ~13:43,
  before its 14:20 reset), 7d limit at 12 %
- the last main turn: $0.38, 1m 12s, 24k tokens of its own; 87 % of the
  session's input served by the cache; the agents 38 % of the estimated spend
- a five-item todo list, three done, one in progress

The sketches leave the motto out: since 1.2.0 the `motto` option defaults to
empty. A motto set is drawn dim and italic as the HUD's last row.

## Wide: 60 columns and up (shown at 72)

The HUD reads top to bottom: who and whether it is working, what needs
attention, then four sections in a left gutter (`session`, `context`,
`limits`, `usage`), each row with a dim sub-label and its value in one
column (cell 18), one idea per row. The TODO section follows under its own
`todo` label:

```
◆ opus 5.5 · xhigh · gateway                           ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          growth  +65k / turn        compact in ~6 turns
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20   out ~13:43
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend

 todo ▸   ━━━━━━────  3/5
          ◐ Wiring the status line
```

Row by row:
- **Header.** The model, effort and provider, and at the edge the main loop
  `● working 00:42` (the accent; how long this turn has run) or `○ idle 3m`
  (dim; how long since it stopped), read from the main loop's facts, kept
  with mascots on. When the row runs short the provider gives way first,
  then the working cell, then the effort. The session's clock and cost moved
  to `usage · cost`.
- **Alerts** (`⚠`). Drawn only while something needs attention; otherwise
  the row is not there at all. Most severe first, joined by ` · ` and cut to
  the card with `…`:
  1. `N agents waiting for permission` (`error`).
  2. `5h out ~13:43, before ↻14:20`: a window whose burn over the last 30
     minutes reaches 100 % before it resets (`error`; 7d and spend alike).
  3. `N agents stalled`: running subagents and workflow agents quiet past
     `stalledAfterSec` (`warning`).
  4. `compact in ~N turns`: the context compacts within three turns
     (`warning`).
  5. `cache cools in 2m · next turn rewrites 412k`: the prompt cache goes
     cold within two minutes of a 1-hour TTL, or within its last minute of a
     5-minute one (the smaller of 2 minutes and 20 % of the TTL), and the
     next turn would write the whole context to the cache again (`warning`).
     A cache already cold is no alert: the cache row says so, calmly.
  6. `N calls denied or failed`: from the ledger (dim `warning`).
  7. `↓3 behind`: the branch is behind its upstream (dim `warning`).

  The `⚠` takes the colour of the most severe.
- A blank row, then the sections.
- **session · repo.** The working directory from `~`, losing its leading
  directories first.
- **session · branch.** The branch, `*` when dirty (`warning`), `↑2 ↓1`
  commits ahead and behind, then the lines changed against HEAD
  (`git diff --shortstat HEAD`; the path counts `+3 ~1 −1` stand in when
  there are none) and `last commit 48m ago` (`git log -1 --format=%ct`).
  Both run on the debounced git timer beside `git status`, never the tick.
- **session · now.** The main loop's tool running now and its main argument
  (a path from `~`, losing its leading directories first; a command or
  pattern cut with `…`), its elapsed time at the edge. Between tools a dim
  `—`; before any tool, no row. `showTools` switches it off. The count of
  files edited moved to the Session tab's Overview.
- **context · used.** The bar marks the auto-compact threshold with a dim `┃`
  when the context breakdown names one below the window; then the percent
  and the tokens of the window.
- **context · growth.** The context's mean growth per main turn over the
  last ten, and `compact in ~N turns` at that growth to the threshold (else
  the window). No growth seen, no row.
- **context · cache.** The main conversation's prompt cache, counted from
  the main loop's last request: the bar drains as the TTL runs out (`success`,
  `warning` once cooling), then `warm · 42m left (1h)`, the TTL in parens.
  Cold, an empty track and `cold · next turn rewrites 412k`, all dim. See
  "The prompt cache's TTL" below for how the TTL is known.
- **limits · 5h / 7d / spend.** Each window on its own row, its bar as wide
  as the context's, its reset, and `out ~13:43` (`error`) only while the
  window runs out before it resets.
- **usage · cost.** The session's cost (bold), its rate an hour (once the
  session is five minutes old) and the session's clock.
- **usage · last.** The last main turn: what the session spent while it ran
  (from one main turn's end to the next), how long it ran (`turn.complete`'s
  `durationMs`) and its own tokens (fresh input, cache writes and output of
  its main-loop requests; cache reads left out).
- **usage · cache.** The share of the session's input the prompt cache
  served, and the subagents', workflow agents' and forks' share of the
  ledger's estimated spend (with `inspect` on).
- **todo.** See "TODO" below.

The session's tokens by kind, cache writes, the compaction count, the files
edited, the per-tool counts and the MCP/skill counts are not drawn: the
Session tab's Overview has the tokens, compactions and files edited;
`/mod-hud facts` has the tool counts and the inventory.

The HUD is a card at most 72 cells wide. On a 100-column pane it draws
exactly as at 74, where the whole card fits beside the close button's
reserve:

```
◆ opus 5.5 · xhigh · gateway                             ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                           00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          growth  +65k / turn        compact in ~6 turns
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20   out ~13:43
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

At 60, the narrowest wide layout, pieces that no longer fit whole are left
out (the last commit, the limit ETA; the alerts are cut), and every
right-aligned cell stops two cells short of the pane's edge (see "Close
button" below):

```
◆ opus 5.5 · xhigh · gateway               ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before…

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines
          now     Bash · npm test -- hud             00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          growth  +65k / turn        compact in ~6 turns
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

## The prompt cache

The cache row counts down from the main loop's last request (each main
`turn.step` that answered stamps `usage.mainRequestAt`, in the usage write
the request makes anyway). The cold-cache variant (`coldCache`, an hour and
ten minutes after that request):

```
◆ opus 5.5 · xhigh · gateway                           ● working 00:42

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          growth  +65k / turn        compact in ~6 turns
          cache   ────────────────────  cold · next turn rewrites 412k
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

With 90 seconds left (`coolingCache`) the row turns `warning` and the alert
strip says what is at stake:

```
◆ opus 5.5 · xhigh · gateway                           ● working 00:42
  ⚠ cache cools in 2m · next turn rewrites 412k

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          growth  +65k / turn        compact in ~6 turns
          cache   ━───────────────────  cooling · 2m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

### The prompt cache's TTL

The mod infers the main conversation's TTL the way the engine picks it
(`cacheTtlOf` in `hooks/facts.ts`), once at start:
1. `DISABLE_PROMPT_CACHING` set: no cache, no row.
2. `FORCE_PROMPT_CACHING_5M` set: 5m.
3. `CLAUDE_CODE_PROMPT_CACHE_TTL` (`5m` or `1h`), else the `promptCacheTtl`
   setting.
4. `ENABLE_PROMPT_CACHING_1H` set: 1h.
5. Otherwise automatic: 1h on a Claude subscription (no `ANTHROPIC_API_KEY`,
   `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL`, not Bedrock, Vertex or
   Foundry), else 5m.

Only whether each variable is set is read; no value is kept. The
`cacheTtl` option (`auto`, `5m`, `1h`) overrides the inference. A
subscription that has run past its limits and draws on usage credits drops
to the 5-minute cache, which nothing the mod can read shows: there the row
still counts an hour, so set `cacheTtl: 5m` while that lasts.

## More states, wide

The context full and the limits hot (`fullContext`). Bars below 60 % are
`success`, 60 to 84 % `warning`, and 85 % and up `error`. With no growth
samples the growth row goes; a spend limit gets its own row:

```
◆ opus 5.5 · xhigh · gateway                           ● working 00:42
  ⚠ 2 agents waiting for permission

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━━━━━━━━━┃━━━ 100%   1.0M / 1.0M
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━━━━━━━━━━━━━──  92%   ↻ 14:20
          7d      ━━━━━━━━━━━━━───────  64%   ↻ Tue
          spend   ━━━━━━━━━━━━━━━━━───  85%   ↻ Nov 1
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

Everything at once (`alarmed`): the main loop idle three minutes, a stalled
agent, a compaction two turns off, three failed calls and the branch three
behind. The strip is cut to the card; the least severe go first:

```
◆ opus 5.5 · xhigh · gateway                                 ○ idle 3m
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20 · 1…

 session  repo    ~/.claude/mods
          branch  main* ↑2 ↓3   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━━━━━━━──┃───  70%   700k / 1.0M
          growth  +65k / turn        compact in ~2 turns
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20   out ~13:43
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

Nothing needing attention (`calm`): no alert row at all.

```
◆ opus 5.5 · xhigh · gateway                           ● working 00:42

 session  repo    ~/.claude/mods
          branch  main* ↑2   +142 −37 lines · last commit 48m ago
          now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          growth  +65k / turn        compact in ~6 turns
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
          last    $0.38              1m 12s · 24k tokens
          cache   87% hit            agents 38% of spend
```

## Narrow: below 60 columns, at 56

The narrow layout keeps every row, in the same order. The gutter takes the
short labels (`sess`, `ctx`, `lim`, `use`; six cells), the sub-labels seven,
so values start at cell 13. Bars are 10 cells, the token count reads
`412k/1.0M`, pieces are two cells apart, and a piece that does not fit whole
is left out:

```
◆ opus 5.5 · xhigh · gateway           ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~13:43, be…

 sess repo   ~/.claude/mods
      branch main* ↑2  +142 −37 lines
      now    Bash · npm test -- hud              00:04
 ctx  used   ━━━━────┃─  41%  412k/1.0M
      growth +65k/turn  compact in ~6 turns
      cache  ━━━━━━━───  warm · 42m left (1h)
 lim  5h     ━━━───────  31%  ↻ 14:20  out ~13:43
      7d     ━─────────  12%  ↻ Tue
 use  cost   $4.21  $3.51 / h · 1h 12m
      last   $0.38  1m 12s · 24k tokens
      cache  87% hit  agents 38% of spend
```

## Narrow at 48

```
◆ opus 5.5 · xhigh · gateway   ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~1…

 sess repo   ~/.claude/mods
      branch main* ↑2  +142 −37 lines
      now    Bash · npm test -- hud      00:04
 ctx  used   ━━━━────┃─  41%  412k/1.0M
      growth +65k/turn  compact in ~6 turns
      cache  ━━━━━━━───  warm · 42m left (1h)
 lim  5h     ━━━───────  31%  ↻ 14:20
      7d     ━─────────  12%  ↻ Tue
 use  cost   $4.21  $3.51 / h · 1h 12m
      last   $0.38  1m 12s · 24k tokens
      cache  87% hit  agents 38% of spend

 todo ▸ ━━━━━━────  3/5
        ◐ Wiring the status line
```

## Narrow at 40

Below 44 columns the bars are 8 cells:

```
◆ opus 5.5 · xhigh     ● working 00:42
  ⚠ 2 agents waiting for permission · 5…

 sess repo   ~/.claude/mods
      branch main* ↑2  +142 −37 lines
      now    Bash · npm test…    00:04
 ctx  used   ━━━───┃─  41%  412k/1.0M
      growth +65k/turn
      cache  ━━━━━━──  warm · 42m left
 lim  5h     ━━──────  31%  ↻ 14:20
      7d     ━───────  12%  ↻ Tue
 use  cost   $4.21  $3.51 / h · 1h 12m
      last   $0.38  1m 12s · 24k tokens
      cache  87% hit
```

## Narrow at 36

At 36 columns and under there is no room for a bar worth reading: the gauges
keep their right-aligned percent. The working cell and the provider gave way
in the header:

```
◆ opus 5.5 · xhigh
  ⚠ 2 agents waiting for permission…

 sess repo   ~/.claude/mods
      branch main* ↑2
      now    Bash · npm t…   00:04
 ctx  used    41%  412k/1.0M
      growth +65k/turn
      cache  warm · 42m left (1h)
 lim  5h      31%  ↻ 14:20
      7d      12%  ↻ Tue
 use  cost   $4.21  $3.51 / h
      last   $0.38  1m 12s
      cache  87% hit
```

A long branch and motto at 48 (`longBranch`). The branch keeps at least eight
cells, and free text ends in `…`:

```
◆ opus 5.5 · xhigh · gateway   ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~1…

 sess repo   ~/.claude/mods
      branch feature/very-long-branch-name-…* ↑2
      now    Bash · npm test -- hud      00:04
 ctx  used   ━━━━────┃─  41%  412k/1.0M
      growth +65k/turn  compact in ~6 turns
      cache  ━━━━━━━───  warm · 42m left (1h)
 lim  5h     ━━━───────  31%  ↻ 14:20
      7d     ━─────────  12%  ↻ Tue
 use  cost   $4.21  $3.51 / h · 1h 12m
      last   $0.38  1m 12s · 24k tokens
      cache  87% hit  agents 38% of spend
  a motto long enough to run past the edge of e…
```

## Short panes

Given the pane's rows, the HUD takes at most half (never fewer than four).
Rows go by rank: the alerts, the header, `context · used`, the limits,
`session · now`, `context · cache`, `usage · cost`, then the rest (branch,
repo, growth, last turn, cache use, the motto, the blank row). A section's
label moves to its first row still shown. At 72 columns in 16 rows (eight for
the HUD):

```
◆ opus 5.5 · xhigh · gateway                           ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~13:43, before ↻14:20
 session  now     Bash · npm test -- hud                         00:04
 context  used    ━━━━━━━━────────┃───  41%   412k / 1.0M
          cache   ━━━━━━━━━━━━━━──────  warm · 42m left (1h)
 limits   5h      ━━━━━━──────────────  31%   ↻ 14:20   out ~13:43
          7d      ━━──────────────────  12%   ↻ Tue
 usage    cost    $4.21              $3.51 / h · 1h 12m
```

At 48 columns in 10 rows (five for the HUD):

```
◆ opus 5.5 · xhigh · gateway   ● working 00:42
  ⚠ 2 agents waiting for permission · 5h out ~1…
 ctx  used   ━━━━────┃─  41%  412k/1.0M
 lim  5h     ━━━───────  31%  ↻ 14:20
      7d     ━─────────  12%  ↻ Tue
```

## Sparse and early states

A session twelve seconds old, with a model and a clock and nothing measured
yet. Nothing prints a zero for a fact that has not arrived; `used —` holds
the context's place until the first response:

```
◆ opus 5.5 · xhigh

 context  used    —
 usage    cost    $0.00              00:12
```

Each missing fact removes only its own row or piece, wide and narrow alike,
and a section with no rows left loses its label:
- Nothing needing attention: no alert row.
- No rate-limit data: no limits section.
- No git: no branch row. No commit yet: no `last commit`.
- No auto-compact threshold (or the breakdown not read): no `┃`, and the
  runway runs to the window. No context growth: no growth row.
- No main request yet, or prompt caching off: no cache row.
- No main turn ended: no `last` row. No tokens and no ledger: no cache-use row.
- No tool called yet: no `now` row. No main-loop activity known: no
  working/idle cell. No todos: no TODO section.
- No data at all: the HUD draws nothing and the agent list stands alone.
  A motto is the HUD's last row, never a HUD of its own.

`/mod-hud facts` prints the `HudData` the HUD is drawing from as JSON (the
alert counts under `alerts`, the main loop's activity under `main`, the cache
under `cache`, the last turn under `usage.lastTurn`, the tool counts and the
inventory included), with the workflow agents' record (`shadows`), the
ledger's summary (`ledger`) and the lists' expansion (`listView`), each left
out while empty, and says whether the last `session.measure` carried any rate
limits. Use it when a row you expect is missing.

## TODO

The main conversation's todo list is a section of its own between the HUD
and the agents, one blank row above and below, in the HUD's gutter. Folded
(the default) it is two rows: ` todo`, the `▸` Button (dim), a bar of the
items done from the value gutter (10 cells; 8 below 44 columns, none at 36
and under; the fill `success`, the track dim) and `done/total`; under it the
item in progress (its active form, `◐` in the accent), else the next pending
(`☐`), cut to the pane with `…`. All done: the label row alone. Seven items,
three done, one in progress (`sevenTodos`), at 72 and 48 columns:

```
 todo ▸   ━━━━──────  3/7
          ◐ Wiring the detail view
```

```
 todo ▸ ━━━━──────  3/7
        ◐ Wiring the detail view
```

A press on `▸` opens it (`mod-hud.listView.todosExpanded`, written on a press
only): the toggle turns `▾` and every item is listed under the label row, in
progress first, then pending (`☐`), then completed (`☑`, struck through and
dim). At most `todoRows` items (6 by default), then a dim `+n more`. `▾`
folds it again:

```
 todo ▾   ━━━━──────  3/7
          ◐ Wiring the detail view
          ☐ Test the scenes
          ☐ Update the sprite sheet
          ☐ Sketch the pane at 72 and 48 columns
          ☑ Read the brief
          ☑ Split the sprites out
          +1 more
```

No todos (or `showTodos` off): no section. Its rows count like the agent
list: they never shrink the HUD, and the mascot scene gets what is left.

## Status line (opt-in helper)

`statusLineText(data)` returns plain text. Segments are joined by ` │ `,
absent facts are dropped, and the result is at most 100 characters; the last
segments give way first (the cache, then todo, then git, then cost). `⚠ n`
counts the alert strip's alerts, right after who, when there are any; the
prompt cache's time left (`cache 42m`, `cache cold`) comes last, when it
fits. The caller appends its agents summary. The pane is the HUD's real
surface; this line is only for a caller that opts in.

```
opus 5.5 · xhigh │ ⚠ 2 │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5 │ cache 42m
opus 5.5 · xhigh │ ctx 41% │ 5h 31% · 7d 12% │ $4.21 │ main* +3 −1 ↑2 │ todo 3/5 │ cache cold
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
  - (on `turns`) the files the main loop edited this conversation (the
    distinct paths of its Edit, Write, MultiEdit and NotebookEdit calls that
    ended ok), moved here from the HUD's `now` row in 1.2.0.
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
session, then its agents". The alert strip hangs two cells in. Below a blank
row, every section's label sits one cell in, in a ten-cell gutter (six
narrow), on its first row only; the sub-labels (`repo`, `used`, `5h`, `cost`)
follow in a dim eight-cell column (seven narrow), and every value starts in
one column. The eye finds a section by its label, a fact by its sub-label,
and reads values down one edge.

The header and the cost are the only bold text, and the model name alone
carries the accent. Sections follow how often you need them: where you are
and what is running, how full the context is and how warm its cache, how
close the limits are, what it all costs.

**Close button.** The engine draws the pane's close button (`×`) over the
last cell of the first body row. The first row, the header whenever it
draws, ends at least two cells short of the pane's edge (`CLOSE_RESERVE`), so
the `×` never covers the working cell. Every right-aligned cell (the `now`
row's elapsed time) shares that edge; free text on later rows may use the
full width. From 74 columns up, the 72-cell card fits whole beside the
reserve.

**Alignment and stability.** The gauges share one grid: the value column,
then the bar (20 cells wide; 10 narrow, 8 below 44 columns, none at 36 and
under; the cache's bar the same), then the percent right-aligned in 4, then
the detail after three spaces (two narrow). A text row's second value starts
at one column wide (cell 37: `$3.51 / h`, `compact in ~6 turns`,
`agents 38% of spend`). The bars stack into one column and the percentages
line up.

Every value that changes on the 1 s tick sits in a fixed cell:
- working/idle: 16 cells (`● working 1h 12m` at its widest), at the edge
- the `now` row's elapsed time: 6 cells, at the edge
- cost: always two decimals (`$0.07`, `$52.60`); it changes on a
  measurement, never on the tick
- token count: 4 cells

A tick can change a digit but never moves a neighbour. A long MCP tool name
keeps its tool half (`browser_tak…`, not `playwright:…`).

**Colour.** Colour is reserved for the bars, the status glyphs, the model
name, `● working`, `out ~HH:MM`, a cooling cache and the alert strip. It is
all theme keys, so the HUD follows the person's theme:

| What | Theme key |
| --- | --- |
| `◆`, model name, `● working`, in-progress `◐` | `claude` |
| alert strip: asks, a limit running out (and `⚠` when one leads); a limit row's `out ~HH:MM` | `error` |
| alert strip: stalled agents, a compaction soon, the cache cooling | `warning` |
| alert strip: failed calls, behind upstream | `warning`, dim |
| TODO progress fill, a warm cache's fill | `success` |
| a cooling cache's fill and `cooling` | `warning` |
| bar fill below 60 % | `success` |
| 60 to 84 % | `warning` |
| 85 % and up | `error` |
| dirty-tree `*` | `warning` |
| active tab `[ Task ]`, the trail's current call (inspect view) | `claude` |
| a `denied` call (Trail tab) | `warning` |
| an `error` call (Trail tab) | `error` |

The threshold uses the percent as displayed, so a value shown as `85%` is
always red. The bar's track, the compaction mark `┃`, sub-labels, paths,
reset times, token counts, the runway, the cache's time left and a cold
cache, `○ idle`, the tool's argument and elapsed time, git marks, the
rate, the clock and the motto are dim. No element sets a background colour
or `inverse`, and no text is both bold and dim (the two share one reset code
in most terminals).

**Bar glyphs.** The fill is `━` and the empty track `─`, drawn as separate
spans: the fill in the level's colour, the track dim. A shade glyph such as
`░` renders as a solid grey block in some terminal fonts, and stacked bar
rows then merge into one blob. A heavy line over a light line stays two
distinct weights in any font, and leaves a gap between rows.

**Redundant encoding.** Nothing depends on colour alone:
- Bars show level by length: a heavy `━` against a light `─`.
- At 36 columns and under, where no bar fits, the percent itself is the
  reading; the cache's state is written out (`warm`, `cooling`, `cold`).
- Todo items show state by shape: `☑` done (and struck through), `◐` doing,
  `☐` pending.
- A dirty tree shows as `*`.
- The alert strip is words, led by `⚠`; colour only ranks them.
- The compaction threshold is a `┃` in the bar, and the runway is written
  out.

**Density.** One idea per row: the full sketch is fourteen rows, fifteen
with a motto, plus the TODO section. Given `rows`, the HUD takes at most
half the pane (never fewer than four rows) and drops rows by rank (see
"Short panes"); it never drops the alerts or the header first.

The HUD never depends on how many agents run. Its root and rows set
`flexShrink={0}`, so the agent list scrolls instead of squeezing it.

**Truncation.** Every row is measured in terminal cells (CJK and emoji
count two) and fits both `columns` and the 72-cell card. A value's
secondary pieces are left out whole when they do not fit; free text (path,
branch, alerts, the tool's argument, motto) is cut with `…`. A path loses
its leading directories first (`…/mods`), and the branch keeps at least
eight cells. Newlines and control characters in any text are flattened to
spaces.

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
