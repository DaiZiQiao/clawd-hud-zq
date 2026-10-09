import type { RowSink } from './image-types'

// A GIF's first frame as RGBA rows for a `RowSink` (hooks/image-types.ts):
// LZW, a global or local palette, transparency from the Graphic Control
// Extension, interlaced rows. The frame sits at its offset on a transparent
// canvas the size of the logical screen; the later frames of an animation are
// never read. Resumable: `step(deadline)` decodes until the deadline, keeping
// its place even inside a long LZW string. Data cut short keeps the rows
// decoded before it.

const { max, min } = Math

/** A GIF's logical screen and its first frame. */
export type GifHeader = {
  /** The logical screen: the canvas the frame is placed on. */
  width: number
  height: number
  frameX: number
  frameY: number
  frameWidth: number
  frameHeight: number
  interlaced: boolean
  /** The palette index drawn see-through, or -1. */
  transparent: number
}

/**
 * The first frame decoded in slices: `step(deadline)` works until
 * `performance.now()` passes `deadline` or every canvas row is handed out,
 * true then.
 */
export type GifDecoder = {
  header: GifHeader
  step: (deadline: number) => boolean
}

/** The header and where the first frame's palette and data are. */
type GifLayout = {
  header: GifHeader
  /** Palettes as [offset, entries]: the global one, then the frame's own. */
  palettes: (readonly [number, number])[]
  minCodeSize: number
  dataAt: number
}

type Phase = 'top' | 'frame' | 'bottom' | 'done'

// Interlaced rows come in four passes: every 8th from 0, every 8th from 4,
// every 4th from 2, every 2nd from 1.
const PASS_START = [0, 4, 2, 1] as const
const PASS_STEP = [8, 8, 4, 2] as const
/** Rows handed out between looks at the clock. */
const ROWS_PER_CHECK = 16
/** LZW codes read between looks at the clock. */
const CODES_PER_CHECK = 4096

const layoutOf = (bytes: Uint8Array): GifLayout | string => {
  const b = bytes
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 'GIF: no signature'
  const width = b[6]! | (b[7]! << 8)
  const height = b[8]! | (b[9]! << 8)
  if (width === 0 || height === 0) return 'GIF: no logical screen size'
  const flags = b[10]!
  const palettes: (readonly [number, number])[] = []
  let at = 13
  if ((flags & 0x80) !== 0) {
    const entries = 2 << (flags & 7)
    palettes.push([at, entries])
    at += entries * 3
  }
  let transparent = -1
  for (;;) {
    if (at >= b.length) return 'GIF: no image'
    const block = b[at]!
    if (block === 0x21) {
      // An extension; a Graphic Control Extension says how the next image draws.
      if (b[at + 1] === 0xf9 && b[at + 2] === 4) transparent = (b[at + 3]! & 1) === 0 ? -1 : b[at + 6]!
      at += 2
      while (at < b.length && b[at] !== 0) at += b[at]! + 1
      at += 1
      continue
    }
    if (block === 0x3b) return 'GIF: no image'
    if (block !== 0x2c) return 'GIF: bad block'
    if (at + 10 > b.length) return 'GIF: short image descriptor'
    const frameX = b[at + 1]! | (b[at + 2]! << 8)
    const frameY = b[at + 3]! | (b[at + 4]! << 8)
    const frameWidth = b[at + 5]! | (b[at + 6]! << 8)
    const frameHeight = b[at + 7]! | (b[at + 8]! << 8)
    const frameFlags = b[at + 9]!
    at += 10
    if ((frameFlags & 0x80) !== 0) {
      const entries = 2 << (frameFlags & 7)
      palettes.push([at, entries])
      at += entries * 3
    }
    if (at >= b.length) return 'GIF: no image data'
    const minCodeSize = b[at]!
    if (minCodeSize < 2 || minCodeSize > 11) return 'GIF: bad LZW code size'
    const interlaced = (frameFlags & 0x40) !== 0

    return {
      header: { width, height, frameX, frameY, frameWidth, frameHeight, interlaced, transparent },
      palettes,
      minCodeSize,
      dataAt: at + 1,
    }
  }
}

