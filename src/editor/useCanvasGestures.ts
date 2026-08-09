import { type RefObject, useEffect, useRef } from 'react'

import { DESIGN_SIZE, type Placed } from '../shared/scene'

interface Gesture {
  onMove(id: string, x: number, y: number): void
  onTransform(id: string, scale: number, rotation: number): void
  onTap(id: string): void
  onTapEmpty(): void
}

/**
 * Drag to move, pinch to scale and rotate, tap to open the tools.
 *
 * Written against raw pointer events rather than Konva's drag support because
 * two-finger gestures need both pointers at once, and because a tap has to be
 * distinguishable from the start of a drag.
 */
export function useCanvasGestures(
  ref: RefObject<HTMLDivElement | null>,
  size: number,
  pieceAt: (x: number, y: number) => Placed | null,
  handlers: Gesture,
): void {
  // Held in a ref so the listeners, attached once, always see current state.
  const latest = useRef({ size, pieceAt, handlers })
  latest.current = { size, pieceAt, handlers }

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const pointers = new Map<number, { x: number; y: number }>()
    let target: Placed | null = null
    let moved = false
    /** The piece's transform when the current gesture began. */
    let origin: { x: number; y: number; scale: number; rotation: number } | null = null
    let pinchStart: { distance: number; angle: number } | null = null

    const designScale = (): number => DESIGN_SIZE / latest.current.size

    const toDesign = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = element.getBoundingClientRect()
      const scale = designScale()
      return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }
    }

    const onDown = (event: PointerEvent): void => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pointers.size === 1) {
        const point = toDesign(event.clientX, event.clientY)
        target = latest.current.pieceAt(point.x, point.y)
        moved = false
        origin = target
          ? { x: target.x, y: target.y, scale: target.scale, rotation: target.rotation }
          : null
        element.setPointerCapture(event.pointerId)
        return
      }

      if (pointers.size === 2 && target) {
        // Re-anchor: the pinch is measured from the moment the second finger
        // lands, not from wherever the first one started.
        const [a, b] = [...pointers.values()]
        pinchStart = {
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
        }
        origin = { x: target.x, y: target.y, scale: target.scale, rotation: target.rotation }
      }
    }

    const onMove = (event: PointerEvent): void => {
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (!target || !origin) return

      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x)
        moved = true
        latest.current.handlers.onTransform(
          target.id,
          origin.scale * (distance / pinchStart.distance),
          origin.rotation + (angle - pinchStart.angle),
        )
        return
      }

      const scale = designScale()
      const dx = (event.clientX - previous.x) * scale
      const dy = (event.clientY - previous.y) * scale
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true
      latest.current.handlers.onMove(target.id, target.x + dx, target.y + dy)
    }

    const onUp = (event: PointerEvent): void => {
      pointers.delete(event.pointerId)
      if (pointers.size > 0) {
        pinchStart = null
        return
      }

      // A press that never moved is a tap: open the tools for that piece, or
      // clear the selection when it lands on bare canvas.
      if (!moved) {
        if (target) latest.current.handlers.onTap(target.id)
        else latest.current.handlers.onTapEmpty()
      }
      target = null
      origin = null
      pinchStart = null
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
  }, [ref])
}
