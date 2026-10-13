# mod-images: the strip

mod-images draws thumbnails of the images in the prompt you are writing, in
the band Claude Code keeps directly above the prompt (the space surveys use).
Paste an image (Ctrl+V; Alt+V on Windows and WSL; Cmd+V also works in macOS
Terminal) or drag an image file in, and Claude Code puts an `[Image #N]` chip
in the prompt. A moment later the strip shows the picture, labelled `#N` with
the size Claude Code stored, which is what it sends (it shrinks a large paste:
a 3000x1875 screenshot is stored as 2000x1250). Delete the chip and the
thumbnail goes; send the prompt and the strip clears.

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

The `[-]` is Claude Code's own: it folds the band, which every plugin shares;
ctrl+x ctrl+a brings it back.

## Pictures

How a thumbnail is drawn depends on the terminal:

| Terminal | Thumbnail |
| --- | --- |
| kitty 0.28 or newer, Ghostty (outside tmux and screen) | Real pixels: sharp enough to tell screenshots apart. |
| Windows Terminal with PowerShell | Half-block cells in full colour. |
| WSL in Windows Terminal | Half-block cells in 256 colours, full colour with `export COLORTERM=truecolor`. |
| macOS Terminal | Half-block cells in 256 colours (full colour only where the Terminal draws 24-bit colour and `COLORTERM=truecolor` is set). |

Seen on screen so far only on Linux, in 256 colours and in full colour: kitty's
and Ghostty's pixels, Windows Terminal, WSL and macOS Terminal follow from the
same code but were not seen yet. `/mod-images test` shows what yours draws.

A half-block cell is the character `▀` with its top half coloured as one pixel
and its bottom half as the next, so a thumbnail 8 rows tall is 16 pixels tall.
That tells images apart by their layout and colours; it does not make text in
them readable. In 256 colours Claude Code maps each colour to the nearest of the
terminal's palette, so thumbnails look greyer. Dithering was tried and looks
worse at this size, so the plugin leaves the colours to Claude Code.

Kitty's pictures are confirmed, not assumed: the first thumbnail drawn is
checked with the engine, which says whether the terminal really draws pixels
there. If it does not (tmux in between, an old kitty, a terminal that never
answers), the strip switches to half-block cells for the rest of the session.
Until the answer comes, usually within half a second and at most about five,
the tile shows its alt text: `Image #1, PNG, 1920 by 1080`.

With `pictures: text`, or `NO_COLOR` or `CLAUDE_AX_SCREEN_READER` set, the strip
is one line: `Images attached: #1 PNG 1920 by 1080, #2 JPEG 2000 by 1500.`
Screen-reader mode turned on in settings or with `--ax-screen-reader` is not
visible to a plugin: choose `pictures: text` there.

## Room

The band gets about half the terminal's rows, less the prompt: 7 rows in an
80x24 terminal, 10 in 120x30, 15 in 120x40 (fullscreen, a one-line prompt).
That is at most 6 thumbnail rows plus 1 label row at 80x24; at 120x30 the
default is 8 plus 1, or at most 9 plus 1 with `height` raised. The strip
takes thumbnails of at most `height` rows (8 unless set) plus a label row,
and shrinks to fit:

- Thumbnails keep their shape: at 8 rows a 16:9 screenshot is 28 columns wide,
  a phone screenshot 8 (a cell is about twice as tall as it is wide). A
  panorama or a very tall picture is fitted, with a margin, in a tile of at
  most 4 columns a row (and, drawn in cells, at most 1024 cells) and at least
  6 columns: 32 and 8 columns at 8 rows.
- When the row is full, every thumbnail shrinks together (down to 3 rows) before
  any is left out; those left out are named at the end of the label row, `+2: #6 #7`.
- Typing does not make the strip flicker: it shrinks only when the growing
  prompt needs the room, and grows again only when an image comes or goes.
- In a short terminal, under a survey, or when mod-images runs first and another
  plugin draws, the strip is one row: a small swatch, `#N` and the size of each
  image, under the other plugin's rows. When the HUD's hook runs first, the
  HUD's own rows sit above the image strip; the strip can keep its full height
  nearest the prompt. Neither plugin controls the hook order. The combined rows
  can exceed the band's room and scroll.

## Which images

The strip shows the images that will be sent with the prompt, in `#` order:

- A chip shows its picture once Claude Code has written the image and the
  plugin has decoded it: usually within a fraction of a second. A tile still
  waiting after 0.15 s shows a framed `…`.
- A chip Claude Code will not send an image for is a dashed `not attached` tile
  with no picture: one typed by hand, or recalled from history with ↑ (Claude
  Code keeps only the text of past prompts, and the number may name a different
  image today). The plugin knows a chip was pasted because its file was written
  as the chip appeared, and knows a prompt was sent because Claude Code recorded
  it with its images. A prompt Claude Code puts back after Esc stops a turn
  before any answer keeps its images, and so do its tiles.
- One exception it cannot see: after Esc Esc and then ↑, Claude Code has dropped
  the images, but the strip still shows them.
