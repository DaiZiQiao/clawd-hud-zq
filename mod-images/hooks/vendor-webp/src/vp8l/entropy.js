/**
 * VP8L entropy-coded image decoder.
 *
 * Decodes pixels from a Huffman-coded bitstream with
 * LZ77 backward references and optional color cache.
 *
 * @module
 */
import { pack } from "../argb.js";
import { readCodeGroup } from "./huffman.js";
// ============================================================
// Constants
// ============================================================
/** Number of literal pixel values (0..255). */
const NUM_LITERAL = 256;
/** Number of LZ77 length prefix codes. */
const NUM_LENGTH_CODES = 24;
/** Number of LZ77 distance prefix codes. */
const NUM_DISTANCE_CODES = 40;
/** VP8L color cache hash multiplier (from the spec). */
const COLOR_CACHE_MULTIPLIER = 0x1e35a7bd;
/**
 * VP8L distance offset table.
 *
 * Maps distance codes 1..120 to (dx, dy) neighbor offsets
 * for converting distance codes into scanline pixel distances.
 */
// deno-fmt-ignore
const DISTANCE_OFFSETS = [
    [0, 1], [1, 0], [1, 1], [-1, 1], [0, 2], [2, 0], [1, 2], [-1, 2],
    [2, 1], [-2, 1], [2, 2], [-2, 2], [0, 3], [3, 0], [1, 3], [-1, 3],
    [3, 1], [-3, 1], [2, 3], [-2, 3], [3, 2], [-3, 2], [0, 4], [4, 0],
    [1, 4], [-1, 4], [4, 1], [-4, 1], [3, 3], [-3, 3], [2, 4], [-2, 4],
    [4, 2], [-4, 2], [0, 5], [3, 4], [-3, 4], [4, 3], [-4, 3], [5, 0],
    [1, 5], [-1, 5], [5, 1], [-5, 1], [2, 5], [-2, 5], [5, 2], [-5, 2],
    [4, 4], [-4, 4], [3, 5], [-3, 5], [5, 3], [-5, 3], [0, 6], [6, 0],
    [1, 6], [-1, 6], [6, 1], [-6, 1], [2, 6], [-2, 6], [6, 2], [-6, 2],
    [4, 5], [-4, 5], [5, 4], [-5, 4], [3, 6], [-3, 6], [6, 3], [-6, 3],
    [0, 7], [7, 0], [1, 7], [-1, 7], [5, 5], [-5, 5], [7, 1], [-7, 1],
    [4, 6], [-4, 6], [6, 4], [-6, 4], [2, 7], [-2, 7], [7, 2], [-7, 2],
    [3, 7], [-3, 7], [7, 3], [-7, 3], [5, 6], [-5, 6], [6, 5], [-6, 5],
    [8, 0], [4, 7], [-4, 7], [7, 4], [-7, 4], [8, 1], [8, 2], [6, 6],
    [-6, 6], [8, 3], [5, 7], [-5, 7], [7, 5], [-7, 5], [8, 4], [6, 7],
    [-6, 7], [7, 6], [-7, 6], [8, 5], [7, 7], [-7, 7], [8, 6], [8, 7],
];
// ============================================================
// Public API
// ============================================================
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
export function decodeImage(reader, width, height, isMain) {
    const total = width * height;
    // Color cache
    const hasCache = reader.read(1) === 1;
    const cacheBits = hasCache ? reader.read(4) : 0;
    const cache = hasCache ? new Uint32Array(1 << cacheBits) : null;
    // Meta-prefix (only for main image)
    const meta = isMain ? readMetaPrefix(reader, width, height) : null;
    const numGroups = meta ? meta.numGroups : 1;
    const groups = readCodeGroups(reader, numGroups, cacheBits, hasCache);
    // Pixel decoding loop
    const output = new Uint32Array(total);
    let index = 0;
    while (index < total) {
        const x = index % width;
        const y = Math.trunc(index / width);
        const group = pickGroup(groups, meta, x, y);
        const symbol = group.green.decode(reader);
        if (symbol < NUM_LITERAL) {
            // Literal ARGB pixel — read order per VP8L spec: green (already read), red, blue, alpha
            const greenValue = symbol;
            const redValue = group.red.decode(reader);
            const blueValue = group.blue.decode(reader);
            const alphaValue = group.alpha.decode(reader);
            const pixel = pack(alphaValue, redValue, greenValue, blueValue);
            output[index] = pixel;
            index++;
            if (cache)
                insertCache(cache, cacheBits, pixel);
            continue;
        }
        if (symbol < NUM_LITERAL + NUM_LENGTH_CODES) {
            // LZ77 backward reference
            const length = decodeLz77(symbol - NUM_LITERAL, reader);
            const distanceSymbol = group.distance.decode(reader);
            const distance = resolveDistance(decodeLz77(distanceSymbol, reader), width);
            for (let k = 0; k < length; k++) {
                // Out-of-bounds references read as transparent black
                const pixel = index >= distance ? output[index - distance] : 0;
                output[index] = pixel;
                index++;
                if (cache)
                    insertCache(cache, cacheBits, pixel);
            }
            continue;
        }
        // Color cache reference
        if (!cache)
            throw new Error("Color cache reference without cache");
        const cacheIndex = symbol - NUM_LITERAL - NUM_LENGTH_CODES;
        const pixel = cache[cacheIndex];
        output[index] = pixel;
        index++;
        insertCache(cache, cacheBits, pixel);
    }
    return output;
}
// ============================================================
// Color cache
// ============================================================
/** Inserts a pixel into the color cache using the VP8L hash function. */
function insertCache(table, bits, pixel) {
    // Force pixel to unsigned 32-bit before hashing
    const hash = Math.imul(COLOR_CACHE_MULTIPLIER, pixel >>> 0) >>> (32 - bits);
    table[hash] = pixel;
}
// ============================================================
// Code group helpers
// ============================================================
/** Reads `count` code groups from the bitstream. */
function readCodeGroups(reader, count, cacheBits, hasCache) {
    const sizes = {
        green: NUM_LITERAL + NUM_LENGTH_CODES + (hasCache ? 1 << cacheBits : 0),
        red: NUM_LITERAL,
        blue: NUM_LITERAL,
        alpha: NUM_LITERAL,
        distance: NUM_DISTANCE_CODES,
    };
    return Array.from({ length: count }, () => readCodeGroup(reader, sizes));
}
/** Picks the active code group for the given pixel position. */
function pickGroup(groups, meta, x, y) {
    if (!meta)
        return groups[0];
    const blockCol = x >>> meta.bits;
    const blockRow = y >>> meta.bits;
    return groups[meta.ids[blockRow * meta.width + blockCol]];
}
// ============================================================
// Meta-prefix
// ============================================================
/**
 * Reads the meta-prefix data that maps image blocks to code groups.
 *
 * @param reader Bit reader positioned at the meta-prefix field.
 * @param imageWidth Main image width in pixels.
 * @param imageHeight Main image height in pixels.
 * @return Parsed meta-prefix, or `null` if only one group is used.
 */
