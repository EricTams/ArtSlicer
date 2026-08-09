import { describe, expect, it } from 'vitest'

import { type Point, clipPolygon, clipToHalfPlane, cutFromLine, invertCut } from './clip'

/** Shoelace area — a stable way to assert on a polygon's shape. */
function area(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

describe('clipPolygon', () => {
  it('returns the full rectangle when there are no cuts', () => {
    expect(area(clipPolygon(100, 50, undefined))).toBeCloseTo(5000)
    expect(area(clipPolygon(100, 50, []))).toBeCloseTo(5000)
  })

  it('halves the area for a cut straight down the middle', () => {
    // Keep x <= 0.
    const half = clipPolygon(100, 100, [{ nx: 1, ny: 0, d: 0 }])
    expect(area(half)).toBeCloseTo(5000)
  })

  it('composes multiple cuts into a quarter', () => {
    const quarter = clipPolygon(100, 100, [
      { nx: 1, ny: 0, d: 0 },
      { nx: 0, ny: 1, d: 0 },
    ])
    expect(area(quarter)).toBeCloseTo(2500)
  })

  it('produces a triangle for a diagonal cut through two corners', () => {
    const tri = clipPolygon(100, 100, [{ nx: 1, ny: 1, d: 0 }])
    expect(area(tri)).toBeCloseTo(5000)
    expect(tri).toHaveLength(3)
  })

  it('returns nothing when a cut removes the whole piece', () => {
    expect(clipPolygon(100, 100, [{ nx: 1, ny: 0, d: -500 }])).toEqual([])
  })

  it('keeps the whole piece when a cut misses it entirely', () => {
    expect(area(clipPolygon(100, 100, [{ nx: 1, ny: 0, d: 500 }]))).toBeCloseTo(10000)
  })

  it('stays empty once a later cut removes everything', () => {
    const result = clipPolygon(100, 100, [
      { nx: 1, ny: 0, d: 0 },
      { nx: -1, ny: 0, d: -500 },
    ])
    expect(result).toEqual([])
  })
})

describe('clipToHalfPlane', () => {
  it('is a no-op on an already-empty polygon', () => {
    expect(clipToHalfPlane([], { nx: 1, ny: 0, d: 0 })).toEqual([])
  })

  it('keeps points exactly on the boundary', () => {
    const square: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    // Boundary at x = 10 keeps the whole square.
    expect(area(clipToHalfPlane(square, { nx: 1, ny: 0, d: 10 }))).toBeCloseTo(100)
  })
})

describe('cutFromLine', () => {
  it('rejects a drag too short to imply a direction', () => {
    expect(cutFromLine({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull()
  })

  it('produces a unit normal', () => {
    const cut = cutFromLine({ x: 0, y: 0 }, { x: 3, y: 4 })!
    expect(Math.hypot(cut.nx, cut.ny)).toBeCloseTo(1)
  })

  it('discards the side the drag started on and keeps the other', () => {
    // Drag upward along x = 0: the kept half-plane is one side of that line.
    const cut = cutFromLine({ x: 0, y: -10 }, { x: 0, y: 10 })!
    const kept = clipPolygon(100, 100, [cut])
    expect(area(kept)).toBeCloseTo(5000)

    // Inverting keeps the complementary half, and the two together are whole.
    const other = clipPolygon(100, 100, [invertCut(cut)])
    expect(area(kept) + area(other)).toBeCloseTo(10000)
  })

  it('handles a diagonal drag', () => {
    const cut = cutFromLine({ x: -50, y: -50 }, { x: 50, y: 50 })!
    expect(area(clipPolygon(100, 100, [cut]))).toBeCloseTo(5000)
  })
})
