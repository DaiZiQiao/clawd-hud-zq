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
import { addClampedGradient, addPixels, alpha, blue, clampHalf, green, pack, red, spreadGreen } from "../argb.js";
import { decodeImage } from "./entropy.js";
// ============================================================
// Reading transforms from the bitstream
// ============================================================
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
export function readTransforms(reader, width, height) {
    const transforms = [];
    let effectiveWidth = width;
    while (reader.read(1) === 1) {
        const type = reader.read(2);
        switch (type) {
            case 0:
                transforms.push(readPredictor(reader, effectiveWidth, height));
                break;
            case 1:
                transforms.push(readColor(reader, effectiveWidth, height));
                break;
            case 2:
                transforms.push({ kind: "subtract_green" });
                break;
            case 3: {
                const indexing = readColorIndexing(reader, effectiveWidth);
                effectiveWidth = indexing.subsampledWidth;
                transforms.push(indexing);
                break;
            }
            default:
                throw new Error(`Unknown transform type: ${type}`);
        }
    }
    return { transforms, effectiveWidth };
}
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
export function applyInverse(pixels, transforms, originalWidth, effectiveWidth, height) {
    let currentWidth = effectiveWidth;
    let currentPixels = pixels;
    for (let i = transforms.length - 1; i >= 0; i--) {
        const transform = transforms[i];
        switch (transform.kind) {
            case "predictor":
                invertPredictor(currentPixels, currentWidth, height, transform);
                break;
            case "color":
                invertColor(currentPixels, currentWidth, height, transform);
                break;
            case "subtract_green":
                invertSubtractGreen(currentPixels);
                break;
            case "color_indexing":
                currentPixels = invertColorIndexing(currentPixels, currentWidth, height, originalWidth, transform);
                currentWidth = originalWidth;
                break;
        }
    }
    return currentPixels;
}
// ============================================================
// Predictor transform
// ============================================================
/** Reads the block-based sub-image shared by predictor and color transforms. */
function readBlockSubImage(reader, width, height) {
    const bits = reader.read(3) + 2;
    const blockSize = 1 << bits;
    const blockCols = Math.ceil(width / blockSize);
    const blockRows = Math.ceil(height / blockSize);
    const pixels = decodeImage(reader, blockCols, blockRows, false);
    return { bits, blockCols, pixels };
}
/** Reads a predictor transform from the bitstream. */
function readPredictor(reader, width, height) {
    const { bits, blockCols, pixels } = readBlockSubImage(reader, width, height);
    const modes = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
        modes[i] = green(pixels[i]);
    }
    return { kind: "predictor", bits, blockWidth: blockCols, modes };
}
/** Applies the inverse predictor transform in-place. */
function invertPredictor(pixels, width, height, transform) {
    const { bits, blockWidth, modes } = transform;
    // Top-left corner: no neighbors, predict opaque black
    pixels[0] = addPixels(pixels[0], 0xff000000);
    // Rest of top row: only left neighbor available
    for (let x = 1; x < width; x++) {
        pixels[x] = addPixels(pixels[x], pixels[x - 1]);
    }
    // Remaining rows
    for (let y = 1; y < height; y++) {
        const rowStart = y * width;
        const blockRow = (y >>> bits) * blockWidth;
        // Left column: only top neighbor available
        pixels[rowStart] = addPixels(pixels[rowStart], pixels[rowStart - width]);
        // Inner pixels: all four neighbors available
        for (let x = 1; x < width; x++) {
            const i = rowStart + x;
            const mode = modes[blockRow + (x >>> bits)];
            const left = pixels[i - 1];
            const top = pixels[i - width];
            const topLeft = pixels[i - width - 1];
            let predicted;
            switch (mode) {
                case 0: // opaque black
                    predicted = 0xff000000;
                    break;
                case 1: // horizontal
                    predicted = left;
                    break;
                case 2: // vertical
                    predicted = top;
                    break;
                case 3: { // diagonal top-right (wraps to row start at the right edge)
                    const topRight = x < width - 1 ? pixels[i - width + 1] : pixels[rowStart];
                    predicted = topRight;
                    break;
                }
                case 4: // diagonal top-left
                    predicted = topLeft;
                    break;
                case 5: { // weighted average of three neighbors
                    const topRight = x < width - 1 ? pixels[i - width + 1] : pixels[rowStart];
                    predicted = avg(avg(left, topRight), top);
                    break;
                }
                case 6: // average left + top-left
                    predicted = avg(left, topLeft);
                    break;
                case 7: // average left + top
                    predicted = avg(left, top);
                    break;
                case 8: // average top-left + top
                    predicted = avg(topLeft, top);
                    break;
                case 9: { // average top + top-right
                    const topRight = x < width - 1 ? pixels[i - width + 1] : pixels[rowStart];
                    predicted = avg(top, topRight);
                    break;
                }
                case 10: { // average of all four neighbors
                    const topRight = x < width - 1 ? pixels[i - width + 1] : pixels[rowStart];
                    predicted = avg(avg(left, topLeft), avg(top, topRight));
                    break;
                }
                case 11: // select closest to gradient
                    predicted = select(left, top, topLeft);
                    break;
                case 12: // clamped gradient
                    pixels[i] = addClampedGradient(pixels[i], left, top, topLeft);
                    continue;
                case 13: // half-gradient
                    predicted = halfGradient(avg(left, top), topLeft);
                    break;
                default:
                    throw new Error(`Unknown predictor mode: ${mode}`);
            }
            pixels[i] = addPixels(pixels[i], predicted);
        }
    }
}
/** Mask for SWAR byte-lane average to prevent carry between channels. */
const SWAR_AVG_MASK = 0xfefefefe;
/** Per-channel average of two pixels: `floor((first + second) / 2)`. */
function avg(first, second) {
    // SWAR: byte-lane average without overflow
    return (((first ^ second) & SWAR_AVG_MASK) >>> 1) + (first & second) >>> 0;
}
/** Mode 11: picks left or top based on which is closer to the gradient prediction. */
function select(left, top, topLeft) {
    // Gradient prediction: left + top − topLeft, per channel
    const predictedAlpha = alpha(left) + alpha(top) - alpha(topLeft);
    const predictedRed = red(left) + red(top) - red(topLeft);
    const predictedGreen = green(left) + green(top) - green(topLeft);
    const predictedBlue = blue(left) + blue(top) - blue(topLeft);
    // Manhattan distance from prediction to each candidate
    const distToLeft = Math.abs(predictedAlpha - alpha(left)) +
        Math.abs(predictedRed - red(left)) +
        Math.abs(predictedGreen - green(left)) +
        Math.abs(predictedBlue - blue(left));
    const distToTop = Math.abs(predictedAlpha - alpha(top)) +
        Math.abs(predictedRed - red(top)) +
        Math.abs(predictedGreen - green(top)) +
        Math.abs(predictedBlue - blue(top));
    return distToLeft < distToTop ? left : top;
}
/** Mode 13: `clampHalf(average, reference)` per channel. */
function halfGradient(average, reference) {
    return pack(clampHalf(alpha(average), alpha(reference)), clampHalf(red(average), red(reference)), clampHalf(green(average), green(reference)), clampHalf(blue(average), blue(reference)));
}
// ============================================================
// Color transform
// ============================================================
/** Reads a color transform from the bitstream. */
function readColor(reader, width, height) {
    const { bits, blockCols, pixels } = readBlockSubImage(reader, width, height);
    const greenToRed = new Int8Array(pixels.length);
    const greenToBlue = new Int8Array(pixels.length);
    const redToBlue = new Int8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
        const pixel = pixels[i];
        // Spec mapping: blue→greenToRed, green→greenToBlue, red→redToBlue
        greenToRed[i] = signed8(blue(pixel));
        greenToBlue[i] = signed8(green(pixel));
        redToBlue[i] = signed8(red(pixel));
    }
    return {
        kind: "color",
        bits,
        blockWidth: blockCols,
        greenToRed,
        greenToBlue,
        redToBlue,
    };
}
/** Applies the inverse color transform in-place. */
function invertColor(pixels, width, height, transform) {
    const { bits, blockWidth, greenToRed, greenToBlue, redToBlue } = transform;
    for (let y = 0; y < height; y++) {
        const rowStart = y * width;
        const blockRow = (y >>> bits) * blockWidth;
        for (let x = 0; x < width; x++) {
            const i = rowStart + x;
            const bi = blockRow + (x >>> bits);
            const pixel = pixels[i];
            const greenValue = green(pixel);
            let redValue = red(pixel);
            let blueValue = blue(pixel);
            redValue = (redValue + colorDelta(greenToRed[bi], greenValue)) & 0xff;
            blueValue = (blueValue +
                colorDelta(greenToBlue[bi], greenValue) +
                colorDelta(redToBlue[bi], redValue)) & 0xff;
            pixels[i] = pack(alpha(pixel), redValue, greenValue, blueValue);
        }
    }
}
/** Reinterprets a uint8 as signed int8. */
function signed8(value) {
    return (value << 24) >> 24;
}
/** Signed fixed-point 3.5 multiply: `(coeff * signed8(channel)) >> 5`. */
function colorDelta(coeff, channel) {
    return (coeff * signed8(channel)) >> 5;
}
// ============================================================
// Subtract-green transform
// ============================================================
/** Applies the inverse subtract-green transform in-place. */
function invertSubtractGreen(pixels) {
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = addPixels(pixels[i], spreadGreen(pixels[i]));
    }
}
// ============================================================
// Color-indexing (palette) transform
// ============================================================
/** Reads a color-indexing (palette) transform from the bitstream. */
function readColorIndexing(reader, width) {
    const paletteSize = reader.read(8) + 1;
    // Palette is delta-coded: each entry is the running sum of deltas
    const deltas = decodeImage(reader, paletteSize, 1, false);
    const palette = new Uint32Array(paletteSize);
    let accumulated = 0x00000000;
    for (let i = 0; i < paletteSize; i++) {
        accumulated = addPixels(accumulated, deltas[i]);
        palette[i] = accumulated;
    }
    // VP8L packs multiple palette indices into one green-channel byte.
    // Packing level = log2(8 / bitsPerIndex): 3, 2, 1, or 0.
    let bitsPerIndex;
    if (paletteSize <= 2)
        bitsPerIndex = 1;
    else if (paletteSize <= 4)
        bitsPerIndex = 2;
    else if (paletteSize <= 16)
        bitsPerIndex = 4;
    else
        bitsPerIndex = 8;
    const packing = Math.log2(8 / bitsPerIndex);
    const subsampledWidth = Math.ceil(width / (1 << packing));
    return {
        kind: "color_indexing",
        palette,
        packing,
        subsampledWidth,
    };
}
/** Applies the inverse color-indexing transform, expanding packed indices to pixels. */
function invertColorIndexing(pixels, inputWidth, height, originalWidth, transform) {
    const output = new Uint32Array(originalWidth * height);
    const indicesPerByte = 1 << transform.packing;
    for (let y = 0; y < height; y++) {
        for (let packedX = 0; packedX < inputWidth; packedX++) {
            const greenByte = green(pixels[y * inputWidth + packedX]);
            const baseX = packedX * indicesPerByte;
            for (let k = 0; k < indicesPerByte; k++) {
                const outputX = baseX + k;
                if (outputX >= originalWidth)
                    break;
                const paletteIndex = extractIndex(greenByte, transform.packing, k);
                // Out-of-range indices map to transparent black
                output[y * originalWidth + outputX] = paletteIndex < transform.palette.length
                    ? transform.palette[paletteIndex]
                    : 0x00000000;
            }
        }
    }
    return output;
}
/**
 * Extracts a packed index at the given position from the green channel byte.
 *
 * - Packing 0: 1 index per byte (8 bits).
 * - Packing 1: 2 indices per byte (4 bits each).
 * - Packing 2: 4 indices per byte (2 bits each).
 * - Packing 3: 8 indices per byte (1 bit each).
 */
function extractIndex(greenByte, packing, position) {
    const bitsPerIndex = 8 >>> packing;
    const mask = (1 << bitsPerIndex) - 1;
    return (greenByte >>> (bitsPerIndex * position)) & mask;
}
//# sourceMappingURL=transforms.js.map