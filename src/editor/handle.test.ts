import { describe, expect, it } from 'vitest'

import { HANDLE_HIT_RADIUS, handlePosition, isOnHandle } from './handle'
import { makeCombo, reachOf } from './combo'
import type { Placed, SceneNode } from '../shared/scene'

const piece = (over: Partial<Placed> = {}): Placed => ({
  id: 'p',
  pieceId: 'argyle-sock',
  x: 500,
  y: 500,
  scale: 1,
  rotation: 0,
  z: 0,
  ...over,
})

/** How far the handle ends up from the thing it belongs to. */
const span = (node: SceneNode): number => {
  const handle = handlePosition(node)
  return Math.hypot(handle.x - node.x, handle.y - node.y)
}

describe('the transform handle', () => {
  it('sits outside a single piece', () => {
    const node = piece()
    expect(span(node)).toBeGreaterThan(reachOf(node) * node.scale)
  })

  it('sits outside a combo, which reaches much further than a piece', () => {
    const combo = makeCombo([piece({ id: 'a', x: 300 }), piece({ id: 'b', x: 700 })], 'c')
    expect(span(combo)).toBeGreaterThan(reachOf(combo) * combo.scale)
  })

  it('moves out with a combo, rather than staying where a sprite would want it', () => {
    const one = piece()
    const combo = makeCombo([piece({ id: 'a', x: 300 }), piece({ id: 'b', x: 700 })], 'c')
    expect(span(combo)).toBeGreaterThan(span(one) + 50)
  })

  it('keeps its grab zone off the middle of a combo', () => {
    /*
     * The bug this is for. A press is tested against the handle before it is
     * tested against the artwork, so a handle parked inside a combo turns
     * dragging it into resizing it — from anywhere in a wide band across the
     * middle.
     */
    const combo = makeCombo([piece({ id: 'a', x: 300 }), piece({ id: 'b', x: 700 })], 'c')
    expect(isOnHandle(combo, combo.x, combo.y)).toBe(false)

    // Nor anywhere else a finger would land meaning to move it.
    const nearby: Array<[number, number]> = [[-120, 0], [120, 0], [0, -80], [0, 80], [90, -60]]
    for (const [dx, dy] of nearby) {
      expect(isOnHandle(combo, combo.x + dx, combo.y + dy)).toBe(false)
    }
  })

  it('is still reachable, sitting just past where the art stops', () => {
    const combo = makeCombo([piece({ id: 'a', x: 300 }), piece({ id: 'b', x: 700 })], 'c')
    const handle = handlePosition(combo)
    expect(isOnHandle(combo, handle.x, handle.y)).toBe(true)
    expect(span(combo)).toBeLessThan(reachOf(combo) * combo.scale + HANDLE_HIT_RADIUS)
  })

  it('follows a piece that has been made bigger', () => {
    expect(span(piece({ scale: 2 }))).toBeGreaterThan(span(piece({ scale: 1 })))
  })
})
