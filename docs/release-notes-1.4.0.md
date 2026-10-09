# mod-hud 1.4.0

The session's mascot moves above the prompt, and it tidies up.

## The band above the prompt (new)
- The session's own crowned mascot now lives in the band just above the prompt, on the terminal and the desktop, whether the HUD is open or not. It still thinks, watches the subagents work, idles, sleeps, wanders its yard and can be picked up and thrown.
- The pane's scene holds the subagents and workflow agents. Without the session's mascot there, nobody walks a report back to it or takes a task from it in the pane.
- Click the band's mascot to open the HUD on the session's own view (Overview, Cost, Agents).
- VS Code and mobile draw no band, so there the session's mascot stays in the pane, as it does wherever the band has not drawn it yet.
- A new option, `sessionMascot`, chooses the band (`band`, the default) or the pane's scene as before (`pane`).

## Tidying up (new)
- Once the context passes `tidyAt` (150k tokens by default, never under 40k) and the main loop is idle, the band offers to tidy up: compact the conversation into a summary. On a model with a known price, it says how many requests the tidy takes to pay for itself.
- **Tidy up** compacts now (the same call `/compact` makes), telling the summary to keep the task in progress and its plan, the todos and their status, decisions, open questions and the files being worked on. **Not now** puts the offer off until the context has grown 50k tokens more.
- `tidy: auto` counts down ten seconds in the band after a main turn ends with no subagent running, then tidies up. **Not now** or a new prompt stops it. `tidy: off` never offers.
- While any compaction of the main conversation runs (yours, the built-in auto-compact, or a tidy), the session's mascot squashes a stack of pages beside it into a cube, over and over, and the band says it is tidying up. Afterwards the band shows the size before and after, `✓ tidied 182k → 21k (−88%)`, for 20 seconds. If Claude Code refuses a tidy, the band says why.
- `tidyAt` is a token count rather than a percentage of the window: the cost of a compaction against what it saves depends on how many tokens are re-read, not on the window's size. See "Tidying up" in the README.

