/**
 * Affine transforms, for reasoning about where a piece actually ends up.
 *
 * A scene is a tree of nested transforms, and the renderer composes them by
 * nesting Konva groups. Anything that has to *move* a piece between frames of
 * reference — adding one to a combo, pushing a combo's deformation down into
 * its children — needs the same composition available as arithmetic.
 *
 * Column-vector convention, matching canvas:
 *
 *     | a c e |
 *     | b d f |
 *     | 0 0 1 |
 */
export interface Mat {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** `outer` applied after `inner`, the way a parent group wraps a child. */
export function multiply(outer: Mat, inner: Mat): Mat {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  }
}

export function compose(...mats: Mat[]): Mat {
  return mats.reduce(multiply, IDENTITY)
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

export function determinant(m: Mat): number {
  return m.a * m.d - m.b * m.c
}

/** Throws on a singular matrix: nothing in a scene should ever produce one. */
export function invert(m: Mat): Mat {
  const det = determinant(m)
  if (det === 0) throw new Error('cannot invert a degenerate transform')
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  }
}

export function translation(x: number, y: number): Mat {
  return { ...IDENTITY, e: x, f: y }
}

export function rotation(radians: number): Mat {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}

export function scaling(sx: number, sy: number): Mat {
  return { ...IDENTITY, a: sx, d: sy }
}

/**
 * One squash: rotate into the crush axis, squeeze, rotate back. Reciprocal
 * scales, so it changes shape and never area — the same map the renderer
 * builds out of nested groups.
 */
export function squashMatrix(angle: number, factor: number): Mat {
  return compose(rotation(angle), scaling(factor, 1 / factor), rotation(-angle))
}

/**
 * What a node can store: a position, a turn, a uniform size, an optional
 * mirror, and at most one squash.
 */
export interface Decomposed {
  x: number
  y: number
  rotation: number
  scale: number
  flipX: boolean
  /** Absent when the transform has no shape change in it. */
  squash?: { angle: number; factor: number }
}

/** Below this a squash is indistinguishable from none, and adds a transform. */
const SQUASH_EPSILON = 1e-9

/**
 * Pulls a transform apart into the fields a node holds.
 *
 * Every invertible affine map is a rotation, a uniform scale, an optional
 * mirror and one area-preserving squash — which is exactly the vocabulary a
 * piece already has, and why a piece can be moved into a deformed combo
 * without looking any different afterwards.
 *
 * The shape change comes from the singular values: their product is the
 * uniform scale, their ratio is the squash factor, and the rotation carrying
 * that squeeze is its axis.
 */
export function decompose(m: Mat): Decomposed {
  // A mirror is factored out first so the rest is a plain rotation and
  // squeeze; diag(-1,1) sits between scale and squash, which is where the
  // renderer puts flipX.
  const flipX = determinant(m) < 0
  const linear = flipX ? multiply(m, scaling(-1, 1)) : m

  const { a, b, c, d } = linear
  const e = (a + d) / 2
  const f = (a - d) / 2
  const g = (b + c) / 2
  const h = (b - c) / 2

  const q = Math.hypot(e, h)
  const r = Math.hypot(f, g)
  const sigma1 = q + r
  const sigma2 = q - r

  const a1 = Math.atan2(g, f)
  const a2 = Math.atan2(h, e)
  const theta = (a2 + a1) / 2
  const phi = (a2 - a1) / 2

  const scale = Math.sqrt(Math.max(sigma1 * sigma2, 0))
  const factor = sigma2 === 0 ? 1 : Math.sqrt(sigma1 / sigma2)

  // A mirror turns the squash axis the other way: diag(-1,1) Q(x) diag(-1,1)
  // is Q(-x), and the mirror has been moved to the outside of it.
  const angle = flipX ? phi : -phi

  return {
    x: m.e,
    y: m.f,
    rotation: theta + phi,
    scale,
    flipX,
    squash: Math.abs(factor - 1) < SQUASH_EPSILON ? undefined : { angle, factor },
  }
}

/** Rebuilds what `decompose` pulled apart, in the order the renderer nests. */
export function recompose(d: Decomposed): Mat {
  return compose(
    translation(d.x, d.y),
    rotation(d.rotation),
    scaling(d.scale * (d.flipX ? -1 : 1), d.scale),
    d.squash ? squashMatrix(d.squash.angle, d.squash.factor) : IDENTITY,
  )
}
