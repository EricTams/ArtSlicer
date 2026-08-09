import { describe, expect, it } from 'vitest'

import { apply, multiply, rotation, squashMatrix } from '../render/transform'
import { crushAngle, squeezeFactor } from './squish'

const FACTOR = 4

/**
 * How the piece's *on-screen* shape is deformed by a squash.
 *
 * The uniform scale cancels out either side of the squash, so what's left is
 * the crush conjugated by however far the piece is turned. This is the thing
 * the player actually sees, and the thing the gesture has to line up with.
 */
function screenDeform(pieceRotation: number, screenAngle: number) {
  const stored = crushAngle(screenAngle, pieceRotation)
  return multiply(
    rotation(pieceRotation),
    multiply(squashMatrix({ angle: stored, factor: FACTOR }), rotation(-pieceRotation)),
  )
}

/** Length of a 100-unit screen vector pointing `probe`, after the crush. */
function lengthAfter(pieceRotation: number, screenAngle: number, probe: number): number {
  const m = screenDeform(pieceRotation, screenAngle)
  const v = apply(m, { x: Math.cos(probe) * 100, y: Math.sin(probe) * 100 })
  return Math.hypot(v.x, v.y)
}

describe('crushAngle', () => {
  it('squeezes along the direction the player swung', () => {
    for (const swing of [0, Math.PI / 4, Math.PI / 2, 2.2, -1.7]) {
      expect(lengthAfter(0, swing, swing)).toBeCloseTo(100 / FACTOR, 1)
    }
  })

  it('still squeezes along the swing when the piece is turned', () => {
    for (const pieceRotation of [0.4, 1.2, -2.5, Math.PI]) {
      for (const swing of [0, 0.9, 2.2, -1.7]) {
        expect(lengthAfter(pieceRotation, swing, swing)).toBeCloseTo(100 / FACTOR, 1)
      }
    }
  })

  it('stretches across the swing rather than along it', () => {
    const pieceRotation = 0.7
    const swing = Math.PI / 3
    const across = lengthAfter(pieceRotation, swing, swing + Math.PI / 2)
    expect(across).toBeCloseTo(100 * Math.sqrt(FACTOR), 1)
  })

  it('matches the stored convention: a vertical swing on an upright piece is angle 0', () => {
    expect(crushAngle(Math.PI / 2, 0)).toBeCloseTo(0)
  })
})

describe('squeezeFactor', () => {
  it('does nothing for a swing that never closed', () => {
    expect(squeezeFactor(0, 1)).toBe(1)
  })

  it('rewards a fast swing over a slow one', () => {
    expect(squeezeFactor(1, 0)).toBeCloseTo(1.2)
    expect(squeezeFactor(1, 1)).toBeCloseTo(1.7)
  })

  it('keeps one squeeze modest, so extremes take repeats', () => {
    // Four hard swings compound past 8x; one alone barely registers.
    expect(squeezeFactor(1, 1) ** 4).toBeGreaterThan(8)
    expect(squeezeFactor(1, 1)).toBeLessThan(2)
  })

  it('clamps nonsense input rather than producing a negative crush', () => {
    expect(squeezeFactor(-5, 5)).toBe(1)
    expect(squeezeFactor(5, 5)).toBeCloseTo(1.7)
  })
})