- Pictures it cannot show get a framed tile with the reason: `no preview` (a lossy
  or animated WebP, or a CMYK, 12-bit, arithmetic-coded or lossless JPEG), `too big`
  (over 4 MiB, a lossless WebP over 2048 pixels a side or 1,100,000 pixels
  in all, or more pixels than the decoders take), `not found` (no project
  folder found or remembered, or a pasted picture's file went missing),
  `can't read`, `too slow`. With a known project folder but no session folder,
  a chip not seen pasted becomes `not attached` after its pending wait: it
  stays pending while the picture's `.tmp.` file is being written, or for
  about three seconds after the chip appears.

## Where the pictures come from

Claude Code saves each pasted image the moment it is pasted, in a folder of the
session's own:

```
<temp>/claude-<user id>/<project>/<session id>/images/<N>.png|jpg|gif|webp
```

`<temp>` is `CLAUDE_CODE_TMPDIR` when set, else the system's temporary folder
(`TMPDIR`, `TMP` or `TEMP`, else `/tmp`; `%TEMP%` on Windows); `<project>` is the
folder Claude Code started in with every character other than a letter or digit
turned into `-`. A plugin has no way to ask for this folder, so mod-images looks
for it: it lists the temporary folders for `claude-*` folders and checks for
this session's. This is not a documented interface. It was read from Claude Code
2.1.295 and checked there on Linux; the Windows and macOS spellings follow the
same code. If a later Claude Code moves the folder, tiles read `not found`
when no project folder is known, or `not attached` for a chip not seen pasted
when the project folder is known but this session's folder is absent;
`/mod-images` says where the plugin looked.

When no project folder has the project's name, a deeper search checks every
project folder for this session's folder. Any project folder found is remembered
across `/clear` and resume. With a recalled chip in a session that pasted
nothing, and no image folder for that session in the remembered project, the
plugin can keep listing `/tmp` (or the configured temporary folders) about once
a second while the chip stays. The deeper search stops after ten seconds for the
same chip set; these temporary-folder listings can continue.

No folder is kept, and so no thumbnail can be read, when Claude Code runs with
`CLAUDE_CODE_SKIP_PROMPT_HISTORY` or as a nested session: each tile reads
`no preview`. The nested-session marker is also inherited through tmux and set
for teammates, which do keep a folder, so mod-images looks for one all the same.

## Decoding

Plugins run without image decoding of their own (no canvas, no WebAssembly), so
mod-images carries its own decoders: PNG (every colour type, interlaced too),
JPEG (baseline and progressive, read at an eighth of its size, which is all a
thumbnail needs, and turned upright by its EXIF orientation), GIF (the first
frame) and lossless WebP (through the MIT-licensed
[@nktkas/webp](https://www.npmjs.com/package/@nktkas/webp), vendored in
`hooks/vendor-webp/`). Lossy WebP has no decoder small and fast enough, and
gets a `no preview` tile, as does an animated one.

Decoding runs on a timer, in slices of about 8 ms with a pause between them,
because one worker serves every plugin's hooks, and Claude Code and other
plugins never wait on it long. Claude Code keeps a pasted image at most 2000
pixels on its long side; a 2000x1250 PNG screenshot takes about 0.1 s in all, a
1200x800 JPEG a few hundredths of a second. Lossless WebP is the exception: the
library decodes it in one call that cannot pause, about 0.1 s for a plain
1280x854 screenshot and up to half a second for a photo, so a lossless WebP over
1,100,000 pixels in all (larger than about 1280x854), or over 2048 pixels on
either side, gets a `too big` tile rather than hold every plugin up longer. Each
image is decoded once, to a copy at most 256 pixels on its long side; every
thumbnail size is cut from that copy.

## `/mod-images`

Run it to see what the plugin sees: how it draws here and why, the colours and
how to get more, the image folder, the last strip it drew, and the room it had.
`/mod-images test` draws a sample strip for ten seconds, so a terminal can be
checked without pasting anything.

```
> /mod-images
  mod-images: version 1.0.1 on Claude Code 2.1.295.
  Pictures: half-block cells in 256 colours (macOS Terminal, no COLORTERM).
    Tip: If your Terminal draws 24-bit colour (macOS 26 or newer), add `export COLORTERM=truecolor` to your shell profile.
    Real pixels need kitty 0.28 or newer, or Ghostty, outside tmux.
  Image folder: /var/folders/xy/…/T/claude-501/-Users-you-proj/9f2c…/images (found, 3 images this session).
  Last strip, 40 s ago: #1 PNG 1920x1080 shown · #2 JPEG 2000x1500 shown · #3 WebP 1600x900: no preview.
  Room: 7 rows above the prompt, 75 columns (80x24, fullscreen); thumbnails were 6 rows.
  …
```

## Where it does nothing

The desktop app, the VS Code extension's panel and the mobile app: mod-images
draws only in a terminal (VS Code's integrated terminal is one), and only while
a person is at the prompt (never in `-p` runs).
