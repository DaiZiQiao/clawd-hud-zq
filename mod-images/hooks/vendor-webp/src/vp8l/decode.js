/**
 * VP8L lossless bitstream decoder.
 *
 * Reads the VP8L header, decodes transforms and the entropy-coded
 * main image, then applies inverse transforms to reconstruct pixels.
 *
 * @module
 */
import { BitReader } from "../bit_reader.js";
import { decodeImage } from "./entropy.js";
import { applyInverse, readTransforms } from "./transforms.js";
/** VP8L signature byte that precedes the header fields. */
const SIGNATURE = 0x2f;
/** Bitmask to force alpha channel to fully opaque. */
const OPAQUE_ALPHA_MASK = 0xff000000;
/**
 * Decodes a VP8L bitstream payload into ARGB pixels.
 *
 * @param payload VP8L chunk data (without the RIFF chunk header).
 * @return Decoded image dimensions and packed ARGB32 pixel buffer.
 *
 * @throws {Error} If the signature or version is invalid.
 */
export function decodeVp8l(payload) {
    const reader = new BitReader(payload);
    const signature = reader.read(8);
    if (signature !== SIGNATURE) {
        throw new Error(`Invalid VP8L signature: expected 0x2f, got 0x${signature.toString(16)}`);
    }
    const width = reader.read(14) + 1;
    const height = reader.read(14) + 1;
    const isAlphaUsed = reader.read(1) === 1;
    const version = reader.read(3);
    if (version !== 0) {
        throw new Error(`Unsupported VP8L version: ${version}`);
    }
    const { transforms, effectiveWidth } = readTransforms(reader, width, height);
    let pixels = decodeImage(reader, effectiveWidth, height, true);
    pixels = applyInverse(pixels, transforms, width, effectiveWidth, height);
    // Force fully opaque when alpha is unused
    if (!isAlphaUsed) {
        for (let i = 0; i < pixels.length; i++) {
            pixels[i] = (pixels[i] | OPAQUE_ALPHA_MASK) >>> 0;
        }
    }
    return { width, height, pixels };
}
//# sourceMappingURL=decode.js.map