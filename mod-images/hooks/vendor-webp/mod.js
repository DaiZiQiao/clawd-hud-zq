/**
 * WebP lossless (VP8L) image decoder.
 *
 * Decodes a `.webp` file into raw RGBA pixel data.
 * Only the lossless (VP8L) format is supported.
 *
 * @example
 * ```ts
 * import { decode } from "@nktkas/webp";
 *
 * const file = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // .webp bytes
 * const { width, height, data } = decode(file);
 * ```
 *
 * @module
 */
import { toRgba } from "./src/argb.js";
import { extractVp8l } from "./src/riff.js";
import { decodeVp8l } from "./src/vp8l/decode.js";
/**
 * Decodes a WebP lossless image into RGBA pixel data.
 *
 * @param webp Raw `.webp` file bytes.
 * @return Decoded image dimensions and pixel buffer.
 *
 * @throws {Error} If the file is not a valid WebP VP8L image.
 */
export function decode(webp) {
    const payload = extractVp8l(webp);
    const { width, height, pixels } = decodeVp8l(payload);
    return { width, height, data: toRgba(pixels) };
}
//# sourceMappingURL=mod.js.map