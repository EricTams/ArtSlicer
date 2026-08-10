import type { Cut } from '../shared/scene'

export interface Point {
  x: number
  y: number
}

/**
 * Slicing is implemented as convex clipping: start from the piece's rectangle
 * and trim it against each cut's half-plane in turn. Because every cut is a
 * half-plane, the result is always convex, so a compact Sutherland-Hodgman
 * pass is exact rather than an approximation.
 */
export function clipPolygon(width: number, height: number, cuts: Cut[] | undefined): Point[] {
  // Local space is centred on the piece so rotation and flipping behave.
  const hw = width / 2
  const hh = height / 2
  let polygon: Point[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]

  if (!cuts?.length) return polygon

  for (const cut of cuts) {
    polygon = clipToHalfPlane(polygon, cut)
    // Cut everything away: nothing left to trim, and nothing to draw.
    if (polygon.length === 0) return []
  }

  return polygon
}

/** Keeps the portion of `polygon` where `nx * x + ny * y <= d`. */
export function clipToHalfPlane(polygon: Point[], cut: Cut): Point[] {
  if (polygon.length === 0) return polygon

  const output: Point[] = []
  const distance = (p: Point): number => cut.nx * p.x + cut.ny * p.y - cut.d

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!
    const next = polygon[(i + 1) % polygon.length]!
    const dCurrent = distance(current)
    const dNext = distance(next)

    const currentInside = dCurrent <= 0
    const nextInside = dNext <= 0

    if (currentInside) output.push(current)

    // Crossing the boundary: add the exact intersection point so the cut edge
    // is straight rather than stair-stepped.
    if (currentInside !== nextInside) {
      const t = dCurrent / (dCurrent - dNext)
      output.push({
        x: current.x + t * (next.x - current.x),
        y: current.y + t * (next.y - current.y),
      })
    }
  }

  return dedupe(output)
}

/**
 * A cut passing exactly through a corner emits that corner twice — once as an
 * inside point and once as the intersection. Harmless to draw, but duplicates
 * compound with each successive cut, so drop them here.
 */
function dedupe(points: Point[]): Point[] {
  if (points.length < 2) return points

  const result: Point[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (!previous || !samePoint(previous, point)) result.push(point)
  }

  // The first and last can also coincide once the ring closes.
  while (result.length > 1 && samePoint(result[0]!, result[result.length - 1]!)) {
    result.pop()
  }
  return result
}

const EPSILON = 1e-9

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

/**
 * Turns a drag across the piece into a cut that discards the side the drag
 * started on, in the piece's local (unrotated, unscaled) space.
 */
export function cutFromLine(from: Point, to: Point): Cut | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  // Too short to imply a direction — treat as a stray tap, not a slice.
  if (length < 1e-3) return null

  // Left-hand normal of the drag direction, normalised.
  const nx = -dy / length
  const ny = dx / length
  return { nx, ny, d: nx * from.x + ny * from.y }
}

/**
 * Area-weighted centre of a convex polygon — where a cut-down piece actually
 * balances, which is where it should turn and crush about.
 */
export function polygonCentroid(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }

  let twiceArea = 0
  let x = 0
  let y = 0

  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const cross = a.x * b.y - b.x * a.y
    twiceArea += cross
    x += (a.x + b.x) * cross
    y += (a.y + b.y) * cross
  }

  // A degenerate sliver has no area to weight by; fall back to the mean.
  if (Math.abs(twiceArea) < 1e-9) {
    const mean = points.reduce((sum, p) => ({ x: sum.x + p.x, y: sum.y + p.y }), { x: 0, y: 0 })
    return { x: mean.x / points.length, y: mean.y / points.length }
  }

  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) }
}

/** Flips which side of a cut is kept. */
export function invertCut(cut: Cut): Cut {
  return { nx: -cut.nx, ny: -cut.ny, d: -cut.d }
}
