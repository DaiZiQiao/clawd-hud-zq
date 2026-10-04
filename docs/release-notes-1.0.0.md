# mod-hud 1.0.0

First public release.

## HUD
- Session card: model, effort, provider, elapsed time and cost.
- Context bar with token counts and compaction count; 5h, 7d and spend limit gauges (green below 60 %, amber to 84 %, red from 85 %).
- Git branch with changes and commits ahead; tool-call counts and the tool running now; MCP server and skill counts; optional motto.
- TODO section for the main conversation's todo list.
- Wide and narrow layouts, down to 36 columns.
- Opt-in status line summary.

## Agents
- Every running subagent, with type, model, status, elapsed time, tool calls, current tool and result.
- Workflow agents (ultracode and other Workflow runs) tracked and listed under the subagents.
- Stalled detection; click a row or mascot to open a detail view (task, current tool, last calls, last answer).

## Mascots
- One mascot for the session (crowned) and one per agent, with role letters, accessories and effort marks.
- Work, think, ask, sleep, stretch, sit, wander, hop and act out orchestration scenes.
- Flights with meaning (web calls, Explore agents, reading streaks, errands, compaction).
- Collisions (`off`, `rare`, `normal`) with knocked-over animations.
- Smooth 20 fps scene on the terminal and desktop: grab, drag and throw mascots with the mouse. Classic 4 fps renderer for VS Code and mobile.

## Commands
- `/mod-hud` toggles the pane; `/mod-hud clear` drops finished agents; `/mod-hud facts` prints the data the HUD draws from.
