/**
 * WebP RIFF container parser.
 *
 * @module
 */
// Minimum RIFF header: "RIFF" (4) + size (4) + "WEBP" (4) = 12
const MIN_HEADER_SIZE = 12;
// Chunk header: fourcc (4) + size (4) = 8
const CHUNK_HEADER_SIZE = 8;
/**
 * Extracts the VP8L bitstream payload from a WebP file.
 *
 * @param data Raw WebP file bytes.
 * @return VP8L chunk payload (without the chunk header).
 *
 * @throws {Error} If the container is malformed or has no VP8L chunk.
 */
export function extractVp8l(data) {
    if (data.length < MIN_HEADER_SIZE) {
        throw new Error("Data too short for a RIFF container");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Validate RIFF magic
    const riffMagic = ascii(data, 0, 4);
    if (riffMagic !== "RIFF") {
        throw new Error(`Expected RIFF magic, got "${riffMagic}"`);
    }
    // Validate WEBP form type
    const formType = ascii(data, 8, 4);
    if (formType !== "WEBP") {
        throw new Error(`Expected WEBP form type, got "${formType}"`);
    }
    // RIFF size field starts at offset 4 and counts bytes after "RIFF" + size (8 bytes)
    const riffSize = view.getUint32(4, true);
    const riffEnd = 8 + riffSize;
    let offset = MIN_HEADER_SIZE;
    // Walk chunks
    while (offset + CHUNK_HEADER_SIZE <= riffEnd &&
        offset + CHUNK_HEADER_SIZE <= data.length) {
        const fourcc = ascii(data, offset, 4);
        const size = view.getUint32(offset + 4, true);
        const payloadStart = offset + CHUNK_HEADER_SIZE;
        if (fourcc === "VP8L") {
            return data.subarray(payloadStart, payloadStart + size);
        }
        // Advance: payload + optional padding byte for even alignment
        offset = payloadStart + size + (size & 1);
    }
    throw new Error("No VP8L chunk found");
}
/** Reads `length` ASCII characters starting at `offset`. */
function ascii(data, offset, length) {
    let result = "";
    for (let i = 0; i < length; i++) {
        result += String.fromCharCode(data[offset + i]);
    }
    return result;
}
//# sourceMappingURL=riff.js.map