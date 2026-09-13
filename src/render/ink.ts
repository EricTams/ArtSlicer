import type { Cut } from '../shared/scene'
import type { Point } from './clip'
import { getPiece } from './pieces'

/** Matches the grid the manifest was built with. */
const GRID = 16

const cache = new Map<string, Point[]>()

/**
 * The places a sprite actually has art, as points in its own coordinates.
 *
 * One per occupied cell of the manifest's grid, at the cell's middle. Coarse,
 * and deliberately so: this answers questions about whether there is anything
 * in a region, not what it looks like, and the sprite itself is already the
 * answer to the second one.
 */
export function inkPoints(pieceId: string): Point[] {
  const cached = cache.get(pieceId)
  if (cached) return cached

  const def = getPiece(pieceId)
  const points: Point[] = []
  if (def) {
    const bytes = decode(def.mask)
    const cellW = def.width / GRID
    const cellH = def.height / GRID
    for (let index = 0; index < GRID * GRID; index++) {
      if (!(bytes[index >> 3]! & (1 << (index & 7)))) continue
      const cellX = index % GRID
      const cellY = Math.floor(index / GRID)
      points.push({
        // Sprite-local: the middle of the sprite is the origin.
        x: (cellX + 0.5) * cellW - def.width / 2,
        y: (cellY + 0.5) * cellH - def.height / 2,
      })
    }
  }

  cache.set(pieceId, points)
  return points
}

/** Whether a point survives every cut, the same test the clipper applies. */
export function kept(cuts: Cut[] | undefined, point: Point): boolean {
  if (!cuts?.length) return true
  return cuts.every((cut) => cut.nx * point.x + cut.ny * point.y <= cut.d)
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