/** The logical screen and the first frame, read without decoding, or why there is no frame to read. */
export const gifHeaderOf = (bytes: Uint8Array): GifHeader | string => {
  const layout = layoutOf(bytes)

  return typeof layout === 'string' ? layout : layout.header
}

/**
 * The decoder of a GIF's first frame, its header read by `gifHeaderOf` and
 * checked by the caller against its caps; throws a `GIF: …` Error for a
 * header it cannot read.
 */
export const createGifDecoder = (bytes: Uint8Array, sink: RowSink): GifDecoder => {
  const layout = layoutOf(bytes)
  if (typeof layout === 'string') throw new Error(layout)
  const { header, minCodeSize } = layout
  const { width, height, frameX, frameY, frameWidth, frameHeight, interlaced, transparent } = header
  const b = bytes

  // The palette as little-endian RGBA words: entries no table gives are
  // opaque black, the transparent one is all zero.
  const palette = new Uint32Array(256).fill(0xff000000)
  for (const [offset, entries] of layout.palettes) {
    for (let i = 0; i < entries; i += 1) {
      const o = offset + i * 3
      palette[i] = ((0xff << 24) | ((b[o + 2] ?? 0) << 16) | ((b[o + 1] ?? 0) << 8) | (b[o] ?? 0)) >>> 0
    }
  }
  if (transparent >= 0) palette[transparent] = 0

  const line = new Uint8Array(width * 4)
  const line32 = new Uint32Array(line.buffer)
  const blank = new Uint8Array(width * 4)
  const pixels = new Uint8Array(max(1, frameWidth))
  // The LZW code table as prefix and suffix links, and a string's pixels on
  // the stack (backwards), kept between steps.
  const prefix = new Uint16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  let codeSize = minCodeSize + 1
  let next = clear + 2
  let old = -1
  let first = 0
  let sp = 0
  let bitBuf = 0
  let bitCnt = 0
  let at = layout.dataAt
  let blockLeft = 0
  // Where the frame's rows stand: the column, the interlace pass, the frame row.
  let x = 0
  let pass = 0
  let fy = 0
  let rowsLeft = frameWidth === 0 ? 0 : frameHeight
  let rowsDone = 0
  let y = 0
  let phase: Phase = 'top'

  const isDone = (): boolean => phase === 'done'

  // The frame's data stops here (its end, or cut short): on to the rows below
  // it; a frame with rows and none decoded is no picture.
  const endFrame = (): void => {
    if (rowsDone === 0 && frameWidth > 0 && frameHeight > 0) throw new Error('GIF: no image data')
    rowsLeft = 0
    sp = 0
    y = frameY + frameHeight
    phase = 'bottom'
  }

  // The frame row in `pixels` onto a canvas row, out to the sink; on to the
  // next frame row. The arrays are locals for the copy loop.
  const emitFrameRow = (): void => {
    const canvasY = frameY + fy
    if (canvasY < height) {
      const out = line32
      const colours = palette
      const indices = pixels
      out.fill(0)
      const span = min(frameWidth, width - frameX)
      for (let i = 0, o = frameX; i < span; i += 1, o += 1) out[o] = colours[indices[i]!]!
      sink.row(canvasY, 0, 1, line, width)
    }
    if (!interlaced) fy += 1
    else {
      fy += PASS_STEP[pass]!
      while (fy >= frameHeight && pass < 3) {
        pass += 1
        fy = PASS_START[pass]!
      }
    }
  }

  // The frame's LZW codes into rows until the deadline, the end of the data
  // or the last row. What the loop touches per code or pixel is a local while
  // it runs (a register, where the closure's own variables are memory), and
  // the state is written back once when it stops; a string's pixels still on
  // the stack wait there. The clock is read every `CODES_PER_CHECK` codes on a
  // countdown: a modulo for each code costs more than the code.
  const decodeFrame = (deadline: number): void => {
    const data = b
    const clearCode = clear
    const endCode = eoi
    const rowWidth = frameWidth
    const firstSize = minCodeSize + 1
    const string = stack
    const prefixes = prefix
    const suffixes = suffix
    const row = pixels
    let rowsToGo = rowsLeft
    let decoded = rowsDone
    let size = codeSize
    let free = next
    let prior = old
    let head = first
    let top = sp
    let buf = bitBuf
    let cnt = bitCnt
    let p = at
    let left = blockLeft
    let column = x
    let ended = false
    let check = CODES_PER_CHECK
    frame: for (;;) {
      // The pending string's pixels into rows.
      while (top > 0 && rowsToGo > 0) {
        top -= 1
        row[column] = string[top]!
        column += 1
        if (column === rowWidth) {
          column = 0
          emitFrameRow()
          decoded += 1
          rowsToGo -= 1
          if (decoded % ROWS_PER_CHECK === 0 && performance.now() >= deadline) break frame
        }
      }
      if (rowsToGo === 0) {
        ended = true
        break
      }
      check -= 1
      if (check === 0) {
        check = CODES_PER_CHECK
        if (performance.now() >= deadline) break
      }
      // The next code, from the data's sub-blocks; their end is the frame's.
      while (cnt < size) {
        if (left === 0) {
          if (p >= data.length || data[p] === 0) {
            ended = true
            break frame
          }
          left = data[p]!
          p += 1
        }
        if (p >= data.length) {
          ended = true
          break frame
        }
        buf |= data[p]! << cnt
        p += 1
        cnt += 8
        left -= 1
      }
      const code = buf & ((1 << size) - 1)
      buf >>>= size
      cnt -= size
      if (code === endCode) {
        ended = true
        break
      }
      if (code === clearCode) {
        size = firstSize
        free = clearCode + 2
        prior = -1
        continue
      }
      if (prior === -1) {
        // The first code after a clear is a pixel of its own.
        if (code > clearCode) {
          ended = true
          break
        }
        string[0] = code
        top = 1
        head = code
        prior = code
        continue
      }
      let c = code
      if (code >= free) {
        // Only the code about to be defined may come early (the KwKwK case).
        if (code > free) {
          ended = true
          break
        }
        string[top] = head
        top += 1
        c = prior
      }
      while (c >= clearCode && top < 4096) {
        string[top] = suffixes[c]!
        top += 1
        c = prefixes[c]!
      }
      string[top] = c
      top += 1
      head = c
      if (free < 4096) {
        prefixes[free] = prior
        suffixes[free] = head
        free += 1
        if (free === 1 << size && size < 12) size += 1
      }
      prior = code
    }
    rowsLeft = rowsToGo
    rowsDone = decoded
    codeSize = size
    next = free
    old = prior
    first = head
    sp = top
    bitBuf = buf
    bitCnt = cnt
    at = p
    blockLeft = left
    x = column
    if (ended) endFrame()
  }

  // Blank canvas rows (above or below the frame) up to `stop`.
  const blankRows = (stop: number, deadline: number): boolean => {
    while (y < stop) {
      sink.row(y, 0, 1, blank, width)
      y += 1
      if (y % ROWS_PER_CHECK === 0 && y < stop && performance.now() >= deadline) return false
    }

    return true
  }

  return {
    header,
    step: deadline => {
      while (!isDone()) {
        if (phase === 'top') {
          if (!blankRows(min(frameY, height), deadline)) break
          phase = 'frame'
        } else if (phase === 'frame') {
          decodeFrame(deadline)
          if (phase === 'frame') break
        } else {
          if (!blankRows(height, deadline)) break
          phase = 'done'
        }
      }

      return isDone()
    },
  }
}
