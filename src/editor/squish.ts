/**
 * Geometry for the crusher. Kept out of the component because a sign error
 * here silently mirrors every crush, which is invisible on a symmetric piece
 * and baffling on anything else.
 */

/**
 * Turns a crush direction measured on screen into the angle stored on the
 * piece.
 *
 * A stored `angle` of 0 crushes along the piece's y axis, so a screen
 * direction has to be turned back by a quarter turn — and by however far the
 * piece itself is rotated, since the swing is aimed at what the player can
 * see rather than at the piece's own axes.
 */
export function crushAngle(screenAngle: number, pieceRotation: number): number {
  return screenAngle - pieceRotation - Math.PI / 2
}

/**
 * One squeeze deliberately does little: a slow full swing is about 1.2×, a
 * hard one about 1.7×. Extreme shapes come from hitting it again and again,
 * which is what makes it a crusher rather than a slider.
 */
export const GENTLE_SQUEEZE = 0.2
export const SPEED_BONUS = 0.5

export function squeezeFactor(closed: number, speedFraction: number): number {
  const swing = clamp01(closed)
  return 1 + swing * (GENTLE_SQUEEZE + clamp01(speedFraction) * SPEED_BONUS)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
