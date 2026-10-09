// The state contract of mod-images: what the strip draws from, as `$.state`
// holds it. The pixels themselves stay in module memory (hooks/register.tsx
// says why); a write here is what redraws the band.

/** A picture format Claude Code keeps pasted images in. */
export type ImagesFormat = 'png' | 'jpeg' | 'gif' | 'webp'

/**
 * What a tile shows: `pending`, its chip is in the draft and its file not yet
 * on disk; `reading`, the file is being decoded; `ready`, the picture is in
 * memory; `failed`, there is no picture and `reason` says why; `not-attached`,
 * a chip Claude Code will not send an image for (typed, or recalled from
 * history), drawn with no picture since its number may name another image.
 */
export type ImagesTileState = 'pending' | 'reading' | 'ready' | 'failed' | 'not-attached'

/** One `[Image #N]` chip of the draft as the strip shows it. */
export type ImagesTile = {
  /** The N of `[Image #N]`. */
  id: number
  state: ImagesTileState
  format?: ImagesFormat
  /** The stored picture's size in pixels, once its header is read. */
  width?: number
  height?: number
  /** Why a `failed` tile has no picture: `no preview`, `too big`, `not found`, `can't read`, `too slow`. */
  reason?: string
  /** `$.clock.now()` when its chip was first seen in the draft. */
  seenAt: number
}

/** The strip: the draft's chips in ascending order, for the session that pasted them. */
export type ImagesStrip = {
  sessionId: string
  tiles: ImagesTile[]
}

/**
 * Which chips were really pasted, and which were sent, by id (ids never repeat
 * within a Claude Code process). Kept for the session: a hot reload keeps it,
 * and /clear wipes it with the rest of the plugin's state.
 */
export type ImagesProvenance = {
  /** When each id's chip was first seen in the draft. */
  seen: Record<string, number>
  /** Ids whose file was written while their chip was new: pasted or dragged in. */
  pasted: Record<string, true>
  /** Ids a sent prompt carried: a chip recalled after that is not attached. */
  sent: Record<string, true>
}

/** `/mod-images test`: the sample strip shows until this time. */
export type ImagesDemo = { until: number } | null

declare module 'claude-code' {
  interface PluginState {
    'mod-images': {
      strip: ImagesStrip
      provenance: ImagesProvenance
      demo: ImagesDemo
      /** Bumped when a picture finishes decoding, so the band draws it. */
      pictures: number
    }
  }
}
