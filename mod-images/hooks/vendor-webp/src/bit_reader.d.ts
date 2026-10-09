/**
 * LSB-first bit reader for binary streams.
 *
 * @module
 */
/** Reads bits LSB-first from a byte buffer. */
export declare class BitReader {
    private readonly view;
    private readonly bitLength;
    private bitOffset;
    constructor(data: Uint8Array);
    /**
     * Reads `count` bits and advances the position.
     *
     * @param count Number of bits to read (1..25).
     * @return Unsigned integer from the consumed bits.
     *
     * @throws {Error} If the stream is exhausted.
     */
    read(count: number): number;
    /**
     * Returns `count` bits without consuming them. Pads with zeros at EOF.
     *
     * @param count Number of bits to peek (1..25).
     * @return Unsigned integer from the peeked bits.
     */
    peekPadded(count: number): number;
    /**
     * Discards `count` bits after a preceding peek.
     *
     * @param count Number of bits to skip.
     */
    advance(count: number): void;
}
//# sourceMappingURL=bit_reader.d.ts.map