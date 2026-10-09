/**
 * Packed ARGB32 pixel utilities.
 *
 * Layout: `[alpha:8][red:8][green:8][blue:8]` — 32-bit unsigned integer.
 *
 * @module
 */
/** Extracts alpha channel (bits 31..24). */
export declare function alpha(pixel: number): number;
/** Extracts red channel (bits 23..16). */
export declare function red(pixel: number): number;
/** Extracts green channel (bits 15..8). */
export declare function green(pixel: number): number;
/** Extracts blue channel (bits 7..0). */
export declare function blue(pixel: number): number;
/** Packs four 8-bit channels into a single ARGB32 value. */
export declare function pack(a: number, r: number, g: number, b: number): number;
/** Adds two pixels channel-by-channel with 8-bit wrap-around (mod 256). */
export declare function addPixels(first: number, second: number): number;
/** Spreads the green channel into red and blue positions: `0xAARRGGBB` → `0x00GG00GG`. */
export declare function spreadGreen(pixel: number): number;
/** Adds a clamped gradient prediction to a pixel in one pass. */
export declare function addClampedGradient(pixel: number, left: number, top: number, topLeft: number): number;
/** Adjusts a channel value halfway toward the gradient, clamped to 0..255. */
export declare function clampHalf(value: number, reference: number): number;
/** Converts packed ARGB32 pixels to interleaved RGBA bytes. */
export declare function toRgba(pixels: Uint32Array): Uint8Array;
//# sourceMappingURL=argb.d.ts.map