/**
 * Canonical Huffman prefix codes for VP8L.
 *
 * @module
 */
// ============================================================
// Constants
// ============================================================
/**
 * Permutation order for reading code-length-code lengths.
 *
 * Defined by the DEFLATE / VP8L specification.
 */
// deno-fmt-ignore
const CL_ORDER = new Uint8Array([
    17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);
/** Total alphabet size of the code-length alphabet (symbols 0..18). */
const CL_ALPHABET = 19;
/** Maximum literal code length value (symbols 0..15 represent actual lengths). */
const MAX_CODE_LENGTH = 15;
/** Code-length symbol: repeat the previous non-zero length 3..6 times. */
const CL_REPEAT_PREVIOUS = 16;
/** Code-length symbol: repeat zero 3..10 times. */
const CL_REPEAT_ZERO_SHORT = 17;
/** Code-length symbol: repeat zero 11..138 times. */
const CL_REPEAT_ZERO_LONG = 18;
/** Default value for the previous non-zero code length (VP8L spec). */
const DEFAULT_CODE_LENGTH = 8;
// ============================================================
// Huffman tree
// ============================================================
/** Number of bits resolved by the primary lookup table. */
const PRIMARY_BITS = 10;
/**
 * Two-level table-based Huffman decoder.
 *
 * Short codes (≤ PRIMARY_BITS) are resolved in a single primary table lookup.
 * Long codes use a secondary subtable reached via a redirect entry (sign bit set).
 *
 * Direct entry: `(length << 16) | symbol`.
 * Redirect entry (bit 31 set): `0x80000000 | (secondaryBits << 16) | secondaryOffset`.
 */
class HuffmanTree {
    table;
    primarySize;
    maxBits;
    onlySymbol;
    constructor(table, primarySize, maxBits, onlySymbol) {
        this.table = table;
        this.primarySize = primarySize;
        this.maxBits = maxBits;
        this.onlySymbol = onlySymbol;
    }
    /**
     * Decodes the next symbol from the bitstream.
     *
     * @param reader Bit reader.
     * @return Decoded symbol value.
     */
    decode(reader) {
        if (this.onlySymbol !== null)
            return this.onlySymbol;
        const bits = reader.peekPadded(this.maxBits);
        let entry = this.table[bits & (this.primarySize - 1)];
        if (entry < 0) {
            const secBits = (entry >>> 16) & 0xf;
            const secStart = this.primarySize + (entry & 0xffff);
            entry = this.table[secStart + ((bits >>> PRIMARY_BITS) & ((1 << secBits) - 1))];
        }
        reader.advance(entry >>> 16);
        return entry & 0xffff;
    }
}
// ============================================================
// Public API
// ============================================================
/**
 * Reads a complete code group (5 prefix codes) from the bitstream.
 *
 * @param reader Bit reader positioned at the code group.
 * @param sizes Alphabet sizes for each of the five codes.
 * @return Parsed code group.
 *
 * @throws {Error} If the code table is invalid or the bitstream is truncated.
 */
export function readCodeGroup(reader, sizes) {
    return {
        green: buildTree(readLengths(reader, sizes.green)),
        red: buildTree(readLengths(reader, sizes.red)),
        blue: buildTree(readLengths(reader, sizes.blue)),
        alpha: buildTree(readLengths(reader, sizes.alpha)),
        distance: buildTree(readLengths(reader, sizes.distance)),
    };
}
// ============================================================
// Tree construction
// ============================================================
/** Builds a `HuffmanTree` from per-symbol code lengths. */
function buildTree(lengths) {
    // Find max code length and count symbols with non-zero length
    let maxLength = 0;
    let symbolCount = 0;
    for (let i = 0; i < lengths.length; i++) {
        if (lengths[i] > 0) {
            symbolCount++;
            if (lengths[i] > maxLength)
                maxLength = lengths[i];
        }
    }
    if (symbolCount === 0) {
        return new HuffmanTree(new Int32Array(0), 0, 0, null);
    }
    if (symbolCount === 1) {
        for (let i = 0; i < lengths.length; i++) {
            if (lengths[i] > 0) {
                return new HuffmanTree(new Int32Array(0), 0, 0, i);
            }
        }
    }
    // Count codes per length
    const counts = new Uint32Array(maxLength + 1);
    for (let i = 0; i < lengths.length; i++) {
        if (lengths[i] > 0)
            counts[lengths[i]]++;
    }
    // Validate: tree must not be over-subscribed
    let slots = 1;
    for (let length = 1; length <= maxLength; length++) {
        slots = (slots << 1) - counts[length];
    }
    if (slots < 0) {
        throw new Error("Over-subscribed Huffman code table");
    }
    // Compute first canonical code for each length
    const firstCode = new Uint32Array(maxLength + 1);
    let code = 0;
    for (let length = 1; length <= maxLength; length++) {
        code = (code + counts[length - 1]) << 1;
        firstCode[length] = code;
    }
    // Compute reversed codes for all symbols
    const codes = [];
    for (let symbol = 0; symbol < lengths.length; symbol++) {
        const length = lengths[symbol];
        if (length === 0)
            continue;
        const canonical = firstCode[length]++;
        // Reverse bits for LSB-first table indexing
        let reversed = 0;
        let temp = canonical;
        for (let i = 0; i < length; i++) {
            reversed = (reversed << 1) | (temp & 1);
            temp >>>= 1;
        }
        codes.push({ symbol, length, reversed });
    }
    const effectivePrimary = Math.min(PRIMARY_BITS, maxLength);
    const primarySize = 1 << effectivePrimary;
    const primaryMask = primarySize - 1;
    // All codes fit in primary table — single-level fallback
    if (maxLength <= PRIMARY_BITS) {
        const table = new Int32Array(primarySize);
        for (const { symbol, length, reversed } of codes) {
            const entry = (length << 16) | symbol;
            const step = 1 << length;
            for (let pos = reversed; pos < primarySize; pos += step) {
                table[pos] = entry;
            }
        }
        return new HuffmanTree(table, primarySize, maxLength, null);
    }
    // Determine secondary subtable sizes per primary prefix
    const secBitsPerPrefix = new Uint8Array(primarySize);
    for (const { length, reversed } of codes) {
        if (length > PRIMARY_BITS) {
            const prefix = reversed & primaryMask;
            const secBits = length - PRIMARY_BITS;
            if (secBits > secBitsPerPrefix[prefix])
                secBitsPerPrefix[prefix] = secBits;
        }
    }
    let totalSecondary = 0;
    const secOffsets = new Uint32Array(primarySize);
    for (let i = 0; i < primarySize; i++) {
        if (secBitsPerPrefix[i] > 0) {
            secOffsets[i] = totalSecondary;
            totalSecondary += 1 << secBitsPerPrefix[i];
        }
    }
    const table = new Int32Array(primarySize + totalSecondary);
    // Fill short codes in primary table
    for (const { symbol, length, reversed } of codes) {
        if (length <= PRIMARY_BITS) {
            const entry = (length << 16) | symbol;
            const step = 1 << length;
            for (let pos = reversed; pos < primarySize; pos += step) {
                table[pos] = entry;
            }
        }
    }
    // Set redirect entries for prefixes that have long codes
    for (let i = 0; i < primarySize; i++) {
        if (secBitsPerPrefix[i] > 0) {
            table[i] = (0x80000000 | (secBitsPerPrefix[i] << 16) | secOffsets[i]) | 0;
        }
    }
    // Fill secondary subtables for long codes
    for (const { symbol, length, reversed } of codes) {
        if (length > PRIMARY_BITS) {
            const prefix = reversed & primaryMask;
            const secBits = secBitsPerPrefix[prefix];
            const secSize = 1 << secBits;
            const secIndex = reversed >>> PRIMARY_BITS;
            const entry = (length << 16) | symbol;
            const step = 1 << (length - PRIMARY_BITS);
            const base = primarySize + secOffsets[prefix];
            for (let pos = secIndex; pos < secSize; pos += step) {
                table[base + pos] = entry;
            }
        }
    }
    return new HuffmanTree(table, primarySize, maxLength, null);
}
// ============================================================
// Code length reading
// ============================================================
/**
 * Reads Huffman code lengths for a given alphabet size.
 *
 * VP8L supports two formats:
 * - **Simple** (1-bit flag = 1): encodes 1 or 2 symbols directly.
 * - **Normal** (1-bit flag = 0): uses a nested code-length-code with RLE.
 */
function readLengths(reader, alphabetSize) {
    const isSimple = reader.read(1) === 1;
    return isSimple ? readSimpleLengths(reader, alphabetSize) : readComplexLengths(reader, alphabetSize);
}
/** Reads 1 or 2 symbols encoded with the simple format. */
function readSimpleLengths(reader, alphabetSize) {
    const output = new Uint8Array(alphabetSize);
    const symbolCount = reader.read(1) + 1;
    const isWide = reader.read(1) === 1;
    const firstSymbol = reader.read(isWide ? 8 : 1);
    output[firstSymbol] = 1;
    if (symbolCount === 2) {
        const secondSymbol = reader.read(8);
        output[secondSymbol] = 1;
    }
    return output;
}
/** Reads code lengths using the complex (code-length-code + RLE) format. */
function readComplexLengths(reader, alphabetSize) {
    // Read code-length-code lengths (the "second level" Huffman used to decode the actual lengths)
    const numCodeLengths = reader.read(4) + 4;
    const codeLengthLengths = new Uint8Array(CL_ALPHABET);
    for (let i = 0; i < numCodeLengths; i++) {
        codeLengthLengths[CL_ORDER[i]] = reader.read(3);
    }
    const codeLengthTree = buildTree(codeLengthLengths);
    // Optional max-symbol cap
    let maxSymbols = alphabetSize;
    if (reader.read(1) === 1) {
        const numBits = 2 + 2 * reader.read(3);
        maxSymbols = 2 + reader.read(numBits);
    }
    // Decode lengths using RLE. max_symbol limits the number of code-length-tree
    // reads (iterations), not output index. It is decremented once per outer loop iteration.
    const output = new Uint8Array(alphabetSize);
    let prevNonZero = DEFAULT_CODE_LENGTH;
    let index = 0;
    let remaining = maxSymbols;
    while (index < alphabetSize) {
        if (remaining === 0)
            break;
        remaining--;
        const symbol = codeLengthTree.decode(reader);
        // Literal length (0..15)
        if (symbol <= MAX_CODE_LENGTH) {
            output[index] = symbol;
            index++;
            if (symbol !== 0)
                prevNonZero = symbol;
            continue;
        }
        // RLE instructions
        let repeat;
        let value;
        if (symbol === CL_REPEAT_PREVIOUS) {
            repeat = 3 + reader.read(2);
            value = prevNonZero;
        }
        else if (symbol === CL_REPEAT_ZERO_SHORT) {
            repeat = 3 + reader.read(3);
            value = 0;
        }
        else if (symbol === CL_REPEAT_ZERO_LONG) {
            repeat = 11 + reader.read(7);
            value = 0;
        }
        else {
            throw new Error(`Unknown code-length symbol: ${symbol}`);
        }
        const end = Math.min(index + repeat, alphabetSize);
        output.fill(value, index, end);
        index = end;
    }
    return output;
}
//# sourceMappingURL=huffman.js.map