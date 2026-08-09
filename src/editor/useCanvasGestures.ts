import { useEffect, useRef } from 'react'

import { DESIGN_SIZE, type Placed } from '../shared/scene'
import { isOnHandle } from './handle'

interface Gesture {
  onMove(id: string, x: number, y: number): void
  onTransform(id: string, scale: number, rotation: number): void
  onTap(id: string): void
  onTapEmpty(): void
}

interface Anchor {
  /** Pointer position when this leg of the gesture began, in client pixels. */
  clientX: number
  clientY: number
  /** The piece's transform at that moment. */
  x: number
  y: number
  scale: number
  rotation: number
}

type Mode = 'move' | 'handle'

/**
 * Drag to move, pinch to scale and rotate, drag the handle to do the same with
 * one pointer, tap to open the tools.
 *
 * Everything is measured from an anchor taken when the gesture — or that leg of
 * it — began, never from the previous event. Accumulating frame deltas onto a
 * transform captured at pointerdown looks right for a coarse synthetic drag and
 * fails completely for a real one, where a hundred small moves each get applied
 * to the same stale starting point.
 */
export function useCanvasGestures(
  element: HTMLDivElement | null,
  size: number,
  pieceAt: (x: number, y: number) => Placed | null,
  selectedPiece: () => Placed | null,
  handlers: Gesture,
): void {
  // Held in a ref so the listeners, attached once, always see current state.
  const latest = useRef({ size, pieceAt, selectedPiece, handlers })
  latest.current = { size, pieceAt, selectedPiece, handlers }

  useEffect(() => {
    if (!element) return

    const pointers = new Map<number, { x: number; y: number }>()
    let target: Placed | null = null
    let mode: Mode = 'move'
    let moved = false
    let anchor: Anchor | null = null
    /** Set while two pointers are down; cleared when either lifts. */
    let pinch: { distance: number; angle: number } | null = null

    /**
     * Measured against the drawing surface, not its container. The stage is a
     * square centred in whatever space is available, so on a wide screen the
     * container starts hundreds of pixels to its left — using the container's
     * edge puts every pointer position far from where it actually landed, and
     * only on a phone, where the two nearly coincide, does it look correct.
     */
    const toScene = (clientX: number, clientY: number): { x: number; y: number } => {
      const surface = element.querySelector('canvas')
      const rect = (surface ?? element).getBoundingClientRect()
      const scale = DESIGN_SIZE / latest.current.size
      return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }
    }

    /** Re-reads the piece, so each leg starts from where it actually is now. */
    const anchorTo = (piece: Placed, clientX: number, clientY: number): void => {
      target = piece
      anchor = {
        clientX,
        clientY,
        x: piece.x,
        y: piece.y,
        scale: piece.scale,
        rotation: piece.rotation,
      }
    }

    const current = (): Placed | null => {
      if (!target) return null
      // The stored object is a snapshot; find the live one by id.
      return latest.current.selectedPiece()?.id === target.id
        ? latest.current.selectedPiece()
        : target
    }

    const onDown = (event: PointerEvent): void => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pointers.size === 1) {
        const point = toScene(event.clientX, event.clientY)
        const selected = latest.current.selectedPiece()
        moved = false

        // The handle sits outside the piece, so it is checked first — it would
        // otherwise be unreachable whenever it overlapped something.
        if (selected && isOnHandle(selected, point.x, point.y)) {
          mode = 'handle'
          anchorTo(selected, event.clientX, event.clientY)
        } else {
          mode = 'move'
          const hit = latest.current.pieceAt(point.x, point.y)
          if (hit) anchorTo(hit, event.clientX, event.clientY)
          else {
            target = null
            anchor = null
          }
        }

        element.setPointerCapture(event.pointerId)
        return
      }

      if (pointers.size === 2) {
        const live = current()
        if (!live) return
        // Re-anchor: the pinch is measured from the moment the second finger
        // lands, not from wherever the first one started.
        const [a, b] = [...pointers.values()]
        pinch = {
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
        }
        anchorTo(live, a!.x, a!.y)
      }
    }

    const onMove = (event: PointerEvent): void => {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!target || !anchor) return

      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x)
        moved = true
        latest.current.handlers.onTransform(
          target.id,
          anchor.scale * (distance / pinch.distance),
          anchor.rotation + (angle - pinch.angle),
        )
        return
      }

      const travel = Math.hypot(event.clientX - anchor.clientX, event.clientY - anchor.clientY)
      // A few pixels of shake while tapping should not count as a drag.
      if (travel > 4) moved = true

      if (mode === 'handle') {
        // Same maths as a pinch, with the piece's centre standing in for the
        // second finger.
        const centre = { x: anchor.x, y: anchor.y }
        const from = toScene(anchor.clientX, anchor.clientY)
        const to = toScene(event.clientX, event.clientY)

        const startDistance = Math.hypot(from.x - centre.x, from.y - centre.y)
        const distance = Math.hypot(to.x - centre.x, to.y - centre.y)
        if (startDistance < 1) return

        const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x)
        const angle = Math.atan2(to.y - centre.y, to.x - centre.x)

        latest.current.handlers.onTransform(
          target.id,
          anchor.scale * (distance / startDistance),
          anchor.rotation + (angle - startAngle),
        )
        return
      }

      const scale = DESIGN_SIZE / latest.current.size
      latest.current.handlers.onMove(
        target.id,
        anchor.x + (event.clientX - anchor.clientX) * scale,
        anchor.y + (event.clientY - anchor.clientY) * scale,
      )
    }

    const onUp = (event: PointerEvent): void => {
      pointers.delete(event.pointerId)

      if (pointers.size === 1) {
        // Dropped from a pinch back to one finger: re-anchor so the remaining
        // finger doesn't jump the piece by however far it has already moved.
        pinch = null
        const live = current()
        const [remaining] = [...pointers.values()]
        if (live && remaining) anchorTo(live, remaining.x, remaining.y)
        return
      }
      if (pointers.size > 0) return

      // A press that never moved is a tap: open the tools for that piece, or
      // clear the selection when it lands on bare canvas.
      if (!moved) {
        if (target && mode === 'move') latest.current.handlers.onTap(target.id)
        else if (!target) latest.current.handlers.onTapEmpty()
      }
      target = null
      anchor = null
      pinch = null
    }

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)

    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
    }
    // Keyed on the element, so listeners follow it if React ever swaps the
    // node rather than staying bound to a detached one.
  }, [element])
}
