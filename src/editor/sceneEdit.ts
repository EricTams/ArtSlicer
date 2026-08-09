import { parseHex, toHex } from '../render/tint'
import {
  type Cut,
  MAX_CUTS_PER_PIECE,
  MAX_PIECES,
  MAX_SCALE,
  MAX_SQUASH,
  MAX_SQUASHES_PER_PIECE,
  MIN_SCALE,
  type Placed,
  type Scene,
  type Squash,
  type Tint,
  topZ,
} from '../shared/scene'
import { invertCut } from '../render/clip'

/**
 * Pure scene mutations. Keeping these out of React makes the editor's rules —
 * piece caps, layering, squash and cut limits, how paint layers — testable
 * without mounting a canvas. Every function returns a new Scene, which is also
 * what makes undo trivial.
 */

export function addPiece(
  scene: Scene,
  pieceId: string,
  id: string,
  at?: { x: number; y: number },
): Scene {
  if (scene.pieces.length >= MAX_PIECES) return scene

  const piece: Placed = {
    id,
    pieceId,
    x: at?.x ?? 500,
    y: at?.y ?? 500,
    scale: 1,
    rotation: 0,
    z: topZ(scene) + 1,
  }
  return { ...scene, pieces: [...scene.pieces, piece] }
}

export function updatePiece(scene: Scene, id: string, changes: Partial<Placed>): Scene {
  return {
    ...scene,
    pieces: scene.pieces.map((piece) => (piece.id === id ? { ...piece, ...changes } : piece)),
  }
}

export function removePiece(scene: Scene, id: string): Scene {
  return { ...scene, pieces: scene.pieces.filter((piece) => piece.id !== id) }
}

export function movePiece(scene: Scene, id: string, x: number, y: number): Scene {
  return updatePiece(scene, id, { x, y })
}

/** Pinching gives both at once, so they are applied together. */
export function transformPiece(scene: Scene, id: string, scale: number, rotation: number): Scene {
  return updatePiece(scene, id, {
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    rotation,
  })
}

export function bringToFront(scene: Scene, id: string): Scene {
  return updatePiece(scene, id, { z: topZ(scene) + 1 })
}

export function sendToBack(scene: Scene, id: string): Scene {
  const lowest = scene.pieces.reduce((min, piece) => Math.min(min, piece.z), 0)
  return updatePiece(scene, id, { z: lowest - 1 })
}

export function flipPiece(scene: Scene, id: string): Scene {
  const piece = find(scene, id)
  if (!piece) return scene
  return updatePiece(scene, id, { flipX: !piece.flipX })
}

/**
 * Paint layers rather than replaces: spraying a second colour blends it into
 * whatever is already on the piece, weighted by how much of each was applied.
 * Spraying the same colour twice simply makes it stronger.
 */
export function sprayPiece(scene: Scene, id: string, color: string, delta: number): Scene {
  const piece = find(scene, id)
  if (!piece || delta <= 0) return scene

  const existing = piece.tint
  if (!existing || existing.amount <= 0) {
    return updatePiece(scene, id, { tint: { color, amount: Math.min(1, delta) } })
  }

  const total = existing.amount + delta
  const [r1, g1, b1] = parseHex(existing.color)
  const [r2, g2, b2] = parseHex(color)
  const mix = (a: number, b: number): number => (a * existing.amount + b * delta) / total

  const blended: Tint = {
    color: toHex(mix(r1, r2), mix(g1, g2), mix(b1, b2)),
    amount: Math.min(1, total),
  }
  return updatePiece(scene, id, { tint: blended })
}

export function clearTint(scene: Scene, id: string): Scene {
  const piece = find(scene, id)
  if (!piece?.tint) return scene
  const next = { ...piece }
  delete next.tint
  return replace(scene, next)
}

/**
 * Squeezes aimed the same way are the same crush, continued. Merging them
 * keeps repeated hits from stacking a nested transform each time — which is
 * what makes "squeeze it again" the natural way to reach an extreme shape
 * rather than an expensive one.
 */
