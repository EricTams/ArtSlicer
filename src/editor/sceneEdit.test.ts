import { describe, expect, it } from 'vitest'

import { apply, pieceMatrix } from '../render/transform'
import {
  MAX_CUTS_PER_PIECE,
  MAX_PIECES,
  MAX_SQUASH,
  MAX_SQUASHES_PER_PIECE,
  MAX_SCALE,
  MIN_SCALE,
  type Placed,
  type Scene,
  emptyScene,
} from '../shared/scene'
import {
  type History,
  MAX_HISTORY,
  addPiece,
  addSquash,
  bringToFront,
  canRestack,
  canUndo,
  clearSquashes,
  clearTint,
  flipPiece,
  pushHistory,
  removePiece,
  restackPiece,
  sendToBack,
  splitPiece,
  sprayPiece,
  transformPiece,
  undo,
  updatePiece,
} from './sceneEdit'

const CUT = { nx: 1, ny: 0, d: 0 }
const SQUASH = { angle: 0, factor: 2 }
/** How far splitPiece pushes the halves apart, per unit of scale. */
const NUDGE = 45

/**
 * Where the sprite's own centre lands in the scene. Invariant under
 * recentring: only the nudge should move it.
 */
function spriteOrigin(piece: Placed): { x: number; y: number } {
  const pivot = piece.pivot ?? { x: 0, y: 0 }
  const offset = apply(pieceMatrix(piece), { x: -pivot.x, y: -pivot.y })
  return { x: piece.x + offset.x, y: piece.y + offset.y }
}

function withPiece(id = 'a'): Scene {
  return addPiece(emptyScene(), 'pom-pom', id)
}

describe('addPiece', () => {
  it('stacks each new piece above the last', () => {
    let scene = withPiece('a')
    scene = addPiece(scene, 'toaster', 'b')
    expect(scene.pieces[1]!.z).toBeGreaterThan(scene.pieces[0]!.z)
  })

  it('refuses to exceed the piece cap', () => {
    let scene = emptyScene()
    for (let i = 0; i < MAX_PIECES; i++) scene = addPiece(scene, 'pom-pom', `p${i}`)

    const full = addPiece(scene, 'pom-pom', 'overflow')
    expect(full).toBe(scene)
  })
})

describe('layering', () => {
  it('brings a buried piece to the front', () => {
    let scene = addPiece(withPiece('a'), 'toaster', 'b')
    scene = bringToFront(scene, 'a')
    expect(scene.pieces.find((p) => p.id === 'a')!.z).toBeGreaterThan(
      scene.pieces.find((p) => p.id === 'b')!.z,
    )
  })

  it('sends a piece behind everything', () => {
    let scene = addPiece(withPiece('a'), 'toaster', 'b')
    scene = sendToBack(scene, 'b')
    expect(scene.pieces.find((p) => p.id === 'b')!.z).toBeLessThan(
      scene.pieces.find((p) => p.id === 'a')!.z,
    )
  })
})

describe('restackPiece', () => {
  /** Three pieces, back to front: a, b, c. */
  function stacked(): Scene {
    return addPiece(addPiece(withPiece('a'), 'toaster', 'b'), 'candy-cane', 'c')
  }

  function order(scene: Scene): string[] {
    return [...scene.pieces].sort((x, y) => x.z - y.z).map((piece) => piece.id)
  }

  it('moves a piece one step towards the front', () => {
    expect(order(restackPiece(stacked(), 'a', 1))).toEqual(['b', 'a', 'c'])
  })

  it('moves a piece one step towards the back', () => {
    expect(order(restackPiece(stacked(), 'c', -1))).toEqual(['a', 'c', 'b'])
  })

  it('leaves the piece at the end of the stack where it is', () => {
    const scene = stacked()
    expect(order(restackPiece(scene, 'c', 1))).toEqual(['a', 'b', 'c'])
    expect(order(restackPiece(scene, 'a', -1))).toEqual(['a', 'b', 'c'])
  })

  // Equal z values are reachable through a clamped submission, and swapping
  // them would be a no-op that reads to the player as a dead button.
  it('still moves a piece whose neighbour shares its z', () => {
    const scene = stacked()
    const tied: Scene = { ...scene, pieces: scene.pieces.map((piece) => ({ ...piece, z: 3 })) }
    expect(order(restackPiece(tied, 'a', 1))[1]).toBe('a')
  })

  it('knows when there is nowhere left to go', () => {
    const scene = stacked()
    expect(canRestack(scene, 'c', 1)).toBe(false)
    expect(canRestack(scene, 'c', -1)).toBe(true)
    expect(canRestack(scene, 'a', -1)).toBe(false)
    expect(canRestack(scene, 'a', 1)).toBe(true)
  })

  it('has nowhere to go with a single piece', () => {
    expect(canRestack(withPiece(), 'a', 1)).toBe(false)
    expect(canRestack(withPiece(), 'a', -1)).toBe(false)
  })
})

