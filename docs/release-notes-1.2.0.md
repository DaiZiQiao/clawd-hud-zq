# mod-hud 1.2.0

The HUD redone into labelled sections, one idea per row, around what needs attention: an alert strip, the runway to the next compaction, the prompt cache counting down, what is running now, what the last turn cost, and a two-row TODO.

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

## Layout
- A header, the alert strip, a blank row, then four sections in a left gutter: `session`, `context`, `limits`, `usage`. Each row has a dim sub-label and its value in one column; the section's label stands on its first row shown.
- The header is the model, effort and provider (the first to give way) and the main loop `● working 00:42` (the accent) or `○ idle 3m` (dim) at the edge, read from the main loop's facts, kept whatever the options (mascots on or off). The session clock and cost moved to `usage · cost`.
- Below 60 columns the labels shorten (`sess`, `ctx`, `lim`, `use`), bars are 10 cells (8 below 44, none at 36 and under), and a value's secondary pieces are left out whole when they do not fit.
- A short pane keeps rows by rank: the alerts, the header, the context used, the limits, the tool running now, the cache, the cost, then the rest (branch, repo, growth, last turn, cache use, motto, the blank row). The close-button reserve and the every-fact-optional behaviour are kept: an absent fact hides its row, and a section with no rows hides its label.

## Alerts (new)
- A row under the header, drawn only while something needs attention: agents waiting for permission (tracked with mascots on or off), a rate limit that runs out before it resets (`5h out ~15:40, before ↻16:20`, from its burn over the last 30 minutes), stalled agents, a compaction within three turns, the prompt cache about to go cold (`cache cools in 2m · next turn rewrites 412k`), tool calls denied or failed in the last ten minutes (it clears on its own; the conversation's totals stay in the Overview), and the branch behind its upstream (`↓3 behind`).
- Most severe first, joined by ` · `, each in its own colour (`error`, `warning`, dim `warning`), the `⚠` in the most severe one's; cut to the card with `…`. Nothing to report, no row at all.
- The cache alert fires inside the smaller of two minutes and 20 % of the TTL: the last two minutes of a 1-hour cache, the last minute of a 5-minute one. A cache already cold is not an alert; the cache row says so, calmly.
- The opt-in status line counts them: `opus 5.5 · xhigh │ ⚠ 2 │ ctx 41% │ …`, leaving the stalled alert out when the agents summary it ends with already says `N stalled`. `/mod-hud facts` prints the counts under `alerts`.

## session
- `repo`: the working directory from `~`.
- `branch`: the branch, `*` when dirty, `↑2 ↓1`, the lines changed against HEAD (`git diff --shortstat HEAD`; the path counts stand in when there are none) and `last commit 48m ago` (`git log -1 --format=%ct`). Both commands run beside `git status` on the existing debounced git timer, never the tick; the status is written as soon as it answers, and any of the three timing out backs the timer off to 30 s. The commit time is read with `-c log.showSignature=false` (and from the last all-digit line), so a signature check cannot hide it.
- `now`: the main loop's tool running now, its main argument (a command, a pattern, a path from `~`) and its elapsed time at the edge; between tools a dim `—`. `showTools` still switches it. The files-edited count moved to the Session tab's Overview.

## context
- `used`: the bar with the auto-compact threshold marked `┃`, the percent and the tokens of the window.
- `growth` (new): the context's mean growth per main turn and `compact in ~6 turns` to the threshold (else the window). With auto-compaction off (`DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT`, `autoCompactEnabled: false`, or the breakdown saying so) there is no threshold mark, no runway and no compaction alert.
- `cache` (new): the main conversation's prompt cache, counted from when the main loop's last request was sent (read in `turn.step` before the request goes on, stamped in the usage write each request makes anyway; it errs early, never late). The bar drains as the TTL runs out (`success`, then `warning` while cooling) and reads `warm · 42m left (1h)`; once expired, an empty track and `cold · next turn rewrites 412k`, all dim.
- The TTL is inferred as Claude Code 2.1.292 picks it for the main thread: `DISABLE_PROMPT_CACHING` (no row), `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, the `promptCacheTtl` setting, `ENABLE_PROMPT_CACHING_1H` (any provider) or `ENABLE_PROMPT_CACHING_1H_BEDROCK` (Bedrock), else automatic: 5m on an API key, auth token, API key file descriptor, `apiKeyHelper` setting or partner cloud (Bedrock, Vertex, Foundry and the rest); 5m assumed with only a base URL; 1h assumed otherwise. An assumed TTL is drawn as a guess, `(1h?)` and `cache 42m?`: a Console (API-key) login and a subscription drawing on usage credits past its limits both get 5m and cannot be told apart at start. Once a response arrives, its rate limits (which the engine reports only on a subscription) firm the automatic TTL up: a `five_hour` or `seven_day` window means a subscription, 1h, certain, kept for the session (5m, certain, while one of those windows is at 100 % or past it); a response with none means most likely a Console login, 5m, still drawn as a guess (a gateway in front of a subscription that passes no limits through looks the same). A TTL the environment or settings decided is never moved. Only whether each variable is set is read; no value is kept. The new `cacheTtl` option (`auto`, `5m`, `1h`) overrides it and is never drawn as a guess.

## limits
- The 5h and 7d windows each on their own row, bars as wide as the context's, the reset, and `out ~13:43` (`error`) only while the window runs out before it resets. A spend limit keeps its own row.

## usage (new)
- `cost`: the session's cost (bold), its rate an hour once the session is five minutes old, and the session's clock.
- `last`: the last main turn: what the session spent from the previous main turn's end to this one's, its `durationMs`, and its own tokens (fresh input, cache writes and output of its main-loop requests). Kept in `usage.lastTurn`; starts over at `/clear`. The first cost the mod reads is the next turn's baseline, so the first turn after a load mid-session costs only itself; with no cost read then, it shows none. A main turn's end now writes its usage whatever `inspect` is set to, so the runway and this row always have their facts.
- `cache`: the share of the session's input served by the prompt cache, and the agents' (subagents', workflow agents', forks') share of the ledger's estimated spend, with `inspect` on; left out while any model booked has no price entry.

## TODO
- Two rows in the HUD's gutter, folded by default: ` todo ▸`, a bar of the items done and `done/total`, then the item in progress (else the next pending).
- Its `▸` is a Button: pressed, `▾` lists every item under the label row, at most `todoRows`; pressed again it folds. Kept in `mod-hud.listView.todosExpanded`, written on a press only.

## Moved or gone
- The session's tokens by kind, cache writes, the compaction count and the files edited are in the Session tab's Overview; the per-tool counts and the MCP/skill inventory in `/mod-hud facts`.
- The context breakdown is read whatever `showInventory` says (its auto-compact threshold feeds the compaction mark and runway); `showInventory` now only decides whether `/mod-hud facts` prints its MCP servers and skills.
- The files edited are counted for the Overview whatever `showTools` says.
- The `motto` option defaults to empty: no motto row unless you set one.

## Status line
- Unchanged, plus the cache's time left (`cache 42m`, `cache 42m?` on an assumed TTL, `cache cold`) as its last segment, the first to give way. While the cache is warm a timer of its own redraws it where the minute shown changes and as it goes cold, so it reads right with the pane closed and nothing running. Its `⚠` counts a denied or failed call the moment it ends, and the same timer redraws it as the oldest such call leaves its ten minutes, cold cache or not.

## Docs
- `docs/pane-sketch.md` is redrawn from the renderer at 74, 72, 60, 56, 48, 40 and 36 columns, with the cold and cooling cache, short panes and the TODO section; the README's options table and "What the pane shows" follow.
