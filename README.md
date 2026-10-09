# clawd-hud-zq

A HUD side pane for Claude Code. It shows your session facts, what needs your attention, git state and the tool running now, context and prompt-cache bars, rate limits, cost, TODO progress and every running subagent, including ultracode and Workflow agents, next to a live, animated scene of Claude mascots. The mascots work, sleep, hop, fly and collide, and you can grab them with the mouse and throw them. In the desktop app and in terminals that show pictures (Ghostty, kitty), they are drawn as smooth vector art at 30 frames a second, with every pose easing into the next.

Your session's own mascot lives in the band just above the prompt, so it is there even with the HUD closed. When the conversation's context has grown, it offers to tidy up (compact the conversation), and it squashes a pile of pages into a cube while any compaction runs.

This repository is a Claude Code marketplace that ships one mod, `mod-hud`.

## Screenshots

![The HUD pane](docs/screenshots/pane.png)

![The mascot scene](docs/screenshots/mascots.png)

> TODO (author): add `docs/screenshots/pane.png` and `docs/screenshots/mascots.png`.

## Requirements

- Claude Code 2.1.287 or newer, with mods support.
- A terminal font with box-drawing glyphs.
- The pane docks at 110 columns or wider, or in fullscreen.
- Works in the terminal and in Claude Desktop. Mouse drag and throw need the terminal or the desktop app; VS Code and mobile fall back to the classic renderer.
- The smooth vector mascots need the desktop app or a terminal with the kitty graphics protocol (Ghostty, kitty). Other terminals (macOS Terminal, Windows Terminal, tmux) draw the block-character mascots.
- Windows and WSL are expected to work but are unverified.

## Install

From inside Claude Code:

```
/plugin marketplace add DaiZiQiao/clawd-hud-zq
/plugin install mod-hud@clawd-hud-zq
```

Then restart Claude Code.

Alternatively, clone this repository and add the `mod-hud` folder to `CLAUDE_CODE_PLUGIN_DIRS`:

```
git clone https://github.com/DaiZiQiao/clawd-hud-zq
export CLAUDE_CODE_PLUGIN_DIRS="$PWD/clawd-hud-zq/mod-hud"
```

## Usage

| Command | What it does |
| --- | --- |
| `/mod-hud` | Open or close the HUD pane. |
| `/mod-hud clear` | Drop finished agents from the board. |
| `/mod-hud facts` | Print the data the HUD draws from, as JSON, and whether rate limits have been seen. |

