/**
 * The wire format for a piece of artwork.
 *
 * Artwork travels as a recipe, not pixels: the host and every phone run the
 * same bundle and therefore already have every sprite, so a few hundred bytes
 * of placement data re-renders crisply at any size. A busy scene is a couple of
 * KB, which is nothing over a DataChannel — and the host can redraw it at
 * laptop resolution instead of upscaling a phone-sized screenshot.
 */

/** Every scene is authored in this square space and scaled to fit any display. */
export const DESIGN_SIZE = 1000

/**
 * A slice, stored as a half-plane in the piece's own space: keep the side
 * where `nx * x + ny * y <= d`. Intersecting half-planes is always convex,
 * which keeps the clip math small and total.
 */
export interface Cut {
  nx: number
  ny: number
  d: number
}

/**
 * One pass through the crusher: squeezed by `factor` along `angle`, and
 * stretched perpendicular to it.
 *
 * Stored as an axis rather than folded into scaleX/scaleY because the piece
 * springs back upright after squishing — a diagonal crush on an upright piece
 * is not expressible as an axis-aligned scale. Rendering conjugates a scale by
 * the angle, and successive squashes compose by nesting.
 */
export interface Squash {
  /**
   * Radians, in the piece's own frame. Zero crushes **vertically** — the crush
   * direction is the piece's y axis turned by this angle. Getting this
   * backwards mirrors the deformation, so it is pinned down by tests.
   */
  angle: number
  /** > 1 squeezes along the axis; the perpendicular stretches to compensate. */
  factor: number
}

/** Mixed paint: a colour and how heavily it has been sprayed on. */
export interface Tint {
  /** `#rrggbb`. */
  color: string
  /** 0 = untouched, 1 = fully tinted. */
  amount: number
}

export interface Placed {
  /** Instance id — a piece can appear many times in one scene. */
  id: string
  /** Key into the asset manifest. */
  pieceId: string
  x: number
  y: number
  /** Uniform, set by pinching. Squashing changes shape, never overall size. */
  scale: number
  /** Radians. */
  rotation: number
  flipX?: boolean
  squashes?: Squash[]
  tint?: Tint
  cuts?: Cut[]
  z: number
}

export interface Scene {
  pieces: Placed[]
  /** `#rrggbb` backdrop, mixed in the colour tool like everything else. */
  bg?: string
}

export const MAX_PIECES = 25
/** Each squash is another nested transform evaluated every frame. */
export const MAX_SQUASHES_PER_PIECE = 4
/** Each cut is another clip edge evaluated every frame. */
export const MAX_CUTS_PER_PIECE = 4

export const MIN_SCALE = 0.15
export const MAX_SCALE = 4
export const MIN_SQUASH = 1
/**
 * The cap on one axis' *accumulated* crush. A single squeeze does far less
 * than this — reaching the extreme takes repeated hits, which is the point of
 * the crusher.
 */
export const MAX_SQUASH = 12

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

  const bg = sanitizeColor(raw['bg'])
  return bg ? { pieces, bg } : { pieces }
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
  const scale = num(raw['scale'])
  const rotation = num(raw['rotation'])
  const z = num(raw['z'])
  if (x === null || y === null || scale === null || rotation === null || z === null) return null

  const piece: Placed = {
    id: id.slice(0, 64),
    pieceId,
    // Allow some overhang past the edges — half-off compositions are a
    // legitimate look — but not so far that a piece can vanish or blow up.
    x: clamp(x, -DESIGN_SIZE, DESIGN_SIZE * 2),
    y: clamp(y, -DESIGN_SIZE, DESIGN_SIZE * 2),
    scale: clamp(scale, MIN_SCALE, MAX_SCALE),
    rotation: Number.isFinite(rotation) ? rotation % (Math.PI * 2) : 0,
    z: clamp(Math.round(z), -MAX_PIECES * 2, MAX_PIECES * 2),
  }

  if (raw['flipX'] === true) piece.flipX = true

  const tint = sanitizeTint(raw['tint'])
  if (tint) piece.tint = tint

  const squashes = sanitizeSquashes(raw['squashes'])
  if (squashes.length) piece.squashes = squashes

  const cuts = sanitizeCuts(raw['cuts'])
  if (cuts.length) piece.cuts = cuts

  return piece
}

function sanitizeSquashes(input: unknown): Squash[] {
  if (!Array.isArray(input)) return []
  const squashes: Squash[] = []
  for (const entry of input.slice(0, MAX_SQUASHES_PER_PIECE)) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const angle = num(raw['angle'])
    const factor = num(raw['factor'])
    if (angle === null || factor === null) continue
    squashes.push({ angle: angle % (Math.PI * 2), factor: clamp(factor, MIN_SQUASH, MAX_SQUASH) })
  }
  return squashes
}

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

function sanitizeTint(input: unknown): Tint | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  const color = sanitizeColor(raw['color'])
  const amount = num(raw['amount'])
  if (!color || amount === null) return null
  return { color, amount: clamp(amount, 0, 1) }
}

/** Only `#rrggbb` — anything else could smuggle arbitrary CSS into a fill. */
export function sanitizeColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input.toLowerCase() : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
