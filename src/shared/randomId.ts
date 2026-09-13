/**
 * `crypto.randomUUID` exists only in a secure context, so it is missing over
 * plain http — which is exactly how the game is served when testing from a
 * phone on the LAN. `crypto.getRandomValues` carries no such restriction, so
 * fall back to assembling a v4 UUID out of it by hand.
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  let hex = ''
  for (const [index, byte] of bytes.entries()) {
    // Byte 6 carries the version nibble, byte 8 the variant bits.
    const tagged =
      index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte
    hex += tagged.toString(16).padStart(2, '0')
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
