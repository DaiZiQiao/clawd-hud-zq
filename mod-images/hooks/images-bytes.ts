// Bytes to base64 and back, as the hooks environment does it: its
// `Uint8Array.prototype.toBase64` and `Uint8Array.fromBase64` are native there
// (and in the test kit), but not in TypeScript's es2023 lib, so they are
// named once here with a cast. Pure.

type Base64Bytes = Uint8Array & { toBase64: () => string }
type Base64Maker = { fromBase64: (text: string) => Uint8Array }

/** Standard padded base64 of the bytes: what a Raster's `cells` and an Image's `rgba` take. */
export const base64Of = (bytes: Uint8Array): string => (bytes as Base64Bytes).toBase64()

/** The bytes of standard padded base64: what `$.fs.read(path, { as: 'bytes' })` answers. */
export const bytesOf = (base64: string): Uint8Array => (Uint8Array as unknown as Base64Maker).fromBase64(base64)
