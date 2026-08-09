import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Capturing a pointer can throw — the pointer may already be gone by the time
 * the handler runs, and some synthetic events carry ids that were never live.
 * Losing capture degrades a gesture; an exception breaks the whole handler, so
 * it is never worth propagating.
 */
export function capturePointer(event: ReactPointerEvent<Element>): void {
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // The gesture still works while the pointer stays over the element.
  }
}
