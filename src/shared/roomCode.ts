/**
 * Room codes double as PeerJS peer IDs, so they must be safe to type, safe to
 * read aloud, and namespaced against the shared public broker.
 */

/** No 0/O, 1/I/L, 5/S, 8/B — codes get read aloud across a room. */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'
const CODE_LENGTH = 4

/** Prefix namespaces us on the shared PeerJS cloud broker. */
export const PEER_ID_PREFIX = 'artslicer-'

export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) {
    code += ALPHABET.charAt(byte % ALPHABET.length)
  }
  return code
}

export function roomCodeToPeerId(code: string): string {
  return PEER_ID_PREFIX + normalizeRoomCode(code)
}

/** Accepts what a human typed: any case, with stray spaces or dashes. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidRoomCode(input: string): boolean {
  const code = normalizeRoomCode(input)
  if (code.length !== CODE_LENGTH) return false
  return [...code].every((char) => ALPHABET.includes(char))
}

/**
 * The absolute URL a phone should open, derived at runtime rather than
 * hardcoded — this works identically on localhost, a LAN IP, and Pages.
 */
export function joinUrl(code: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${window.location.origin}${base}/#/join/${normalizeRoomCode(code)}`
}
