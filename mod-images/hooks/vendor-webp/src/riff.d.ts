/**
 * WebP RIFF container parser.
 *
 * @module
 */
/**
 * Extracts the VP8L bitstream payload from a WebP file.
 *
 * @param data Raw WebP file bytes.
 * @return VP8L chunk payload (without the chunk header).
 *
 * @throws {Error} If the container is malformed or has no VP8L chunk.
 */
export declare function extractVp8l(data: Uint8Array): Uint8Array;
//# sourceMappingURL=riff.d.ts.map