/**
 * Canonical Huffman prefix codes for VP8L.
 *
 * @module
 */
import type { BitReader } from "../bit_reader.js";
/** A group of five prefix codes used to decode VP8L symbols. */
export interface CodeGroup {
    /** Huffman tree for the green channel and meta-symbols. */
    readonly green: HuffmanTree;
    /** Huffman tree for the red channel. */
    readonly red: HuffmanTree;
    /** Huffman tree for the blue channel. */
    readonly blue: HuffmanTree;
    /** Huffman tree for the alpha channel. */
    readonly alpha: HuffmanTree;
    /** Huffman tree for LZ77 distance codes. */
    readonly distance: HuffmanTree;
}
/** Alphabet sizes for each channel in a code group. */
export interface AlphabetSizes {
    /** Green channel alphabet size (includes literals, length codes, and cache). */
    readonly green: number;
    /** Red channel alphabet size (literals only). */
    readonly red: number;
    /** Blue channel alphabet size (literals only). */
    readonly blue: number;
    /** Alpha channel alphabet size (literals only). */
    readonly alpha: number;
    /** Distance code alphabet size. */
    readonly distance: number;
}
/**
 * Two-level table-based Huffman decoder.
 *
 * Short codes (≤ PRIMARY_BITS) are resolved in a single primary table lookup.
 * Long codes use a secondary subtable reached via a redirect entry (sign bit set).
 *
 * Direct entry: `(length << 16) | symbol`.
 * Redirect entry (bit 31 set): `0x80000000 | (secondaryBits << 16) | secondaryOffset`.
 */
declare class HuffmanTree {
    private readonly table;
    private readonly primarySize;
    private readonly maxBits;
    private readonly onlySymbol;
    constructor(table: Int32Array, primarySize: number, maxBits: number, onlySymbol: number | null);
    /**
     * Decodes the next symbol from the bitstream.
     *
     * @param reader Bit reader.
     * @return Decoded symbol value.
     */
    decode(reader: BitReader): number;
}
/**
 * Reads a complete code group (5 prefix codes) from the bitstream.
 *
 * @param reader Bit reader positioned at the code group.
 * @param sizes Alphabet sizes for each of the five codes.
 * @return Parsed code group.
 *
 * @throws {Error} If the code table is invalid or the bitstream is truncated.
 */
export declare function readCodeGroup(reader: BitReader, sizes: AlphabetSizes): CodeGroup;
export {};
//# sourceMappingURL=huffman.d.ts.map