# clawd-hud-zq

A HUD side pane for Claude Code. It shows your session facts, context and rate-limit bars, cost, git state, tool calls, TODO list and every running subagent, including ultracode and Workflow agents, next to a live, animated scene of Claude mascots. The mascots work, sleep, hop, fly and collide, and you can grab them with the mouse and throw them.

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

- Click an agent row, or a mascot, to inspect it: its task, current tool, last calls and last answer replace the scene. Use Back to return.
- Grab a mascot by pressing and moving the mouse (or holding for 300 ms), drag it around, and let go to throw it. It flies on with the speed of your pointer, bounces, and lands.

## Configuration

Change any option from `/plugin` (select mod-hud, then its settings).

| Option | Default | What it does |
| --- | --- | --- |
| `stalledAfterSec` | `240` | A running subagent with no activity for this many seconds is drawn as stalled. |
| `statusLine` | `false` | Show the HUD and a count of running, done, failed and stalled subagents as one line in the status line. |
| `maxRows` | `40` | The pane lists at most this many subagents and workflow agents together and counts the rest. |
| `showGit` | `true` | Show the branch and its changes in the HUD. |
| `showTools` | `true` | Show the main conversation's tool calls and the tool running now. |
| `showTodos` | `true` | Show the main conversation's todo list. |
| `showInventory` | `true` | Show how many MCP servers and skills the session has. |
| `motto` | `Don't be afraid to do tedious work.` | A line drawn dim under the HUD; empty for none. |
| `mascots` | `true` | Fill the pane's spare rows with mascots: the session's own, and one per subagent in its own colour. |
| `showWorkflows` | `true` | Track the agents a Workflow run starts and show them under the subagents, in the summary and as mascots. |
| `inspect` | `true` | A button on every agent row and mascot opens that agent's detail view in place of the scene. |
| `wander` | `true` | Mascots between tools walk about their line, hop and, with a spare row above, glide. |
| `scenes` | `true` | Mascots act out real events: handing a task over, handing a report back, messages, review and fix visits, and a workflow squad's baton. |
| `collisions` | `rare` | `off`: wanderers that meet step back. `rare`: only two moving mascots collide, falling over dizzy, at most once per pair in 30 s. `normal`: a moving mascot knocks over a standing one too, once per pair in 10 s. In `rare` and `normal` a thrown mascot knocks over whoever it hits. |
| `motion` | `smooth` | `smooth`: on the terminal and desktop the scene runs at 20 frames a second, gliding between cells, with click, pick up, drag and throw. `classic`: the Box/Text scene at 4 frames a second everywhere, with a pick button under each mascot. |
| `todoRows` | `6` | The TODO section lists at most this many items and counts the rest. |

## What the pane shows

A card at the top of the pane, at most 72 cells wide, then the agent list, then the mascot scene in the spare rows.

```
◆ opus 5.5 · xhigh · gateway                              1h 12m   $4.21
  ~/.claude/mods · main* +3 −1 ↑2                      mcp 4 · skills 12
  ctx   ━━━━━━━━────────────  41%  412k / 1.0M             3 compactions
  5h    ━━━━━━──────────────  31%  ↻ 14:20
  7d    ━━──────────────────  12%  ↻ Tue
  tools Read ×41  Bash ×12  Edit ×9  Grep ×7  +1            ● Bash 00:04
  ship small, ship often
```

- Identity: model, effort, provider, elapsed time and cost.
- Place: working directory, git branch, changes and commits ahead; MCP server and skill counts.
- Bars: context, 5h and 7d limits, and a spend limit when there is one. Green below 60 %, amber from 60 to 84 %, red from 85 %.
- Tools: call counts and the tool running now.
- TODO list and one row per subagent (type, model, status, elapsed time, tool calls, current tool, result).
- Below 60 columns the card stacks into one section per row and degrades gracefully down to 36 columns.

## The mascots

- One mascot for your session, wearing a crown, and one per subagent and workflow agent, each in its own colour.
- A role letter above the head: `r` reviewer, `d` debugger, `p` Plan, `w` worker, `f` frontend, `e` Explore or researcher.
- Eight accessories (beanie, cap, top hat, flower, bow, halo, note, propeller) tell agents apart.
- Effort marks: none for low or medium, `✦` for high, `✦✦` for xhigh and max.
- They think, work at a laptop, ask for permission, sit, stretch, sleep under a blanket, wander and hop, and act out hand-offs, reports and reviews.
- Flights carry meaning: a web call sends a mascot into the sky, Explore agents scan the floor from above, a reading streak lifts off, finished agents fly out, and the session flies up on a compaction.
- Collisions (`collisions` setting) knock mascots over, dizzy, before they get up and carry on.
- Motion is `smooth` (20 fps, mouse grab and throw) or `classic` (4 fps, everywhere).

## Development

```
claude plugin validate mod-hud
claude plugin test mod-hud
tsc -p mod-hud/tsconfig.json
```

`mod-hud/.claude-plugin/types/` is generated by the Claude Code engine each time it loads the mod; it is git-ignored and not edited by hand.

## License

MIT, see [LICENSE](LICENSE). Copyright 2026 Dai Zi Qiao.