function readMetaPrefix(reader, imageWidth, imageHeight) {
    if (reader.read(1) === 0)
        return null;
    const bits = reader.read(3) + 2;
    const blockSize = 1 << bits;
    const width = Math.ceil(imageWidth / blockSize);
    const height = Math.ceil(imageHeight / blockSize);
    const pixels = decodeImage(reader, width, height, false);
    // Extract group IDs from bits 8..23 of each pixel
    const ids = new Uint16Array(pixels.length);
    let maxId = 0;
    for (let i = 0; i < pixels.length; i++) {
        const id = (pixels[i] >>> 8) & 0xffff;
        ids[i] = id;
        if (id > maxId)
            maxId = id;
    }
    return { bits, width, ids, numGroups: maxId + 1 };
}
// ============================================================
// LZ77
// ============================================================
/**
 * Decodes an LZ77 length or distance value from its prefix code.
 *
 * Prefix codes 0..3 map directly to values 1..4.
 * Higher codes use additional bits from the stream.
 */
function decodeLz77(prefix, reader) {
    if (prefix < 4)
        return prefix + 1;
    const extra = (prefix - 2) >>> 1;
    const base = (2 + (prefix & 1)) << extra;
    return base + reader.read(extra) + 1;
}
// ============================================================
// Distance mapping
// ============================================================
/**
 * Converts a VP8L distance code to a scanline-order pixel distance.
 *
 * Codes 1..120 map to nearby (dx, dy) offsets defined by the spec.
 * Codes above 120 are direct scanline distances minus 120.
 */
function resolveDistance(code, width) {
    if (code > DISTANCE_OFFSETS.length)
        return code - DISTANCE_OFFSETS.length;
    const [deltaX, deltaY] = DISTANCE_OFFSETS[code - 1];
    return Math.max(1, deltaX + deltaY * width);
}
//# sourceMappingURL=entropy.js.map