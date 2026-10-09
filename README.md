# clawd-hud-zq

A HUD side pane for Claude Code. It shows your session facts, what needs your attention, git state and the tool running now, context and prompt-cache bars, rate limits, cost, TODO progress and every running subagent, including ultracode and Workflow agents, next to a live, animated scene of Claude mascots. The mascots work, sleep, hop, fly and collide, and you can grab them with the mouse and throw them.

And a strip above the prompt: thumbnails of the images you paste into Claude Code, shown before you send, real pixels in kitty and Ghostty and coloured half-block cells in other terminals.

This repository is a Claude Code marketplace that ships two mods, `mod-hud` (the HUD pane) and `mod-images` (the image strip). Each installs on its own: take either, or both. Everything below is mod-hud's until [mod-images](#mod-images).

## Screenshots

![The HUD pane](docs/screenshots/pane.png)

![The mascot scene](docs/screenshots/mascots.png)

> TODO (author): add `docs/screenshots/pane.png` and `docs/screenshots/mascots.png`.

## Requirements

- Claude Code 2.1.287 or newer, with mods support.
- A terminal font with box-drawing glyphs.
- The pane docks at 110 columns or wider, or in fullscreen.
- Works in the terminal and in Claude Desktop. Mouse drag and throw need the terminal or the desktop app; VS Code and mobile fall back to the classic renderer.
- Windows and WSL are expected to work but are unverified.

## Install

From inside Claude Code:

```
/plugin marketplace add DaiZiQiao/clawd-hud-zq
/plugin install mod-hud@clawd-hud-zq
/plugin install mod-images@clawd-hud-zq
```

Either install line works on its own. Then restart Claude Code.

Alternatively, clone this repository and add the mod folders you want to `CLAUDE_CODE_PLUGIN_DIRS` (separated by `:`, or `;` on Windows):

```
git clone https://github.com/DaiZiQiao/clawd-hud-zq
export CLAUDE_CODE_PLUGIN_DIRS="$PWD/clawd-hud-zq/mod-hud:$PWD/clawd-hud-zq/mod-images"
```

In PowerShell:

```
git clone https://github.com/DaiZiQiao/clawd-hud-zq
$env:CLAUDE_CODE_PLUGIN_DIRS = "$PWD\clawd-hud-zq\mod-hud;$PWD\clawd-hud-zq\mod-images"
```

## Usage

| Command | What it does |
| --- | --- |
| `/mod-hud` | Open or close the HUD pane. |
| `/mod-hud clear` | Drop finished agents from the board. |
| `/mod-hud facts` | Print the data the HUD draws from, as JSON, and whether rate limits have been seen. |

- Click a mascot (or an agent row) to inspect it: the mascot walks to the pane's centre and grows into a TV of itself, the screen on its forehead showing its tabs (Task, Trail, Said, Agents; the crowned session's Overview, Cost, Agents). On the panel right of the screen, the dial and `◀ ▶` change channel (tab), and the knob and `▲ ▼` scroll (hold `▲ ▼` to keep scrolling), as do the arrow keys and the wheel. Its `✕`, `q` or a click anywhere else switches the screen off and sends it home, shaken for three seconds. Where a surface cannot draw the TV (VS Code, mobile) or the pane is too small, the inspect view takes the scene's place instead; use Back to return.
- Grab a mascot by pressing and moving the mouse (or holding for 300 ms), drag it around, and let go to throw it. It flies on with the speed of your pointer, bounces, and lands.

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
| `todoRows` | `6` | Opened, the TODO section lists at most this many items and counts the rest. |
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
- `session`: the working directory (`repo`); the branch, dirty mark, commits ahead/behind, lines changed against HEAD and the last commit's age (`branch`); the tool running in the main conversation, its argument and how long it has run (`now`).
- `context`: the context used, with the auto-compact threshold marked `┃` (`used`); its growth per turn and the turns left until it compacts (`growth`; none when auto-compaction is off); the prompt cache counting down from when the main loop's last request was sent, `cold · next turn rewrites 412k` once it has expired, its TTL in parens and `(1h?)` when that is a guess (`cache`). Green below 60 %, amber from 60 to 84 %, red from 85 %.
- `limits`: the 5h and 7d windows (and a spend limit) each on its own row, with the reset, and `out ~13:43` when one runs out before it resets.
- `usage`: the session's cost, its rate an hour and the session clock (`cost`); the last main turn's cost, length and tokens (`last`; after a load mid-session, the first turn counts only its own cost); the cache hit rate and the agents' share of the spend (`cache`; left out while a model in use has no price entry).
- `todo`: the share done and the item in progress; press `▸` to list every item, `▾` to fold it again.
- One row per subagent (type, model, status, elapsed time, tool calls, current tool, result).
- Below 60 columns the labels shorten (`sess`, `ctx`, `lim`, `use`), the bars shrink, and pieces that no longer fit are left out, down to 36 columns. On a short pane the HUD keeps the most needed rows: alerts, header, context used, limits, the tool running now, the cache, the cost, then the rest.
- The session's tokens by kind, the compaction count and the files edited are in the session's inspect view (Overview tab); per-tool counts and the MCP/skill inventory are in `/mod-hud facts`.

