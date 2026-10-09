# mod-images 1.0.0

A second mod in this marketplace, installed on its own: thumbnails of the images you paste into Claude Code, in a strip just above the prompt, before you send.

## The strip (new)
- Paste an image (Ctrl+V; Alt+V on Windows and WSL; Cmd+V also works in macOS Terminal) or drag an image file in, and a moment later the strip above the prompt shows it, labelled `#N` like its `[Image #N]` chip, with its size. Delete the chip and its thumbnail goes; send the prompt and the strip clears.
- kitty 0.28 or newer and Ghostty, outside tmux and screen, get real pixels. Other terminals get half-block cells (`▀`, two pixels a cell): full colour in Windows Terminal and wherever `COLORTERM=truecolor` is set, 256 colours in macOS Terminal and in WSL without it. Kitty's pixels are checked with Claude Code before they are trusted; where they do not reach the screen (tmux in between, an older kitty), the strip switches to half-block cells.
- The strip fits the room above the prompt: thumbnails up to 8 rows tall (the `height` option, 3 to 20), 6 rows in an 80x24 terminal, all shrinking together before any is left out; one compact row in a short terminal, under a survey, or when another plugin draws there too. Typing does not make it flicker.
- It shows only what will be sent: a chip typed by hand, or recalled from history with ↑ (Claude Code sends no image with it), is a dashed `not attached` tile. A prompt Claude Code puts back after Esc stops a turn before any answer keeps its pictures. A picture it cannot draw is a framed tile saying why: `no preview` (a lossy or animated WebP, or a CMYK, 12-bit, arithmetic-coded or lossless JPEG), `too big` (over 4 MiB, or a lossless WebP over about a megapixel), `not found`, `can't read` or `too slow`.
- PNG, JPEG (baseline and progressive, turned upright by its EXIF orientation), GIF (the first frame) and lossless WebP are decoded by the plugin itself: PNG, JPEG and GIF in slices of about 8 ms on a timer, so Claude Code never waits on them; a lossless WebP in one go of 0.1 to 0.5 s, so only up to about a megapixel.
- With `pictures: text`, or `NO_COLOR` or `CLAUDE_AX_SCREEN_READER` set, the strip is one line: `Images attached: #1 PNG 1920 by 1080, #2 JPEG 2000 by 1500.` Screen-reader mode turned on in settings or with `--ax-screen-reader` is not visible to a plugin: choose `pictures: text` there.
- `/mod-images` prints what the plugin sees: how it draws here and why, the colours and how to get more, the image folder, the last strip and the room it had. `/mod-images test` draws a sample strip for 10 seconds.

## Limits
- It reads the folder Claude Code saves pasted images in, which is not a documented interface: built and checked against Claude Code 2.1.295. If a later version moves it, tiles read `not found` and `/mod-images` says where it looked.
- Seen working on Linux in 256-colour and full-colour terminals. kitty's and Ghostty's pixels, Windows Terminal, WSL and macOS Terminal run the same code but were not seen on screen before this release: `/mod-images test` shows what each one draws.
- A terminal only: the desktop app, the VS Code extension's panel and the mobile app show nothing new (VS Code's integrated terminal draws the strip).
- After Esc Esc and then ↑, Claude Code drops the recalled prompt's images, but the strip still shows them.
- No thumbnails when Claude Code keeps no image folder: with `CLAUDE_CODE_SKIP_PROMPT_HISTORY` set, or in a nested session. Each tile then reads `no preview`.

## Marketplace
- The marketplace (1.4.0) now lists two mods, each installed on its own; mod-hud's entry carries the same description as its plugin.json.
