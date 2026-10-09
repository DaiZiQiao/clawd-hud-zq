# mod-images: the strip

mod-images draws thumbnails of the images in the prompt you are writing, in
the band Claude Code keeps directly above the prompt (the space surveys use).
Paste an image (Ctrl+V; Alt+V on Windows and WSL; Cmd+V also works in macOS
Terminal) or drag an image file in, and Claude Code puts an `[Image #N]` chip
in the prompt. A moment later the strip shows the picture, labelled `#N` with
its size. Delete the chip and the thumbnail goes; send the prompt and the strip
clears.

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

A half-block cell is the character `▀` with its top half coloured as one pixel
and its bottom half as the next, so a thumbnail 8 rows tall is 16 pixels tall.
That tells images apart by their layout and colours; it does not make text in
them readable. In 256 colours Claude Code maps each colour to the nearest of the
terminal's palette, so thumbnails look greyer. Dithering was tried and looks
worse at this size, so the plugin leaves the colours to Claude Code.

Kitty's pictures are confirmed, not assumed: the first thumbnail drawn is
checked with the engine, which says whether the terminal really draws pixels
there. If it does not (tmux in between, an old kitty), the strip switches to
half-block cells for the rest of the session.

With `pictures: text`, `NO_COLOR` set or Claude Code's screen-reader mode on,
the strip is one line: `Images attached: #1 PNG 1920 by 1080, #2 JPEG 2000 by 1500.`

## Room

The band gets about half the terminal's rows, less the prompt: 7 rows in an
80x24 terminal, 10 in 120x30, 15 in 120x40 (fullscreen, a one-line prompt). The
strip takes thumbnails of at most `height` rows (8 unless set) plus a label row,
and shrinks to fit:

- Thumbnails keep their shape: at 8 rows a 16:9 screenshot is 28 columns wide,
  a phone screenshot 8 (a cell is about twice as tall as it is wide). A
  panorama or a very tall picture is fitted, with a margin, in a tile of at
  most 4 columns a row and at least 1 (32 and 8 columns at 8 rows).
- When the row is full, every thumbnail shrinks together (down to 3 rows) before
  any is left out; those left out are named at the end of the label row, `+2: #6 #7`.
- Typing does not make the strip flicker: it shrinks only when the growing
  prompt needs the room, and grows again only when an image comes or goes.
- In a short terminal, under a survey, or when another plugin also draws in the
  band, the strip is one row: a small swatch, `#N` and the size of each image.

## Which images

The strip shows the images that will be sent with the prompt, in `#` order:

- A chip shows its picture once Claude Code has written the image: usually within
  a tenth of a second. A tile still waiting after 0.15 s shows a framed `…`.
- A chip Claude Code will not send an image for is a dashed `not attached` tile
  with no picture: one typed by hand, or recalled from history with ↑ (Claude
  Code keeps only the text of past prompts, and the number may name a different
  image today). The plugin knows a chip was pasted because its file was written
  as the chip appeared, and knows a prompt was sent because Claude Code recorded
  it with its images.
- One exception it cannot see: after Esc Esc and then ↑, Claude Code has dropped
  the images, but the strip still shows them.
- Pictures it cannot show get a framed tile with the reason: `no preview` (a lossy
  or animated WebP, or a rare kind of JPEG), `too big` (over 4 MB, a lossless WebP
  over about a megapixel, or more pixels than the decoders take), `not found` (no
  file appeared), `can't read`, `too slow`.

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
same code. If a later Claude Code moves the folder, tiles read `not found` and
`/mod-images` says where the plugin looked.

No folder is kept, and so no thumbnail can be read, when Claude Code runs with
`CLAUDE_CODE_SKIP_PROMPT_HISTORY` or as a nested session.

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
pixels on its long side; a 2000x1250 PNG screenshot takes 60 to 90 ms in all, a
1200x800 JPEG under 12 ms. Lossless WebP is the exception: the library decodes
it in one call that cannot pause, about a tenth of a second a megapixel, so a
lossless WebP over 1,100,000 pixels (larger than about 1280x854) gets a
`too big` tile rather than hold every plugin up. Each image is decoded once, to
a copy at most 256 pixels on its long side; every thumbnail size is cut from
that copy.

## `/mod-images`

Run it to see what the plugin sees: how it draws here and why, the colours and
how to get more, the image folder, the last strip it drew, and the room it had.
`/mod-images test` draws a sample strip for ten seconds, so a terminal can be
checked without pasting anything.

```
> /mod-images
  mod-images: version 1.0.0 on Claude Code 2.1.295.
  Pictures: half-block cells in 256 colours (macOS Terminal, no COLORTERM).
    Tip: If your Terminal draws 24-bit colour (macOS 26 or newer), add `export COLORTERM=truecolor` to your shell profile.
    Real pixels need kitty 0.28 or newer, or Ghostty, outside tmux.
  Image folder: /private/var/folders/xy/…/T/claude-501/-Users-you-proj/9f2c…/images (found, 3 images this session).
  Last strip, 40 s ago: #1 PNG 1920x1080 shown · #2 JPEG 2000x1500 shown · #3 WebP: no preview.
  Room: 7 rows above the prompt, 75 columns (80x24, fullscreen); thumbnails were 6 rows.
  …
```

## Where it does nothing

The desktop app, VS Code and the mobile app: mod-images draws only in a
terminal, and only while a person is at the prompt (never in `-p` runs).
