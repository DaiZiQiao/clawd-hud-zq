# mod-hud 1.2.0

The HUD redone around what needs attention: an alert strip, the runway to the next compaction, what is running now, and a one-line TODO.

## Alerts (new)
- A row under the identity, drawn only while something needs attention: agents waiting for permission, a rate limit that runs out before it resets (`5h out ~15:40, before ↻16:20`, from its burn over the last 30 minutes), stalled agents, a compaction within three turns, tool calls denied or failed, and the branch behind its upstream (`↓3 behind`).
- Most severe first, joined by ` · `, each in its own colour (`error`, `warning`, dim `warning`), the `⚠` in the most severe one's; cut to the card with `…`. Nothing to report, no row at all.
- The opt-in status line counts them: `opus 5.5 · xhigh │ ⚠ 2 │ ctx 41% │ …`.
- `/mod-hud facts` prints the counts under `alerts`.

## HUD
- The identity row shows the main loop `● working 00:42` (the accent) or `○ idle 3m` (dim), in a fixed cell; it gives way after the provider, before the effort. It is read from the main loop's facts, kept with mascots on.
- The ctx bar marks the auto-compact threshold with a dim `┃`, and the row ends `compact in ~6 turns`: the turns until the threshold (else the window) at the context's growth over the last ten main turns. With no growth known it shows the compaction count, as before.
- Wide, the 5h and 7d windows share one row of 8-cell bars; narrow they stack as before. A spend limit keeps its own row.
- The `tools` row is now the `now` row: the main loop's tool running now, its main argument (a command, a pattern, a path from `~`) and elapsed time, then `N files edited` (distinct files the main loop's Edit, Write, MultiEdit and NotebookEdit calls changed this conversation; starts over at `/clear`). `showTools` still switches it.
- The token, cache and MCP/skill rows are gone. The Session tab's Overview keeps the tokens; `/mod-hud facts` keeps the per-tool counts and the inventory.
- `showInventory` now only decides whether the context breakdown is read: it feeds the compaction mark and runway, and `/mod-hud facts`.
- The `motto` option defaults to empty: no motto row unless you set one.

## TODO
- Folded by default to one line: `▸ TODO  ━━━━────── 3/7  ◐ Wiring the detail view` (the item in progress, else the next pending).
- Its `▸` is a Button: pressed, `▾` lists every item under the line as before, at most `todoRows`; pressed again it folds. Kept in `mod-hud.listView.todosExpanded`, written on a press only.

## Docs
- `docs/pane-sketch.md` is redrawn from the renderer at 74, 72, 60, 56, 48, 40 and 36 columns, with the alert strip, the TODO line and the new rows; the README's options table and "What the pane shows" follow.
