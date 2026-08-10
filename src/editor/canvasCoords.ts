import { DESIGN_SIZE } from '../shared/scene'

/**
 * Pointer positions in client pixels, turned into scene coordinates.
 *
 * Measured against the drawing surface, not its container. The stage is a
 * square centred in whatever space is available, so on a wide screen the
 * container starts hundreds of pixels to its left — using the container's edge
 * puts every pointer position far from where it actually landed, and only on a
 * phone, where the two nearly coincide, does it look correct.
 */
export function surfaceRect(element: HTMLElement): DOMRect {
  return (element.querySelector('canvas') ?? element).getBoundingClientRect()
}

export function toScene(
  element: HTMLElement,
  size: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = surfaceRect(element)
  const scale = DESIGN_SIZE / size
  return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale }
}

/** Whether a pointer is over the drawing surface itself, used to accept a drop. */
export function isOverCanvas(element: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = surfaceRect(element)
  return (
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  )
}