## The mascots

- One mascot for your session, wearing a crown, and one per subagent and workflow agent, each in its own colour.
- A role letter above the head: `r` reviewer, `d` debugger, `p` Plan, `w` worker, `f` frontend, `e` Explore or researcher.
- Eight accessories (beanie, cap, top hat, flower, bow, halo, note, propeller) tell agents apart.
- Effort marks: none for low or medium, `✦` for high, `✦✦` for xhigh and max.
- They think, work at a laptop, ask for permission, sit, stretch, sleep under a blanket, wander and hop, and act out hand-offs, reports and reviews.
- Flights carry meaning: a web call sends a mascot into the sky, Explore agents scan the floor from above, a reading streak lifts off, finished agents fly out, and the session flies up on a compaction.
- Collisions (`collisions` setting) knock mascots over, dizzy, before they get up and carry on.
- Motion is `smooth` (20 fps, mouse grab and throw) or `classic` (4 fps, everywhere).
- Pressed, a mascot becomes a TV of itself, in its own colour and wearing its own accessory, hat or crown (pressed in flight, its propeller cap): Clawd's body or Usagi's round head the casing, the screen on its forehead, its eyes (and Usagi's cheeks and mouth) under it, its arms, legs and what it wears around it. See [the TV](mod-hud/docs/mascots.md#the-tv).
- `character: usagi` swaps every mascot for Usagi (fan art): pale yellow, its role shown by its hat (worker a construction hat, Explore a fedora, reviewer a mortarboard, debugger a miner's helmet, Plan a top hat, frontend a beret), the session's by a small crown on the side of its head; it shouts `Ura!`, `Yaha!`, `HUHHH?` and `UNA!` where Clawd thinks out loud. See [the mascot docs](mod-hud/docs/mascots.md#usagi).

## mod-images

Thumbnails of the images in the prompt you are writing, in the strip Claude Code keeps directly above the prompt. Paste an image or drag an image file in: Claude Code puts `[Image #1]` in the prompt, and a moment later the strip shows the picture labelled `#1` with the size Claude Code stored, which is what it sends (it shrinks a large paste: a 3000x1875 screenshot is stored as 2000x1250). Delete the chip and its thumbnail goes; send the prompt and the strip clears. It only shows: it never changes the prompt or what is sent. It needs Claude Code 2.1.295 or newer.

```
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀                                      [-]
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
#1 1600x1000        #2 1500x1000

────────────────────────────────────────────────────────────────────────────────
❯ [Image #1] [Image #2] which of these shows the sidebar bug?
────────────────────────────────────────────────────────────────────────────────
```

### Terminals

| Terminal | Thumbnails |
| --- | --- |
| kitty 0.28 or newer, Ghostty (outside tmux and screen) | Real pixels. |
| Windows Terminal with PowerShell | Coloured half-block cells, full colour. |
| WSL in Windows Terminal | Half-block cells in 256 colours; full colour after `export COLORTERM=truecolor` in the WSL shell profile. |
| macOS Terminal | Half-block cells in 256 colours. |
| Desktop app, the VS Code extension's panel, mobile app | Nothing: mod-images draws in a terminal only. In VS Code's integrated terminal it draws half-block cells. |

Seen on screen so far only on Linux, in 256 colours and in full colour. kitty's and Ghostty's pixels, Windows Terminal, WSL and macOS Terminal follow from the same code but were not seen yet: `/mod-images test` shows what yours draws.

A half-block cell is the character `▀` coloured as two pixels, one above the other, so a thumbnail 8 rows tall is 16 pixels tall: enough to tell images apart, not to read text in them. In kitty and Ghostty the strip draws pixels, then asks Claude Code whether they reached the screen; where they did not (tmux in between, an older kitty, no answer from the terminal), it switches to half-block cells.

### Usage

- Paste with Ctrl+V (Cmd+V also works in macOS Terminal; Alt+V on Windows and WSL), or drag an image file onto the terminal.
- Remove an image by deleting its `[Image #N]` chip: Backspace right after the chip deletes all of it, and its tile goes.
- The strip shows only the images that will be sent: a chip typed by hand or recalled from history with ↑ is a dashed `not attached` tile, since Claude Code does not re-attach images from history. A prompt Claude Code puts back after Esc stops a turn before any answer keeps its images, and the strip shows them.
- In a short terminal, under a survey, or when another plugin also draws above the prompt, the strip is one line. Claude Code's `[-]` (or ctrl+x ctrl+a) folds and unfolds the whole space above the prompt.
- To check it is installed, run `/mod-images`: it answers `mod-images: version 1.0.0 on Claude Code …`, then says how it draws in this terminal.
- Nothing above the prompt? `▸ plugin panel hidden` means the space is folded: press ctrl+x ctrl+a. Otherwise `/mod-images` says how it draws, where it looked for the image folder and what the last strip held.

| Command | What it does |
| --- | --- |
| `/mod-images` | Print what the plugin sees: how it draws here and why, the colours and how to get more, the image folder, the last strip and the room it had. |
| `/mod-images test` | Draw a sample strip for 10 seconds, to check a terminal without pasting anything. |

### Configuration

Change either option from `/plugin` (select mod-images, then its settings).

| Option | Default | What it does |
| --- | --- | --- |
| `height` | `8` | The tallest the thumbnails get, from 3 to 20 rows. The strip always shrinks to fit the room above the prompt: about 6 rows in an 80x24 terminal, 8 in 120x30. |
| `pictures` | `auto` | `auto`: real pixels where the terminal draws them, half-block cells elsewhere, and one line of text when `NO_COLOR` or `CLAUDE_AX_SCREEN_READER` is set. `blocks`: always half-block cells. `text`: one line naming the images; choose it when screen-reader mode is on through its setting or `--ax-screen-reader`, which a plugin cannot see. |

### How it works, and its limits

Claude Code saves each pasted image the moment it is pasted, in a temporary folder of the session's own; mod-images finds that folder and decodes the picture itself (PNG, JPEG, GIF and lossless WebP), in slices of about 8 ms, so Claude Code never waits on it long (a lossless WebP decodes in one go: about 0.1 s for a plain 1280x854 screenshot, up to half a second for a photo). That folder is not a documented interface: this was built and checked against Claude Code 2.1.295 on Linux, with the Windows and macOS locations read from the same code. If a later version moves it, the tiles read `not found` and `/mod-images` shows where it looked. See [the strip](mod-images/docs/strip.md) for the details.

- Lossy and animated WebP files, and CMYK, 12-bit, arithmetic-coded or lossless JPEGs, get a `no preview` tile; files over 4 MiB, and lossless WebP files over about a megapixel (larger than 1280x854), a `too big` one.
- After Esc Esc and then ↑, Claude Code drops the images of the recalled prompt, but the strip still shows them.
- No thumbnails when Claude Code keeps no image folder: with `CLAUDE_CODE_SKIP_PROMPT_HISTORY` set, or in a nested session. Each tile then reads `no preview`.

## Development

```
claude plugin validate --strict .
claude plugin validate mod-hud
claude plugin test mod-hud
tsc -p mod-hud/tsconfig.json
claude plugin validate mod-images
claude plugin test mod-images
tsc -p mod-images/tsconfig.json
```

Each mod's `.claude-plugin/types/` is generated by the Claude Code engine each time it loads the mod (start one session with `claude --plugin-dir <mod>` in a fresh clone before running `tsc`); it is git-ignored and not edited by hand.

## License

MIT, see [LICENSE](LICENSE). Copyright 2026 Dai Zi Qiao.

mod-images vendors [@nktkas/webp](https://www.npmjs.com/package/@nktkas/webp) 1.0.0 in `mod-images/hooks/vendor-webp/` under its own MIT licence (Copyright (c) 2026 nktkas), kept beside it.

mod-images' PNG tests include [PngSuite](http://www.schaik.com/pngsuite/) by Willem van Schaik, (c) 1996, 2011, whose notice grants permission to use, copy, modify and distribute the images for any purpose and without fee; the notice is kept in `mod-images/hooks/decode-png.fixtures.ts`.
