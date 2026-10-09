/**
 * LSB-first bit reader for binary streams.
 *
 * @module
 */
/** Reads bits LSB-first from a byte buffer. */
export class BitReader {
    view;
    bitLength;
    bitOffset = 0;
    constructor(data) {
        // Pad with 4 zero bytes so getUint32 is safe near the end
        const padded = new Uint8Array(data.length + 4);
        padded.set(data);
        this.view = new DataView(padded.buffer);
        this.bitLength = data.length * 8;
    }
    /**
     * Reads `count` bits and advances the position.
     *
     * @param count Number of bits to read (1..25).
     * @return Unsigned integer from the consumed bits.
     *
     * @throws {Error} If the stream is exhausted.
     */
    read(count) {
        if (this.bitOffset + count > this.bitLength) {
            throw new Error("Unexpected end of bitstream");
        }
        const value = this.peekPadded(count);
        this.bitOffset += count;
        return value;
    }
    /**
     * Returns `count` bits without consuming them. Pads with zeros at EOF.
     *
     * @param count Number of bits to peek (1..25).
     * @return Unsigned integer from the peeked bits.
     */
    peekPadded(count) {
        const bytePos = this.bitOffset >>> 3;
        const bitPos = this.bitOffset & 7;
        const raw = this.view.getUint32(bytePos, true);
        return (raw >>> bitPos) & ((1 << count) - 1);
    }
    /**
     * Discards `count` bits after a preceding peek.
     *
     * @param count Number of bits to skip.
     */
    advance(count) {
        this.bitOffset += count;
    }
}
//# sourceMappingURL=bit_reader.js.map