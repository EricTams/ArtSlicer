import { describe, expect, it } from 'vitest'

import type { Placed } from '../shared/scene'
import { IDENTITY, apply, invert, multiply, pieceMatrix, rotation, scaling } from './transform'

function piece(overrides: Partial<Placed> = {}): Placed {
  return { id: 'a', pieceId: 'disc', x: 0, y: 0, scale: 1, rotation: 0, z: 1, ...overrides }
}

describe('matrix basics', () => {
  it('rotates a quarter turn', () => {
    const p = apply(rotation(Math.PI / 2), { x: 1, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })

  it('applies the second argument first', () => {
    // Scale then rotate: (2,0) → (2,0) → (0,2).
    const m = multiply(rotation(Math.PI / 2), scaling(2, 2))
    const p = apply(m, { x: 1, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(2)
  })

  it('inverts back to where it started', () => {
    const m = multiply(rotation(0.7), scaling(2, 0.5))
    const back = invert(m)!
    const p = apply(back, apply(m, { x: 3, y: -4 }))
    expect(p.x).toBeCloseTo(3)
    expect(p.y).toBeCloseTo(-4)
  })

  it('refuses to invert a collapsed transform', () => {
    expect(invert(scaling(0, 1))).toBeNull()
  })

  it('leaves points alone under identity', () => {
    expect(apply(IDENTITY, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 })
  })
})

describe('pieceMatrix', () => {
  it('is identity for an untouched piece', () => {
    const p = apply(pieceMatrix(piece()), { x: 10, y: 20 })
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(20)
  })

  it('mirrors along x when flipped', () => {
    const p = apply(pieceMatrix(piece({ flipX: true })), { x: 10, y: 20 })
    expect(p.x).toBeCloseTo(-10)
    expect(p.y).toBeCloseTo(20)
  })

  it('squeezes along the crush axis and stretches across it', () => {
    // Crushing along y (angle 0 means the scale acts on y).
    const m = pieceMatrix(piece({ squashes: [{ angle: 0, factor: 4 }] }))
    const down = apply(m, { x: 0, y: 100 })
    const across = apply(m, { x: 100, y: 0 })

    expect(Math.abs(down.y)).toBeCloseTo(25) // 100 / 4
    expect(Math.abs(across.x)).toBeCloseTo(200) // 100 * sqrt(4)
  })

  it('crushes along a diagonal axis, which no axis-aligned scale could do', () => {
    const m = pieceMatrix(piece({ squashes: [{ angle: Math.PI / 4, factor: 3 }] }))

    // Angle 0 crushes vertically, so at 45° the crush axis is (0,1) turned by
    // 45° — pointing up-left.
    const onAxis = apply(m, { x: -70.71, y: 70.71 })
    expect(Math.hypot(onAxis.x, onAxis.y)).toBeCloseTo(100 / 3, 1)

    // Perpendicular to it, the piece stretches.
    const offAxis = apply(m, { x: 70.71, y: 70.71 })
    expect(Math.hypot(offAxis.x, offAxis.y)).toBeCloseTo(100 * Math.sqrt(3), 1)
  })

  it('is invertible after scale, rotation and several squashes', () => {
    const subject = piece({
      scale: 1.7,
      rotation: 0.9,
      flipX: true,
      squashes: [
        { angle: 0.3, factor: 2 },
        { angle: -1.1, factor: 1.6 },
      ],
    })
    const m = pieceMatrix(subject)
    const back = invert(m)!

    const original = { x: 42, y: -17 }
    const round = apply(back, apply(m, original))
    expect(round.x).toBeCloseTo(original.x)
    expect(round.y).toBeCloseTo(original.y)
  })

  it('honours a rotation override, which tools use while previewing', () => {
    const m = pieceMatrix(piece({ rotation: 0 }), Math.PI / 2)
    const p = apply(m, { x: 10, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })
})
