// Bytes to base64 and back, through the environment's own
// `Uint8Array.fromBase64` and `Uint8Array.prototype.toBase64`: JavaScriptCore
// has both, TypeScript's es2023 lib declares neither, so each is reached
// through one cast, here. `$.fs.read(path, { as: 'bytes' })` hands a file as
// base64, the decoders (hooks/decode-drive.ts) take bytes, and an Image takes
// its rgba as base64 again.

type FromBase64 = { fromBase64: (text: string) => Uint8Array }
type ToBase64 = { toBase64: () => string }

/** The bytes a base64 text holds (the standard alphabet, padded). */
export const bytesOfBase64 = (text: string): Uint8Array => (Uint8Array as unknown as FromBase64).fromBase64(text)

/** The bytes as standard, padded base64. */
export const base64Of = (bytes: Uint8Array): string => (bytes as unknown as ToBase64).toBase64()
