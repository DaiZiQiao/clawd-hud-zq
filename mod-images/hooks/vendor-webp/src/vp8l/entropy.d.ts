/**
 * VP8L entropy-coded image decoder.
 *
 * Decodes pixels from a Huffman-coded bitstream with
 * LZ77 backward references and optional color cache.
 *
 * @module
 */
import type { BitReader } from "../bit_reader.js";
/**
 * Decodes an entropy-coded image from the bitstream.
 *
 * @param reader Bit reader positioned at the image data.
 * @param width Image width in pixels.
 * @param height Image height in pixels.
 * @param isMain `true` for the main image (enables meta-prefix).
 * @return Decoded pixels as packed ARGB32 values.
 *
 * @throws {Error} If the bitstream is malformed or truncated.
 */
export declare function decodeImage(reader: BitReader, width: number, height: number, isMain: boolean): Uint32Array;
//# sourceMappingURL=entropy.d.ts.map