describe('transformPiece', () => {
  it('applies scale and rotation together, as a pinch produces them', () => {
    const scene = transformPiece(withPiece(), 'a', 2, 1.5)
    expect(scene.pieces[0]!.scale).toBe(2)
    expect(scene.pieces[0]!.rotation).toBe(1.5)
  })

  it('clamps scale so a piece can neither vanish nor swallow the canvas', () => {
    expect(transformPiece(withPiece(), 'a', 99, 0).pieces[0]!.scale).toBe(MAX_SCALE)
    expect(transformPiece(withPiece(), 'a', 0.0001, 0).pieces[0]!.scale).toBe(MIN_SCALE)
  })
})

describe('spraying paint', () => {
  it('lays down the mixed colour at the strength sprayed', () => {
    const scene = sprayPiece(withPiece(), 'a', '#ff0000', 0.4)
    expect(scene.pieces[0]!.tint).toEqual({ color: '#ff0000', amount: 0.4 })
  })

  it('builds up with repeated sprays of the same colour', () => {
    let scene = sprayPiece(withPiece(), 'a', '#ff0000', 0.3)
    scene = sprayPiece(scene, 'a', '#ff0000', 0.3)
    expect(scene.pieces[0]!.tint!.amount).toBeCloseTo(0.6)
    expect(scene.pieces[0]!.tint!.color).toBe('#ff0000')
  })

  it('blends a second colour into what is already there', () => {
    let scene = sprayPiece(withPiece(), 'a', '#ff0000', 0.5)
    scene = sprayPiece(scene, 'a', '#0000ff', 0.5)
    // Equal amounts of red and blue land halfway between them.
    expect(scene.pieces[0]!.tint!.color).toBe('#800080')
  })

  it('never exceeds fully painted', () => {
    let scene = sprayPiece(withPiece(), 'a', '#ff0000', 0.9)
    scene = sprayPiece(scene, 'a', '#ff0000', 0.9)
    expect(scene.pieces[0]!.tint!.amount).toBe(1)
  })

  it('ignores a zero-length spray', () => {
    const scene = withPiece()
    expect(sprayPiece(scene, 'a', '#ff0000', 0)).toBe(scene)
  })

  it('clears back to the bare sprite', () => {
    const scene = clearTint(sprayPiece(withPiece(), 'a', '#ff0000', 0.5), 'a')
    expect(scene.pieces[0]!.tint).toBeUndefined()
  })
})

