import type { Placed, Squash } from '../shared/scene'
import type { Point } from './clip'

/**
 * A 2×2 linear map, applied as `x' = a·x + c·y`, `y' = b·x + d·y`.
 *
 * The slice tool needs to turn a flick drawn on screen into a cut in the
 * piece's own frame, which means inverting everything the renderer applied.
 * Building that transform here — rather than reading it back out of Konva —
 * keeps it pure and testable, and the two are kept honest by mirroring the
 * same nesting order.
 */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1 }

export function rotation(radians: number): Matrix {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { a: cos, b: sin, c: -sin, d: cos }
}

export function scaling(sx: number, sy: number): Matrix {
  return { a: sx, b: 0, c: 0, d: sy }
}

/** `first` is applied to the point before `second`. */
export function multiply(second: Matrix, first: Matrix): Matrix {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
  }
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y }
}

export function invert(m: Matrix): Matrix | null {
  const det = m.a * m.d - m.b * m.c
  // A fully collapsed piece has no inverse; callers treat that as "no cut".
  if (Math.abs(det) < 1e-9) return null
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det }
}

/** Conjugating a scale by the crush angle deforms along that axis. */
export function squashMatrix(squash: Squash): Matrix {
  const across = Math.sqrt(squash.factor)
  return multiply(
    rotation(squash.angle),
    multiply(scaling(across, 1 / squash.factor), rotation(-squash.angle)),
  )
}

/**
 * Everything between the piece's own coordinates and the canvas: squashes
 * (newest outermost, matching how the renderer nests them), then the uniform
 * scale and flip, then the piece's angle.
 */
export function pieceMatrix(piece: Placed, rotationOverride?: number): Matrix {
  let m: Matrix = IDENTITY

  // The renderer nests later squashes further out, so they are applied last.
  for (const squash of piece.squashes ?? []) {
    m = multiply(squashMatrix(squash), m)
  }

  m = multiply(scaling(piece.scale * (piece.flipX ? -1 : 1), piece.scale), m)
  m = multiply(rotation(rotationOverride ?? piece.rotation), m)
  return m
}
