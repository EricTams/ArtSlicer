import { nodeMatrix } from '../editor/combo'
import type { Scene, SceneNode } from '../shared/scene'
import { isCombo } from '../shared/scene'
import { getPiece } from './pieces'
import { apply, determinant, invert } from './transform2d'

/**
 * The topmost node under a point, in scene coordinates.
 *
 * Konva could answer this, but the canvas is driven by raw pointer events so
 * that two-finger gestures work, and this keeps hit-testing on the same
 * transform maths the slice tool uses rather than a second source of truth.
 *
 * A combo answers for everything inside it: touching any part of one picks up
 * the whole thing, which is what makes it one object to handle.
 */
export function pieceAt(scene: Scene, x: number, y: number): SceneNode | null {
  const ordered = [...scene.pieces].sort((a, b) => b.z - a.z)

  for (const node of ordered) {
    if (containsPoint(node, x, y)) return node
  }
  return null
}

export function containsPoint(node: SceneNode, x: number, y: number): boolean {
  const matrix = nodeMatrix(node)
  // Fully collapsed: nothing left to hit.
  if (Math.abs(determinant(matrix)) < 1e-9) return false

  // Back into the node's own coordinates, where the bounds and cuts live. The
  // matrix carries the pivot, so this lands in sprite space directly.
  const local = apply(invert(matrix), x, y)

  // A slice on a combo clips everything inside it, so it rules out a hit
  // before any child is asked.
  for (const cut of node.cuts ?? []) {
    if (cut.nx * local.x + cut.ny * local.y > cut.d) return false
  }

  if (isCombo(node)) {
    return node.children.some((child) => containsPoint(child, local.x, local.y))
  }

  const def = getPiece(node.pieceId)
  if (!def) return false
  return Math.abs(local.x) <= def.width / 2 && Math.abs(local.y) <= def.height / 2
}
