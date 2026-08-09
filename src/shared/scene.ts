/**
 * The wire format for a piece of artwork.
 *
 * Artwork travels as a recipe, not pixels: the host and every phone run the
 * same bundle and therefore already have every sprite, so a few hundred bytes
 * of placement data re-renders crisply at any size. A busy scene is under 4 KB,
 * which is nothing over a DataChannel — and the host can redraw it at laptop
 * resolution instead of upscaling a phone-sized screenshot.
 */

/** Every scene is authored in this square space and scaled to fit any display. */
export const DESIGN_SIZE = 1000

/**
 * A slice, stored as a half-plane in the piece's local space: keep the side
 * where `nx * x + ny * y <= d`. Intersecting half-planes is always convex,
 * which keeps the clip math small and total.
 */
export interface Cut {
  nx: number
  ny: number
  d: number
}

export interface Placed {
  /** Instance id — a piece can appear many times in one scene. */
  id: string
  /** Key into the asset manifest. */
  pieceId: string
  x: number
  y: number
  scaleX: number
  scaleY: number
  /** Radians. */
  rotation: number
  flipX?: boolean
  /** Index into the fixed palette; undefined means the sprite's own colours. */
  tint?: number
  cuts?: Cut[]
  z: number
}

export interface Scene {
  pieces: Placed[]
  /** Palette index for the backdrop. */
  bg?: number
}

export const MAX_PIECES = 25

export function emptyScene(): Scene {
  return { pieces: [] }
}

/** Highest z in use, so newly added pieces land on top. */
export function topZ(scene: Scene): number {
  return scene.pieces.reduce((max, piece) => Math.max(max, piece.z), 0)
}

/**
 * Clients are not trusted, so a submitted scene is clamped before the host
 * stores or re-renders it. A hostile or buggy phone should never be able to
 * push the shared screen into a broken state.
 */
export function sanitizeScene(input: unknown, isKnownPiece: (id: string) => boolean): Scene | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (!Array.isArray(raw['pieces'])) return null

  const pieces: Placed[] = []
  for (const entry of raw['pieces'].slice(0, MAX_PIECES)) {
    const piece = sanitizePlaced(entry, isKnownPiece)
    if (piece) pieces.push(piece)
  }

  const bg = num(raw['bg'])
  return bg === null ? { pieces } : { pieces, bg: clamp(Math.round(bg), 0, 63) }
}

function sanitizePlaced(input: unknown, isKnownPiece: (id: string) => boolean): Placed | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>

  const pieceId = raw['pieceId']
  const id = raw['id']
  if (typeof pieceId !== 'string' || typeof id !== 'string') return null
  if (!isKnownPiece(pieceId)) return null

  const x = num(raw['x'])
  const y = num(raw['y'])
  const scaleX = num(raw['scaleX'])
  const scaleY = num(raw['scaleY'])
  const rotation = num(raw['rotation'])
  const z = num(raw['z'])
  if (
    x === null ||
    y === null ||
    scaleX === null ||
    scaleY === null ||
    rotation === null ||
    z === null
  ) {
    return null
  }

  const tint = num(raw['tint'])
  const piece: Placed = {
    id: id.slice(0, 64),
    pieceId,
    // Allow some overhang past the edges — half-off compositions are a
    // legitimate look — but not so far that a piece can vanish or blow up.
    x: clamp(x, -DESIGN_SIZE, DESIGN_SIZE * 2),
    y: clamp(y, -DESIGN_SIZE, DESIGN_SIZE * 2),
    scaleX: clampScale(scaleX),
    scaleY: clampScale(scaleY),
    rotation: Number.isFinite(rotation) ? rotation % (Math.PI * 2) : 0,
    z: clamp(Math.round(z), 0, MAX_PIECES * 2),
  }

  if (raw['flipX'] === true) piece.flipX = true
  if (tint !== null) piece.tint = clamp(Math.round(tint), 0, 63)

  const cuts = sanitizeCuts(raw['cuts'])
  if (cuts.length) piece.cuts = cuts

  return piece
}

/** Cutting is capped: each cut is another clip edge to evaluate every frame. */
export const MAX_CUTS_PER_PIECE = 4

function sanitizeCuts(input: unknown): Cut[] {
  if (!Array.isArray(input)) return []
  const cuts: Cut[] = []
  for (const entry of input.slice(0, MAX_CUTS_PER_PIECE)) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const nx = num(raw['nx'])
    const ny = num(raw['ny'])
    const d = num(raw['d'])
    if (nx === null || ny === null || d === null) continue
    // A zero-length normal describes no half-plane at all.
    if (Math.hypot(nx, ny) < 1e-6) continue
    cuts.push({ nx, ny, d })
  }
  return cuts
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Scale may be negative (a mirrored piece) but never zero, and never so large
 * that one piece covers everything.
 */
function clampScale(value: number): number {
  const sign = value < 0 ? -1 : 1
  return sign * clamp(Math.abs(value), 0.05, 8)
}
