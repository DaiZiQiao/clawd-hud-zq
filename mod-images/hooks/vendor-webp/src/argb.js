/**
 * Packed ARGB32 pixel utilities.
 *
 * Layout: `[alpha:8][red:8][green:8][blue:8]` — 32-bit unsigned integer.
 *
 * @module
 */
// ============================================================
// Channel extraction
// ============================================================
/** Extracts alpha channel (bits 31..24). */
export function alpha(pixel) {
    return (pixel >>> 24) & 0xff;
}
/** Extracts red channel (bits 23..16). */
export function red(pixel) {
    return (pixel >>> 16) & 0xff;
}
/** Extracts green channel (bits 15..8). */
export function green(pixel) {
    return (pixel >>> 8) & 0xff;
}
/** Extracts blue channel (bits 7..0). */
export function blue(pixel) {
    return pixel & 0xff;
}
// ============================================================
// Packing
// ============================================================
/** Packs four 8-bit channels into a single ARGB32 value. */
export function pack(a, r, g, b) {
    return (((a & 0xff) << 24) |
        ((r & 0xff) << 16) |
        ((g & 0xff) << 8) |
        (b & 0xff)) >>> 0;
}
// ============================================================
// Arithmetic
// ============================================================
/** Mask for SWAR byte-lane operations on interleaved R/B or A/G channels. */
const SWAR_ADD_MASK = 0x00ff00ff;
/** Adds two pixels channel-by-channel with 8-bit wrap-around (mod 256). */
export function addPixels(first, second) {
    // SWAR: parallel byte-lane addition on interleaved channels
    const rb = ((first & SWAR_ADD_MASK) + (second & SWAR_ADD_MASK)) & SWAR_ADD_MASK;
    const ag = (((first >>> 8) & SWAR_ADD_MASK) + ((second >>> 8) & SWAR_ADD_MASK)) & SWAR_ADD_MASK;
    return ((ag << 8) | rb) >>> 0;
}
/** Spreads the green channel into red and blue positions: `0xAARRGGBB` → `0x00GG00GG`. */
export function spreadGreen(pixel) {
    const g = (pixel >>> 8) & 0xff;
    return (g << 16) | g;
}
/** Clamps a value to the 0..255 range. */
function clamp(value) {
    return Math.max(0, Math.min(255, value));
}
/** Adds a clamped gradient prediction to a pixel in one pass. */
export function addClampedGradient(pixel, left, top, topLeft) {
    // Extract pixel channels
    const pa = (pixel >>> 24) & 0xff;
    const pr = (pixel >>> 16) & 0xff;
    const pg = (pixel >>> 8) & 0xff;
    const pb = pixel & 0xff;
    // Clamped gradient from three neighbors
    const ga = clamp(((left >>> 24) & 0xff) + ((top >>> 24) & 0xff) - ((topLeft >>> 24) & 0xff));
    const gr = clamp(((left >>> 16) & 0xff) + ((top >>> 16) & 0xff) - ((topLeft >>> 16) & 0xff));
    const gg = clamp(((left >>> 8) & 0xff) + ((top >>> 8) & 0xff) - ((topLeft >>> 8) & 0xff));
    const gb = clamp((left & 0xff) + (top & 0xff) - (topLeft & 0xff));
    // Add with 8-bit wrap-around and pack
    return pack((pa + ga) & 0xff, (pr + gr) & 0xff, (pg + gg) & 0xff, (pb + gb) & 0xff);
}
/** Adjusts a channel value halfway toward the gradient, clamped to 0..255. */
export function clampHalf(value, reference) {
    return clamp(value + ((value - reference) / 2 | 0));
}
// ============================================================
// Conversion
// ============================================================
/** Converts packed ARGB32 pixels to interleaved RGBA bytes. */
export function toRgba(pixels) {
    const output = new Uint8Array(pixels.length * 4);
    const view = new DataView(output.buffer);
    for (let i = 0; i < pixels.length; i++) {
        const pixel = pixels[i];
        // ARGB 0xAARRGGBB → rotate left 8 → 0xRRGGBBAA = RGBA (big-endian)
        view.setUint32(i * 4, ((pixel << 8) | (pixel >>> 24)) >>> 0);
    }
    return output;
}
//# sourceMappingURL=argb.js.map