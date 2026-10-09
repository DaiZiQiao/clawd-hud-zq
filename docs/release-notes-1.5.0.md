# mod-hud 1.5.0

The mascots are drawn smooth.

## Vector art (new)
- In the desktop app, Clawd and Usagi are now drawn as vector art instead of block characters: rounded bodies, real eyes that blink, arms and legs that move, at 30 frames a second. Every pose eases into the next. A squash bounces back, a fall turns the mascot over, and a thrown mascot spins about its middle.
- Every interaction the block art shows has its smooth version: arriving by the pipe, typing at the laptop, thinking, asking, flying under the propeller cap, messages, hand-offs, reviews, collisions and the dizzy stars, sleeping under the blanket, getting picked up, dangling and thrown, and the session's tidy-up and stretch.
- Usagi gets the same treatment: its ears through its hat (lowered when it squats, drooping when it slumps bare-headed, trailing a walk), cheeks, a mouth that opens wide on a shout, its phrases in a thought cloud (`Yahaa!`, `HUHHH?`), and its hat or crown on the floor when it is knocked flat.
- In a terminal that shows pictures (Ghostty, kitty), the pane's scene and the band's mascot are a picture the HUD swaps about 30 times a second, or about 10 while everyone stands still. Click, pick up, drag and throw still work. A 76 by 15 scene costs about 5 ms and 12 KiB a frame.
- Ghostty and kitty are recognised by their own environment variables. Other terminals (macOS Terminal, Windows Terminal, and anything under tmux) keep the block characters with no picture tried, and a terminal that refuses a picture falls back to them automatically.
- The TV that a pressed mascot grows into still draws its giant in block characters.
- A new option, `mascotArt`, picks `vector` (the default) or `blocks` everywhere.
