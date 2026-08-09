import type { Cut } from '../shared/scene'
import { DESIGN_SIZE, MAX_CUTS_PER_PIECE, MAX_PIECES, type Placed, type Scene, topZ } from '../shared/scene'
import { PALETTE } from '../render/palette'

/**
 * Pure scene mutations. Keeping these out of React makes the editor's rules —
 * piece caps, layering, cut limits — testable without mounting a canvas.
 * Every function returns a new Scene, which is also what makes undo trivial.
 */

export function addPiece(scene: Scene, pieceId: string, id: string): Scene {
  if (scene.pieces.length >= MAX_PIECES) return scene

  const piece: Placed = {
    id,
    pieceId,
    // Land in the middle at a size that reads on a phone without covering
    // everything already placed.
    x: DESIGN_SIZE / 2,
    y: DESIGN_SIZE / 2,
    scaleX: 1,
    scaleY: 1,
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

export function bringToFront(scene: Scene, id: string): Scene {
  return updatePiece(scene, id, { z: topZ(scene) + 1 })
}

export function sendToBack(scene: Scene, id: string): Scene {
  const lowest = scene.pieces.reduce((min, piece) => Math.min(min, piece.z), 0)
  return updatePiece(scene, id, { z: lowest - 1 })
}

export function flipPiece(scene: Scene, id: string): Scene {
  const piece = scene.pieces.find((p) => p.id === id)
  if (!piece) return scene
  return updatePiece(scene, id, { flipX: !piece.flipX })
}

export function cyclePieceTint(scene: Scene, id: string, delta: number): Scene {
  const piece = scene.pieces.find((p) => p.id === id)
  if (!piece) return scene
  const current = piece.tint ?? 0
  const next = (current + delta + PALETTE.length) % PALETTE.length
  return updatePiece(scene, id, { tint: next })
}

export function setPieceTint(scene: Scene, id: string, tint: number): Scene {
  return updatePiece(scene, id, { tint })
}

export function addCut(scene: Scene, id: string, cut: Cut): Scene {
  const piece = scene.pieces.find((p) => p.id === id)
  if (!piece) return scene

  const cuts = [...(piece.cuts ?? []), cut]
  // Each cut is another clip edge evaluated every frame; cap it.
  if (cuts.length > MAX_CUTS_PER_PIECE) return scene
  return updatePiece(scene, id, { cuts })
}

export function clearCuts(scene: Scene, id: string): Scene {
  const piece = scene.pieces.find((p) => p.id === id)
  if (!piece?.cuts?.length) return scene
  const next = { ...piece }
  delete next.cuts
  return { ...scene, pieces: scene.pieces.map((p) => (p.id === id ? next : p)) }
}

export function setBackground(scene: Scene, bg: number): Scene {
  return { ...scene, bg }
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
