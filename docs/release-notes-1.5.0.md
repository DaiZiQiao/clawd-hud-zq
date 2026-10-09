# mod-hud 1.5.0

The mascots are drawn smooth.

## Vector art (new)
- In the desktop app, Clawd and Usagi are now drawn as vector art instead of block characters: rounded bodies, real eyes that blink, arms and legs that move, at 30 frames a second. Every pose eases into the next. A squash bounces back, a fall turns the mascot over, and a thrown mascot spins about its middle.
- Every interaction the block art shows has its smooth version: arriving by the pipe, typing at the laptop, thinking, asking, flying under the propeller cap, messages, hand-offs, reviews, collisions and the dizzy stars, sleeping under the blanket, getting picked up, dangling and thrown, and the session's tidy-up and stretch.
- Usagi gets the same treatment: its ears through its hat (lowered when it squats, drooping when it slumps bare-headed, trailing a walk), cheeks, a mouth that opens wide on a shout, its phrases in a thought cloud (`Yahaa!`, `HUHHH?`), and its hat or crown on the floor when it is knocked flat.
- In a terminal that shows pictures (Ghostty, kitty), the pane's scene and the band's mascot are a picture the HUD swaps about 30 times a second, or about 10 while everyone stands still. Click, pick up, drag and throw still work. A 76 by 15 scene costs about 5 ms and 12 KiB a frame.
- Ghostty and kitty are recognised by their own environment variables. Other terminals (macOS Terminal, Windows Terminal, and anything under tmux) keep the block characters with no picture tried, and a terminal that refuses a picture falls back to them automatically.
- The TV a pressed mascot grows into is drawn smooth too. In the desktop app the mascot flies in and grows as its vector self, and the giant is drawn as vector art. In Ghostty and kitty the giant is a picture under the TV's screen, blinking now and then.
- A new option, `mascotArt`, picks `vector` (the default) or `blocks` everywhere.

## Usagi, chaotic and cute (new)
- Drawn as Chiikawa draws it: a big round head on a smaller round body, long ears together and pink inside, little feet and stubby arms sticking out of its sides, small dot eyes with a glint under high brows that curve down to the side (never squeezed shut), pink cheeks with four short dark strokes, a mouth like a flat 3 with its chin's short slanted curve under one side (its cheeky look) (wide open and tall when it shouts, a smug hooked smile, a grin), and a white tufted tail that shows as it runs, all cream with a bold near-black outline. Its hats sit on its head with its ears through them. In the TV its ears stand up as the set's rabbit-ear antenna.
- In block characters too its ears now stand together and its body is narrower than its head.
- Like Chiikawa's Usagi, it bursts into something out of nowhere, about once every six or seven seconds, each Usagi on a clock of its own: the Yaha! dance, an Ura! leap, a HUHHH? lean-in, a smug Fuun, zoomies, a twirl, a backflip, or an UNA! shake. At its laptop it bashes the keys with both hands. Its line bursts out in a spiky balloon.
- It sprints: on foot it covers twice Clawd's ground, rests half as long and leaps more often. Its legs become a spinning cartoon wheel, it leans hard into its run with arms pumping and ears streaming back, kicking up dust behind speed lines. In block characters, four feet flurry instead.
- A new face: dot eyes with a glint, squeezed shut (`> <`) when it screams, half-lidded when smug; a small open mouth with a tongue, a wide D when it yells, a round `o`, a smirk. Its ears twitch now and then, and asleep a bubble swells from its nose.
- The quirks play in the block characters too, with their lines over its head.

