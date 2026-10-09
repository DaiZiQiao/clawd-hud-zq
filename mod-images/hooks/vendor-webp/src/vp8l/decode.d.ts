/**
 * VP8L lossless bitstream decoder.
 *
 * Reads the VP8L header, decodes transforms and the entropy-coded
 * main image, then applies inverse transforms to reconstruct pixels.
 *
 * @module
 */
/** Decoded VP8L image in packed ARGB32 format. */
export interface Vp8lImage {
    /** Image width in pixels. */
    readonly width: number;
    /** Image height in pixels. */
    readonly height: number;
    /** Pixel data as packed ARGB32 values. */
    readonly pixels: Uint32Array;
}
/**
 * Decodes a VP8L bitstream payload into ARGB pixels.
 *
 * @param payload VP8L chunk data (without the RIFF chunk header).
 * @return Decoded image dimensions and packed ARGB32 pixel buffer.
 *
 * @throws {Error} If the signature or version is invalid.
 */
export declare function decodeVp8l(payload: Uint8Array): Vp8lImage;
//# sourceMappingURL=decode.d.ts.map