const SAME_AXIS_TOLERANCE = 0.15

export function mergeSquash(squashes: readonly Squash[], next: Squash): Squash[] | null {
  const result = [...squashes]
  const last = result[result.length - 1]

  if (last && Math.abs(angleBetween(last.angle, next.angle)) < SAME_AXIS_TOLERANCE) {
    result[result.length - 1] = {
      angle: last.angle,
      // Crushes along one axis multiply: squeezing 1.5× twice is 2.25×.
      factor: Math.min(MAX_SQUASH, last.factor * next.factor),
    }
    return result
  }

  if (result.length >= MAX_SQUASHES_PER_PIECE) return null
  result.push({ ...next, factor: Math.min(MAX_SQUASH, next.factor) })
  return result
}

/** Smallest signed angle between two directions, accounting for wraparound. */
function angleBetween(a: number, b: number): number {
  const diff = (b - a) % (Math.PI * 2)
  if (diff > Math.PI) return diff - Math.PI * 2
  if (diff < -Math.PI) return diff + Math.PI * 2
  return diff
}

export function addSquash(scene: Scene, id: string, squash: Squash): Scene {
  const piece = find(scene, id)
  if (!piece) return scene

  const squashes = mergeSquash(piece.squashes ?? [], squash)
  if (!squashes) return scene
  return updatePiece(scene, id, { squashes })
}

export function clearSquashes(scene: Scene, id: string): Scene {
  const piece = find(scene, id)
  if (!piece?.squashes?.length) return scene
  const next = { ...piece }
  delete next.squashes
  return replace(scene, next)
}

/**
 * A cut splits one piece into two independent pieces — each keeps the same
 * colour, squashes and angle, and takes opposite sides of the cut. They are
 * nudged apart along the cut normal so it's visible that something happened.
 */
export function splitPiece(scene: Scene, id: string, cut: Cut, newId: string): Scene {
  const piece = find(scene, id)
  if (!piece) return scene

  const existing = piece.cuts ?? []
  // Out of cuts, or no room for the second half: leave the piece whole rather
  // than half-applying the slice.
  if (existing.length >= MAX_CUTS_PER_PIECE) return scene
  if (scene.pieces.length >= MAX_PIECES) return scene

  // Enough that the two halves visibly separate — otherwise a clean cut looks
  // like nothing happened — without flinging them apart.
  const nudge = 45 * piece.scale
  const keep: Placed = {
    ...piece,
    cuts: [...existing, cut],
    x: piece.x - cut.nx * nudge,
    y: piece.y - cut.ny * nudge,
  }
  const offcut: Placed = {
    ...piece,
    id: newId,
    cuts: [...existing, invertCut(cut)],
    x: piece.x + cut.nx * nudge,
    y: piece.y + cut.ny * nudge,
    z: piece.z + 1,
  }

  return { ...scene, pieces: [...scene.pieces.map((p) => (p.id === id ? keep : p)), offcut] }
}

export function setBackground(scene: Scene, color: string): Scene {
  return { ...scene, bg: color }
}

function find(scene: Scene, id: string): Placed | undefined {
  return scene.pieces.find((piece) => piece.id === id)
}

function replace(scene: Scene, piece: Placed): Scene {
  return { ...scene, pieces: scene.pieces.map((p) => (p.id === piece.id ? piece : p)) }
}

/**
 * Undo history. Bounded because a phone holding every intermediate drag state
 * would grow without limit over a long round.
 */
export const MAX_HISTORY = 30

export interface History {
  past: Scene[]
  present: Scene
}

export function pushHistory(history: History, next: Scene): History {
  if (next === history.present) return history
  const past = [...history.past, history.present].slice(-MAX_HISTORY)
  return { past, present: next }
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1]
  if (!previous) return history
  return { past: history.past.slice(0, -1), present: previous }
}

export function canUndo(history: History): boolean {
  return history.past.length > 0
}
