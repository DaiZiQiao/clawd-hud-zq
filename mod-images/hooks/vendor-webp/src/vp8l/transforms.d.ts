/**
 * VP8L inverse transforms.
 *
 * The encoder applies up to four transforms (predictor, color, subtract-green,
 * color-indexing) before entropy coding. The decoder reads their parameters
 * from the bitstream and applies the inverse operations in reverse order
 * to reconstruct the original pixels.
 *
 * @module
 */
import type { BitReader } from "../bit_reader.js";
/**
 * Discriminated union of all VP8L transform specs.
 *
 * The `kind` field selects which inverse operation to apply.
 */
export type Transform = PredictorTransform | ColorTransform | SubtractGreenTransform | ColorIndexingTransform;
interface PredictorTransform {
    kind: "predictor";
    bits: number;
    blockWidth: number;
    modes: Uint8Array;
}
interface ColorTransform {
    kind: "color";
    bits: number;
    blockWidth: number;
    greenToRed: Int8Array;
    greenToBlue: Int8Array;
    redToBlue: Int8Array;
}
interface SubtractGreenTransform {
    kind: "subtract_green";
}
interface ColorIndexingTransform {
    kind: "color_indexing";
    palette: Uint32Array;
    packing: number;
    subsampledWidth: number;
}
/**
 * Reads all transforms from the bitstream.
 *
 * Each transform is preceded by a 1-bit flag. When the flag is 0,
 * reading stops and the remaining bitstream contains the main image.
 *
 * @param reader Bit reader positioned after the VP8L header.
 * @param width Current image width (may be narrowed by color-indexing).
 * @param height Image height.
 * @return Transforms in encoding order and the effective width for the main image.
 *
 * @throws {Error} If the bitstream is malformed or truncated.
 */
export declare function readTransforms(reader: BitReader, width: number, height: number): {
    transforms: Transform[];
    effectiveWidth: number;
};
/**
 * Applies all transforms in reverse order to reconstruct the original pixels.
 *
 * @param pixels Decoded main-image pixels (mutated in place for most transforms).
 * @param transforms Transforms in encoding order (applied last-to-first).
 * @param originalWidth Original image width before any subsampling.
 * @param effectiveWidth Width after color-indexing subsampling.
 * @param height Image height.
 * @return Reconstructed pixels (may be a new array if color-indexing expands width).
 *
 * @throws {Error} If a predictor mode is unknown.
 */
export declare function applyInverse(pixels: Uint32Array, transforms: Transform[], originalWidth: number, effectiveWidth: number, height: number): Uint32Array;
export {};
//# sourceMappingURL=transforms.d.ts.map