import type { Placed } from '../shared/scene'

/**
 * The selected piece's transform handle.
 *
 * Pinching covers scale and rotation on a phone, but a mouse only ever has one
 * pointer, so without this a laptop cannot size or turn anything. Dragging the
 * handle does exactly what a pinch does — distance from the centre sets the
 * scale, angle around it sets the rotation — so the two agree by construction.
 */

/** Distance from the piece's centre, in scene units. */
const REST_DISTANCE = 150
const MIN_DISTANCE = 105
const MAX_DISTANCE = 320

/** Generous, because this is grabbed with a fingertip as well as a cursor. */
export const HANDLE_HIT_RADIUS = 95
export const HANDLE_DRAW_RADIUS = 34

export function handlePosition(piece: Placed): { x: number; y: number } {
  // Sits outside the piece and rides its rotation, so turning it is visibly
  // the handle swinging around rather than the piece drifting.
  const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, REST_DISTANCE * piece.scale))
  const angle = piece.rotation - Math.PI / 4

  return {
    x: piece.x + Math.cos(angle) * distance,
    y: piece.y + Math.sin(angle) * distance,
  }
}

export function isOnHandle(piece: Placed, x: number, y: number): boolean {
  const handle = handlePosition(piece)
  return Math.hypot(x - handle.x, y - handle.y) <= HANDLE_HIT_RADIUS
}
