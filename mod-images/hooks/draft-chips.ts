// The `[Image #N]` chips of a draft, as Claude Code writes one into the prompt
// for each image pasted or dragged in, and the chips a sent prompt carried.
// Pure: text in, ids out.

const CHIP = /\[Image #(\d+)\]/g

/**
 * The ids of the text's `[Image #N]` chips (N from 1, a safe integer),
 * ascending and each once: the order Claude Code sends the images in, so a
 * chip moved in the text or named twice draws one tile in the same place.
 */
export const chipIdsOf = (text: string): number[] => {
  const ids = new Set<number>()
  for (const match of text.matchAll(CHIP)) {
    const id = Number(match[1])
    if (Number.isSafeInteger(id) && id >= 1) ids.add(id)
  }

  return [...ids].sort((a, b) => a - b)
}

/** `1,2,7`: one string per set of ids, whatever their order, so two chip lists compare as their keys do. */
export const chipKeyOf = (ids: readonly number[]): string => [...new Set(ids)].sort((a, b) => a - b).join(',')

/**
 * The chips a transcript row (`session.append`, door `prompt` or `delivery`)
 * sent a picture for: the `[Image #N]` of its text blocks when it also
 * carries an image block, none otherwise (a recalled chip sends no picture,
 * so a row of text alone proves nothing). Each text block counts on its own.
 */
export const sentIdsOf = (content: readonly { type: string; text?: unknown }[]): number[] => {
  if (!content.some(block => block.type === 'image')) return []
  const ids = content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? chipIdsOf(block.text) : [])

  return [...new Set(ids)].sort((a, b) => a - b)
}
