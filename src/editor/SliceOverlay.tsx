import { Line } from 'react-konva'

import { DESIGN_SIZE } from '../shared/scene'
import type { Point } from '../render/clip'

interface Props {
  from: Point
  to: Point
}

/**
 * The guide line drawn while a slice is being dragged. Extended well past the
 * drag so it reads as an infinite cutting line rather than a short stroke —
 * the cut is a half-plane, and the guide should look like one.
 */
export function SliceOverlay({ from, to }: Props) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return null

  const ux = (dx / length) * DESIGN_SIZE * 2
  const uy = (dy / length) * DESIGN_SIZE * 2

  return (
    <>
      <Line
        points={[from.x - ux, from.y - uy, to.x + ux, to.y + uy]}
        stroke="#ff4d8d"
        strokeWidth={4}
        dash={[16, 12]}
        listening={false}
      />
      {/* Marks the side being discarded, so the gesture is unambiguous. */}
      <Line
        points={[from.x, from.y, to.x, to.y]}
        stroke="#ffffff"
        strokeWidth={2}
        listening={false}
      />
    </>
  )
}
