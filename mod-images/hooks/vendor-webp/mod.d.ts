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
/** Result of decoding a WebP lossless image. */
export interface RawImageData {
    /** Image width in pixels. */
    width: number;
    /** Image height in pixels. */
    height: number;
    /** RGBA pixel data in row-major order. */
    data: Uint8Array;
}
/**
 * Decodes a WebP lossless image into RGBA pixel data.
 *
 * @param webp Raw `.webp` file bytes.
 * @return Decoded image dimensions and pixel buffer.
 *
 * @throws {Error} If the file is not a valid WebP VP8L image.
 */
export declare function decode(webp: Uint8Array): RawImageData;
//# sourceMappingURL=mod.d.ts.map