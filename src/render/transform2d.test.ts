import { describe, expect, it } from 'vitest'

import {
  IDENTITY,
  type Mat,
  apply,
  compose,
  decompose,
  invert,
  multiply,
  recompose,
  rotation,
  scaling,
  squashMatrix,
  translation,
} from './transform2d'

const near = (got: number, want: number, tol = 1e-9) => expect(Math.abs(got - want)).toBeLessThan(tol)

function sameMatrix(got: Mat, want: Mat, tol = 1e-8): void {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) near(got[key], want[key], tol)
}

describe('composition', () => {
  it('applies the inner transform first, the way a parent wraps a child', () => {
    // Move right, then rotate a quarter turn about the origin.
    const m = multiply(rotation(Math.PI / 2), translation(10, 0))
    const p = apply(m, 0, 0)
    near(p.x, 0)
    near(p.y, 10)
  })

  it('is not commutative, so the order above is load-bearing', () => {
    const other = apply(multiply(translation(10, 0), rotation(Math.PI / 2)), 0, 0)
    near(other.x, 10)
    near(other.y, 0)
  })

  it('leaves a point alone under identity', () => {
    const p = apply(IDENTITY, 3, 7)
    expect(p).toEqual({ x: 3, y: 7 })
  })
})

describe('invert', () => {
  it('undoes a transform built from every part a node has', () => {
    const m = compose(translation(120, -40), rotation(0.7), scaling(2, 2), squashMatrix(0.3, 1.6))
    sameMatrix(multiply(m, invert(m)), IDENTITY)
    sameMatrix(multiply(invert(m), m), IDENTITY)
  })

  it('refuses a transform that has collapsed', () => {
    expect(() => invert(scaling(0, 1))).toThrow()
  })
})

describe('squash', () => {
  it('keeps area, so a crush changes shape and never size', () => {
    for (const [angle, factor] of [
      [0, 2],
      [0.4, 1.3],
      [-1.1, 3],
    ]) {
      near(
        squashMatrix(angle!, factor!).a * squashMatrix(angle!, factor!).d -
          squashMatrix(angle!, factor!).b * squashMatrix(angle!, factor!).c,
        1,
      )
    }
  })

  it('squeezes along its own axis and stretches across it', () => {
    // Axis zero squeezes x by the factor and stretches y to match.
    const m = squashMatrix(0, 2)
    near(apply(m, 1, 0).x, 2)
    near(apply(m, 0, 1).y, 0.5)
  })
})

describe('decompose', () => {
  const cases: Array<[string, Mat]> = [
    ['nothing at all', IDENTITY],
    ['a move', translation(30, -12)],
    ['a turn', rotation(0.9)],
    ['a size', scaling(2.5, 2.5)],
    ['a squash', squashMatrix(0.4, 1.8)],
    ['a mirror', scaling(-1, 1)],
    ['move and turn', compose(translation(5, 6), rotation(-0.3))],
    ['turn and size', compose(rotation(1.2), scaling(0.4, 0.4))],
    ['size and squash', compose(scaling(3, 3), squashMatrix(-0.8, 2.2))],
    [
      'everything',
      compose(translation(-70, 40), rotation(2.1), scaling(1.7, 1.7), squashMatrix(0.55, 1.4)),
    ],
    [
      'everything, mirrored',
      compose(
        translation(9, -3),
        rotation(0.25),
        scaling(-1.3, 1.3),
        squashMatrix(-0.2, 2.6),
      ),
    ],
  ]

  it.each(cases)('rebuilds %s exactly as it was', (_name, m) => {
    sameMatrix(recompose(decompose(m)), m)
  })

  it('round-trips transforms it has never seen', () => {
    // Deterministic pseudo-random, so a failure is reproducible.
    let seed = 12345
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let i = 0; i < 500; i++) {
      const m = compose(
        translation(next() * 400 - 200, next() * 400 - 200),
        rotation(next() * Math.PI * 4 - Math.PI * 2),
        scaling(0.2 + next() * 3, 0.2 + next() * 3),
        squashMatrix(next() * Math.PI * 2, 0.3 + next() * 3),
      )
      sameMatrix(recompose(decompose(m)), m, 1e-7)
    }
  })

  it('reports no squash for a transform that has no shape change in it', () => {
    expect(decompose(compose(translation(4, 5), rotation(0.6), scaling(2, 2))).squash).toBeUndefined()
  })

  it('reports a mirror only when one is present', () => {
    expect(decompose(rotation(3)).flipX).toBe(false)
    expect(decompose(compose(rotation(3), scaling(-2, 2))).flipX).toBe(true)
  })
})
