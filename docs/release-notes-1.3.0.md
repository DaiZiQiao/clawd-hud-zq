# mod-hud 1.3.0

Press a mascot and it becomes a TV of itself.

## The TV (new)
- Pressing a mascot (or an agent's row) sends it to the pane's centre, where it grows into a TV of itself over the pane: its body is the casing, the screen sits on its forehead, and its eyes (and Usagi's cheeks and mouth) sit under the screen. Its arms, legs, accessory, hat or crown stay around it. The pane shows through around it; on the desktop the pane is dimmed under it.
- The screen shows the inspect view's tabs as channels: Task, Trail, Said and Agents for an agent; Overview, Cost and Agents for the crowned session.
- The left panel changes channel: its knob goes on a channel, `◀ ▶` back and on, round the tabs. The right panel scrolls: its knob a screenful, `▲ ▼` a row, repeating while held. Clicked, the TV takes the arrow keys, Page Up and Down, Home and End; the wheel scrolls it too. A tab, a model's line or an agent's `▸` on the screen can be pressed as in the pane.
- Opening, the mascot flies to the centre and grows, and the screen switches on: a bright line, then the picture opening out of it. A channel change flickers with static. Closing (its `✕`, `q`, or a click anywhere else in the pane), the screen switches off first, folding into a line and then a dot, and the mascot shrinks back and flies home.
- Back in the scene, the mascot is shaken for three seconds: it shakes its head, then stands wide-eyed and sweating, `!?` beside it (Usagi shouts `HUHHH?!`), before carrying on.
- Clawd's TV keeps its notch eyes, arms, four legs and accessory (or crown); Usagi's keeps its ears, its role's hat (or the session's side crown), cheeks, mouth and feet.
- A new option, `inspectView`, chooses the TV (`tv`, the default) or the inspect view in place of the scene (`pane`). VS Code and mobile, and a pane too small for the TV (under 46 columns or 20 rows for Clawd, 48 or 19 for Usagi), keep the inspect view in the pane.

## Fixes
- The Cost tab keeps a user's cost in its column when the agent's description has CJK text or emoji.