- Click a mascot (or an agent row) to inspect it: the mascot walks to the pane's centre and grows into a TV of itself, the screen on its forehead showing its tabs (Task, Trail, Said, Agents; the crowned session's Overview, Cost, Agents). On the panel right of the screen, the dial and `◀ ▶` change channel (tab), and the knob and `▲ ▼` scroll (hold `▲ ▼` to keep scrolling), as do the arrow keys and the wheel. Its `✕`, `q` or a click anywhere else switches the screen off and sends it home, shaken for three seconds. Where a surface cannot draw the TV (VS Code, mobile) or the pane is too small, the inspect view takes the scene's place instead; use Back to return.
- Grab a mascot by pressing and moving the mouse (or holding for 300 ms), drag it around, and let go to throw it. It flies on with the speed of your pointer, bounces, and lands.
- The crowned mascot above the prompt is your session's. Click it to open the HUD on the session's own view (Overview, Cost, Agents). When the band offers to tidy up, **Tidy up** compacts the conversation now and **Not now** puts it off until the context has grown 50k tokens more. See [Tidying up](#tidying-up).

## Configuration

Change any option from `/plugin` (select mod-hud, then its settings).

| Option | Default | What it does |
| --- | --- | --- |
| `stalledAfterSec` | `240` | A running subagent with no activity for this many seconds is drawn as stalled. |
| `statusLine` | `false` | Show the HUD and a count of running, done, failed and stalled subagents as one line in the status line. |
| `maxRows` | `40` | The pane lists at most this many subagents and workflow agents together and counts the rest. |
| `showGit` | `true` | Show the branch, its lines changed and its last commit in the HUD (`session · branch`). |
| `showTools` | `true` | Show the `session · now` row: the main conversation's tool running now, its main argument and elapsed time. The files edited (Session tab, Overview) are counted either way. |
| `showTodos` | `true` | Show the main conversation's todo list: a progress row and the item in progress, which its `▸` opens to every item. |
| `showInventory` | `true` | Print the context breakdown's MCP servers and skills in `/mod-hud facts`. The breakdown is read either way (at most every five minutes) for the auto-compact threshold, which marks the context bar and bounds the compaction runway. Since 1.2.0 the HUD no longer draws the MCP and skill counts. |
| `motto` | empty | A line drawn dim under the HUD; empty (the default since 1.2.0) for none. |
| `mascots` | `true` | Fill the pane's spare rows with mascots: the session's own, and one per subagent in its own colour. |
| `character` | `clawd` | Who the mascots are. `clawd`: Claude Code's Clawd, each agent in its own colour with its role letter and an accessory. `usagi`: Usagi from Chiikawa (fan art), each agent's role shown by its hat and the session's by a crown on the side of its head. |
| `showWorkflows` | `true` | Track the agents a Workflow run starts and show them under the subagents, in the summary and as mascots. |
| `inspect` | `true` | A button on every agent row and mascot opens that agent's detail view (the TV, or in place of the scene). |
| `inspectView` | `tv` | `tv`: an inspected mascot grows into a TV of itself over the pane (terminal and desktop, in a pane of at least 42 columns and 20 rows for Clawd, 44 and 19 for Usagi). `pane`: the inspect view in place of the scene, as before 1.3.0. |
| `wander` | `true` | Mascots between tools walk about their line, hop and, with a spare row above, glide. |
| `scenes` | `true` | Mascots act out real events: handing a task over, handing a report back, messages, review and fix visits, and a workflow squad's baton. |
| `collisions` | `rare` | `off`: wanderers that meet step back. `rare`: only two moving mascots collide, falling over dizzy, at most once per pair in 30 s. `normal`: a moving mascot knocks over a standing one too, once per pair in 10 s. In `rare` and `normal` a thrown mascot knocks over whoever it hits. |
| `motion` | `smooth` | `smooth`: on the terminal and desktop the scene runs at 20 frames a second, gliding between cells, with click, pick up, drag and throw. `classic`: the Box/Text scene at 4 frames a second everywhere, with a pick button under each mascot. |
| `mascotArt` | `vector` | `vector`: in the desktop app, and in Ghostty or kitty (known by their own environment variables, never under tmux), the mascots are drawn shapes at 30 frames a second, each pose eased into the next. Other terminals draw the block characters, as does a terminal that refuses a picture. `blocks`: the block characters everywhere. Needs `motion: smooth`. The TV is drawn smooth too (in Ghostty and kitty its giant is a picture under the screen). |
| `todoRows` | `6` | Opened, the TODO section lists at most this many items and counts the rest. |
| `sessionMascot` | `band` | `band`: the session's mascot lives in the band above the prompt on the terminal and desktop, so it shows with the HUD closed too, and the pane's scene holds the subagents. VS Code and mobile draw no band, so there it stays in the pane. `pane`: in the pane's scene with the subagents, as before 1.4.0. |
| `tidy` | `ask` | `ask`: once the context passes `tidyAt` and the main loop is idle, the band offers to tidy up, with how many requests it takes to pay for itself. `auto`: when a main turn ends with no subagent running, the band counts down ten seconds, then tidies up; **Not now** or a new prompt stops it. `off`: never offered. Whatever it says, the mascot tidies up during any compaction and the band shows the result. |
| `tidyAt` | `150` | The context, in thousands of tokens, past which a tidy is offered (never under 40). See [Tidying up](#tidying-up) for why it is a token count and not a percentage. |
| `cacheTtl` | `auto` | The main conversation's prompt-cache TTL the `context · cache` row counts down: `auto` infers it as Claude Code 2.1.292 picks it (`FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, the `promptCacheTtl` setting, `ENABLE_PROMPT_CACHING_1H` on any provider and `ENABLE_PROMPT_CACHING_1H_BEDROCK` on Bedrock honoured; else 5m on an API key, auth token, `apiKeyHelper`, Bedrock, Vertex, Foundry or another partner cloud, and 1h otherwise). Until the first response the automatic TTL is drawn as a guess, `(1h?)` (a Console API-key login, a subscription drawing on usage credits past its limits and a base URL that may be a gateway cannot be told apart at start); then the responses' rate limits settle it: a 5-hour or 7-day window means a subscription, 1h, certain (5m, certain, while a window is at 100 % or past it), and none means most likely a Console login, 5m, still a guess. Set `5m` or `1h` to make it certain. |

## What the pane shows

A card at the top of the pane, at most 72 cells wide, then the TODO section, the agent list, and the mascot scene in the spare rows.

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

- Header: model, effort, provider, and whether the main loop is working (`● working 00:42`) or idle (`○ idle 3m`), with or without mascots.
- Alerts (`⚠`), only when something needs attention, most severe first: agents waiting for permission (with or without mascots), a rate limit that runs out before it resets, stalled agents, a compaction within three turns, the prompt cache about to go cold (`cache cools in 2m · next turn rewrites 412k`), tool calls denied or failed in the last ten minutes, and the branch behind its upstream. Nothing to report, no row.
- `session`: the working directory (`repo`); the branch, dirty mark, commits ahead/behind, lines changed against HEAD (added in green, deleted in red) and the last commit's age (`branch`); the tool running in the main conversation, its argument and how long it has run (`now`).
- `context`: the context used, with the auto-compact threshold marked `┃` (`used`); its growth per turn and the turns left until it compacts (`growth`; none when auto-compaction is off); the prompt cache counting down from when the main loop's last request was sent, `cold · next turn rewrites 412k` once it has expired, its TTL in parens and `(1h?)` when that is a guess (`cache`). Green below 60 %, amber from 60 to 84 %, red from 85 %.
- `limits`: the 5h and 7d windows (and a spend limit) each on its own row, with the reset, and `out ~13:43` when one runs out before it resets.
- `usage`: the session's cost, its rate an hour and the session clock (`cost`); the last main turn's cost, length and tokens (`last`; after a load mid-session, the first turn counts only its own cost); the cache hit rate and the agents' share of the spend (`cache`; left out while a model in use has no price entry).
- `todo`: the share done and the item in progress; press `▸` to list every item, `▾` to fold it again.
- One row per subagent (type, model, status, elapsed time, tool calls, current tool, result).
- Below 60 columns the labels shorten (`sess`, `ctx`, `lim`, `use`), the bars shrink, and pieces that no longer fit are left out, down to 36 columns. On a short pane the HUD keeps the most needed rows: alerts, header, context used, limits, the tool running now, the cache, the cost, then the rest.
- The session's tokens by kind, the compaction count and the files edited are in the session's inspect view (Overview tab); per-tool counts and the MCP/skill inventory are in `/mod-hud facts`.

## Tidying up

Every request re-reads the whole conversation, mostly from the prompt cache, which is cheap but not free. A compaction (what `/compact` does) replaces the conversation with a summary, so the requests after it read far less. But writing the summary costs output tokens (the dearest kind), the new context has to be cached again, and Claude often re-reads a few files afterwards.

- **When.** A tidy pays off once the context is large in absolute terms. In a simple model of a long session (Opus 5.5 prices, 300 requests), compacting at roughly 100k to 200k tokens cost least. At 80k it cost about 30 to 65 % more, because summaries were written too often. Waiting for the default auto-compact on a 1M window cost about 60 to 75 % more. That is why `tidyAt` is a token count (150k by default), not a share of the window: 40 % of a 1M window is 400k (late), 40 % of a 200k window is 80k (early). A short session never earns a tidy back, so none is offered under 40k.
- **The offer.** It shows the context's size and, for a model with a known price, how many requests the tidy takes to pay for itself: its one-off cost over what each later request saves. The estimate uses the last tidy's size after (30k until there has been one) and a 12k summary. It is a guide, not a bill.
- **Running it.** **Tidy up** asks Claude Code for a compaction (the same call `/compact` makes) and tells the summary to keep the task in progress and its plan, the todo list with each item's status, decisions and why, open questions, and the files being worked on. While it runs, the band says so; afterwards it shows the size before and after (`✓ tidied 182k → 21k (−88%)`) for 20 seconds. If Claude Code refuses (a turn is running, compaction is disabled), the band says why.
- **Any compaction.** Your own `/compact` and the built-in auto-compact get the same animation and result, whatever `tidy` says.
- **Quality.** A summary loses detail. Tidying between tasks, rather than in the middle of one, keeps what matters. That is why it is offered rather than forced unless you choose `auto`.

## The mascots

- One mascot for your session, wearing a crown, in the band above the prompt (or in the pane, with `sessionMascot: pane`), and one per subagent and workflow agent in the pane, each in its own colour.
- While a compaction runs, the session's mascot tidies up: it squashes a stack of pages beside it into a cube, over and over, and the next stack lands.
- A role letter above the head: `r` reviewer, `d` debugger, `p` Plan, `w` worker, `f` frontend, `e` Explore or researcher.
- Eight accessories (beanie, cap, top hat, flower, bow, halo, note, propeller) tell agents apart.
- Effort marks: none for low or medium, `✦` for high, `✦✦` for xhigh and max.
- They think, work at a laptop, ask for permission, sit, stretch, sleep under a blanket, wander and hop, and act out hand-offs, reports and reviews.
- Flights carry meaning: a web call sends a mascot into the sky, Explore agents scan the floor from above, a reading streak lifts off, finished agents fly out, and the session flies up on a compaction.
- Collisions (`collisions` setting) knock mascots over, dizzy, before they get up and carry on.
- Motion is `smooth` (20 fps, mouse grab and throw) or `classic` (4 fps, everywhere).
- In the desktop app and in Ghostty or kitty, Clawd and Usagi are drawn as vector art (`mascotArt: vector`): round edges, squash and stretch that bounce back, falls that turn over, blinking and breathing, legs that walk, propellers that spin, every interaction the block art shows. In a terminal the scene is a picture swapped about 30 times a second, about 10 while everyone stands still. Other terminals get the block art automatically. See [the vector art](mod-hud/docs/mascots.md#the-vector-art).
- Pressed, a mascot becomes a TV of itself, in its own colour and wearing its own accessory, hat or crown (pressed in flight, its propeller cap): Clawd's body or Usagi's round head the casing, the screen on its forehead, its eyes (and Usagi's cheeks and mouth) under it, its arms, legs and what it wears around it. With the vector art it flies in and grows smoothly and the giant is drawn smooth, Usagi's ears standing up as the TV's rabbit-ear antenna. See [the TV](mod-hud/docs/mascots.md#the-tv).
- `character: usagi` swaps every mascot for Usagi (fan art): in the vector art drawn as Chiikawa draws it (a big round head on a small body, long ears together, glinting dot eyes under high curved brows, pink cheeks with three dark strokes, a rabbit's mouth, a tufted tail, a bold outline), pale yellow, its role shown by its hat (worker a construction hat, Explore a fedora, reviewer a mortarboard, debugger a miner's helmet, Plan a top hat, frontend a beret), the session's by a small crown on the side of its head; it shouts `Ura!`, `Yaha!`, `HUHHH?` and `UNA!` where Clawd thinks out loud. Like Chiikawa's Usagi it is chaotic: out of nowhere it breaks into the Yaha! dance, an Ura! leap, a HUHHH? lean-in, a smug Fuun, zoomies, a twirl, a backflip or an UNA! shake, and bashes its keyboard at work; on foot it sprints at twice Clawd's pace, its legs a spinning wheel. See [the mascot docs](mod-hud/docs/mascots.md#usagis-chaos).

## Development

```
claude plugin validate mod-hud
claude plugin test mod-hud
tsc -p mod-hud/tsconfig.json
```

`mod-hud/.claude-plugin/types/` is generated by the Claude Code engine each time it loads the mod; it is git-ignored and not edited by hand.

## License

MIT, see [LICENSE](LICENSE). Copyright 2026 Dai Zi Qiao.
