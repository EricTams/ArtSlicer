import type { Placed, Scene } from '../shared/scene'
import { getPiece } from './pieces'
import { apply, invert, pieceMatrix } from './transform'

/**
 * The topmost piece under a point, in scene coordinates.
 *
 * Konva could answer this, but the canvas is driven by raw pointer events so
 * that two-finger gestures work, and this keeps hit-testing on the same
 * transform maths the slice tool uses rather than a second source of truth.
 */
export function pieceAt(scene: Scene, x: number, y: number): Placed | null {
  const ordered = [...scene.pieces].sort((a, b) => b.z - a.z)

  for (const piece of ordered) {
    if (containsPoint(piece, x, y)) return piece
  }
  return null
}

export function containsPoint(piece: Placed, x: number, y: number): boolean {
  const def = getPiece(piece.pieceId)
  if (!def) return false

  const matrix = invert(pieceMatrix(piece))
  // Fully collapsed: nothing left to hit.
  if (!matrix) return false

  const local = apply(matrix, { x: x - piece.x, y: y - piece.y })

  // Inside the sprite's box…
  if (Math.abs(local.x) > def.width / 2 || Math.abs(local.y) > def.height / 2) return false

  // …and on the kept side of every slice.
  for (const cut of piece.cuts ?? []) {
    if (cut.nx * local.x + cut.ny * local.y > cut.d) return false
  }
  return true
}