describe('squashing', () => {
  it('merges repeated squeezes at the same aim into one crush', () => {
    let scene = addSquash(withPiece(), 'a', { angle: 0, factor: 1.5 })
    scene = addSquash(scene, 'a', { angle: 0, factor: 1.5 })

    // One transform, not two — and crushes along an axis multiply.
    expect(scene.pieces[0]!.squashes).toHaveLength(1)
    expect(scene.pieces[0]!.squashes![0]!.factor).toBeCloseTo(2.25)
  })

  it('merges squeezes aimed within a hair of each other', () => {
    let scene = addSquash(withPiece(), 'a', { angle: 0, factor: 1.4 })
    scene = addSquash(scene, 'a', { angle: 0.05, factor: 1.4 })
    expect(scene.pieces[0]!.squashes).toHaveLength(1)
  })

  it('starts a new crush when aimed somewhere else', () => {
    let scene = addSquash(withPiece(), 'a', { angle: 0, factor: 1.5 })
    scene = addSquash(scene, 'a', { angle: Math.PI / 2, factor: 1.5 })
    expect(scene.pieces[0]!.squashes).toHaveLength(2)
  })

  it('treats angles that wrap around as the same axis', () => {
    let scene = addSquash(withPiece(), 'a', { angle: 0.05, factor: 1.5 })
    scene = addSquash(scene, 'a', { angle: Math.PI * 2 - 0.05, factor: 1.5 })
    expect(scene.pieces[0]!.squashes).toHaveLength(1)
  })

  it('caps how far one axis can be crushed, however many times it is hit', () => {
    let scene = withPiece()
    for (let i = 0; i < 40; i++) scene = addSquash(scene, 'a', { angle: 0, factor: 1.5 })
    expect(scene.pieces[0]!.squashes![0]!.factor).toBe(MAX_SQUASH)
  })

  it('refuses more once every axis slot is used', () => {
    let scene = withPiece()
    for (let i = 0; i < MAX_SQUASHES_PER_PIECE; i++) {
      // Spread them out so each starts a new crush rather than merging.
      scene = addSquash(scene, 'a', { angle: i * 0.6, factor: 1.3 })
    }
    expect(scene.pieces[0]!.squashes).toHaveLength(MAX_SQUASHES_PER_PIECE)
    expect(addSquash(scene, 'a', { angle: 3, factor: 1.3 })).toBe(scene)
  })

  it('clears every squash, dropping the field entirely', () => {
    const scene = clearSquashes(addSquash(withPiece(), 'a', SQUASH), 'a')
    expect(scene.pieces[0]!.squashes).toBeUndefined()
  })
})

