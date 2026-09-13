import { reachOf } from './combo'
import type { SceneNode } from '../shared/scene'

/**
 * The selected piece's transform handle.
 *
 * Pinching covers scale and rotation on a phone, but a mouse only ever has one
 * pointer, so without this a laptop cannot size or turn anything. Dragging the
 * handle does exactly what a pinch does — distance from the centre sets the
 * scale, angle around it sets the rotation — so the two agree by construction.
 */

/**
 * How far outside whatever it belongs to the handle sits, in scene units.
 *
 * Measured from the thing rather than fixed, because the things vary: sprites
 * reach 131 to 181 units from their middle and a combo of several reaches far
 * further. A fixed distance tuned for a typical sprite ends up inside the
 * largest ones, and well inside any combo — and since a press is tested
 * against the handle before it is tested against the artwork, a handle sitting
 * on the art turns dragging the thing into resizing it.
 */
const MARGIN = 15
const MIN_DISTANCE = 105
/** Far enough out for a big combo, near enough to stay on the picture. */
const MAX_DISTANCE = 420

/** Generous, because this is grabbed with a fingertip as well as a cursor. */
export const HANDLE_HIT_RADIUS = 95
export const HANDLE_DRAW_RADIUS = 34

export function handlePosition(piece: SceneNode): { x: number; y: number } {
  // Sits outside the piece and rides its rotation, so turning it is visibly
  // the handle swinging around rather than the piece drifting.
  const reach = reachOf(piece) * piece.scale + MARGIN
  const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, reach))
  const angle = piece.rotation - Math.PI / 4

  return {
    x: piece.x + Math.cos(angle) * distance,
    y: piece.y + Math.sin(angle) * distance,
  }
}

export function isOnHandle(piece: SceneNode, x: number, y: number): boolean {
  const handle = handlePosition(piece)
  return Math.hypot(x - handle.x, y - handle.y) <= HANDLE_HIT_RADIUS
}