describe('slicing splits a piece in two', () => {
  it('produces two pieces taking opposite sides of the cut', () => {
    const scene = splitPiece(withPiece(), 'a', CUT, 'b')

    expect(scene.pieces).toHaveLength(2)
    const [keep, offcut] = scene.pieces
    expect(keep!.cuts).toEqual([CUT])
    expect(offcut!.cuts).toEqual([{ nx: -CUT.nx, ny: -CUT.ny, d: -CUT.d }])
  })

  it('carries the colour, squashes and angle onto both halves', () => {
    let scene = sprayPiece(withPiece(), 'a', '#ff0000', 0.5)
    scene = addSquash(scene, 'a', SQUASH)
    scene = transformPiece(scene, 'a', 1.5, 0.8)
    scene = splitPiece(scene, 'a', CUT, 'b')

    for (const piece of scene.pieces) {
      expect(piece.tint!.color).toBe('#ff0000')
      expect(piece.squashes).toEqual([SQUASH])
      expect(piece.rotation).toBe(0.8)
      expect(piece.scale).toBe(1.5)
    }
  })

  it('nudges the halves apart so the cut is visible', () => {
    const scene = splitPiece(withPiece(), 'a', CUT, 'b')
    expect(scene.pieces[0]!.x).toBeLessThan(scene.pieces[1]!.x)
  })

  it('parts the halves the way the caller drew, not along the cut’s own normal', () => {
    // The cut's normal points along x, but a turned piece was sliced with a
    // stroke that runs the other way on screen.
    const turned = transformPiece(withPiece(), 'a', 1, Math.PI / 2)
    const scene = splitPiece(turned, 'a', CUT, 'b', { x: 0, y: 1 })

    expect(scene.pieces[0]!.y).toBeLessThan(scene.pieces[1]!.y)
    expect(scene.pieces[0]!.x).toBeCloseTo(scene.pieces[1]!.x)
  })

  it('moves each half’s centre onto the part that survived', () => {
    const scene = splitPiece(withPiece(), 'a', CUT, 'b')

    // The pom-pom is 256 wide, so each half balances a quarter-width off centre.
    expect(scene.pieces[0]!.pivot!.x).toBeCloseTo(-256 / 4, 0)
    expect(scene.pieces[1]!.pivot!.x).toBeCloseTo(256 / 4, 0)
  })

  it('does not let recentring slide the artwork', () => {
    const before = withPiece().pieces[0]!
    const scene = splitPiece(withPiece(), 'a', CUT, 'b')

    // Moving the origin must not move the picture. The sprite should sit
    // exactly where it did, offset only by the deliberate nudge.
    for (const half of scene.pieces) {
      const drift = spriteOrigin(half)
      expect(Math.hypot(drift.x - before.x, drift.y - before.y)).toBeCloseTo(NUDGE, 1)
    }
  })

  it('carries the piece’s own scale and angle into the recentring', () => {
    const turned = transformPiece(withPiece(), 'a', 2, Math.PI / 2)
    const before = turned.pieces[0]!
    const scene = splitPiece(turned, 'a', CUT, 'b')

    // Same invariant through a rotation and a scale — the nudge grows with the
    // piece, and nothing else shifts.
    for (const half of scene.pieces) {
      const drift = spriteOrigin(half)
      expect(Math.hypot(drift.x - before.x, drift.y - before.y)).toBeCloseTo(NUDGE * 2, 1)
    }
  })

  it('accepts an unnormalised direction', () => {
    const scene = splitPiece(withPiece(), 'a', CUT, 'b', { x: 0, y: 40 })
    const gap = Math.abs(scene.pieces[0]!.y - scene.pieces[1]!.y)
    // Same spread as a unit vector would give, not 40x it.
    expect(gap).toBeCloseTo(90)
  })

  it('refuses when there is no room for the second half', () => {
    let scene = emptyScene()
    for (let i = 0; i < MAX_PIECES; i++) scene = addPiece(scene, 'pom-pom', `p${i}`)
    expect(splitPiece(scene, 'p0', CUT, 'extra')).toBe(scene)
  })

  it('refuses once a piece has been cut as many times as allowed', () => {
    let scene = withPiece()
    for (let i = 0; i < MAX_CUTS_PER_PIECE; i++) {
      scene = updatePiece(scene, 'a', { cuts: new Array(i + 1).fill(CUT) })
    }
    expect(splitPiece(scene, 'a', CUT, 'b')).toBe(scene)
  })
})

describe('piece edits', () => {
  it('toggles flip', () => {
    const scene = flipPiece(withPiece(), 'a')
    expect(scene.pieces[0]!.flipX).toBe(true)
  })

  it('ignores edits to a piece that is not there', () => {
    const scene = withPiece()
    expect(flipPiece(scene, 'ghost')).toBe(scene)
    expect(addSquash(scene, 'ghost', SQUASH)).toBe(scene)
    expect(splitPiece(scene, 'ghost', CUT, 'b')).toBe(scene)
  })

  it('removes a piece', () => {
    expect(removePiece(withPiece(), 'a').pieces).toHaveLength(0)
  })
})

describe('history', () => {
  it('undoes back to the previous scene', () => {
    const first = withPiece('a')
    let history: History = { past: [], present: first }
    expect(canUndo(history)).toBe(false)

    history = pushHistory(history, addPiece(first, 'toaster', 'b'))
    expect(history.present.pieces).toHaveLength(2)

    history = undo(history)
    expect(history.present.pieces).toHaveLength(1)
  })

  it('stays put when there is nothing to undo', () => {
    const history: History = { past: [], present: emptyScene() }
    expect(undo(history)).toBe(history)
  })

  it('bounds the history so a long round cannot grow without limit', () => {
    let history: History = { past: [], present: withPiece() }
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      history = pushHistory(history, updatePiece(history.present, 'a', { x: i }))
    }
    expect(history.past).toHaveLength(MAX_HISTORY)
    expect(history.present.pieces[0]!.x).toBe(MAX_HISTORY + 19)
  })
})
