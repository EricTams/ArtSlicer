import { describe, expect, it } from 'vitest'

import { MAX_CUTS_PER_PIECE, MAX_PIECES, emptyScene } from '../shared/scene'
import { PALETTE } from '../render/palette'
import {
  type History,
  MAX_HISTORY,
  addCut,
  addPiece,
  bringToFront,
  canUndo,
  clearCuts,
  cyclePieceTint,
  flipPiece,
  pushHistory,
  removePiece,
  sendToBack,
  undo,
  updatePiece,
} from './sceneEdit'

const CUT = { nx: 1, ny: 0, d: 0 }

describe('addPiece', () => {
  it('stacks each new piece above the last', () => {
    let scene = addPiece(emptyScene(), 'disc', 'a')
    scene = addPiece(scene, 'star', 'b')
    expect(scene.pieces[1]!.z).toBeGreaterThan(scene.pieces[0]!.z)
  })

  it('refuses to exceed the piece cap', () => {
    let scene = emptyScene()
    for (let i = 0; i < MAX_PIECES; i++) scene = addPiece(scene, 'disc', `p${i}`)
    expect(scene.pieces).toHaveLength(MAX_PIECES)

    const full = addPiece(scene, 'disc', 'overflow')
    expect(full.pieces).toHaveLength(MAX_PIECES)
    expect(full).toBe(scene)
  })
})

describe('layering', () => {
  it('brings a buried piece to the front', () => {
    let scene = addPiece(addPiece(emptyScene(), 'disc', 'a'), 'star', 'b')
    scene = bringToFront(scene, 'a')
    const a = scene.pieces.find((p) => p.id === 'a')!
    const b = scene.pieces.find((p) => p.id === 'b')!
    expect(a.z).toBeGreaterThan(b.z)
  })

  it('sends a piece behind everything', () => {
    let scene = addPiece(addPiece(emptyScene(), 'disc', 'a'), 'star', 'b')
    scene = sendToBack(scene, 'b')
    const a = scene.pieces.find((p) => p.id === 'a')!
    const b = scene.pieces.find((p) => p.id === 'b')!
    expect(b.z).toBeLessThan(a.z)
  })
})

describe('piece edits', () => {
  it('toggles flip', () => {
    let scene = addPiece(emptyScene(), 'disc', 'a')
    scene = flipPiece(scene, 'a')
    expect(scene.pieces[0]!.flipX).toBe(true)
    scene = flipPiece(scene, 'a')
    expect(scene.pieces[0]!.flipX).toBe(false)
  })

  it('wraps the tint around the palette in both directions', () => {
    let scene = addPiece(emptyScene(), 'disc', 'a')
    scene = cyclePieceTint(scene, 'a', -1)
    expect(scene.pieces[0]!.tint).toBe(PALETTE.length - 1)
    scene = cyclePieceTint(scene, 'a', 1)
    expect(scene.pieces[0]!.tint).toBe(0)
  })

  it('ignores edits to a piece that is not there', () => {
    const scene = addPiece(emptyScene(), 'disc', 'a')
    expect(updatePiece(scene, 'ghost', { x: 5 }).pieces).toEqual(scene.pieces)
    expect(flipPiece(scene, 'ghost')).toBe(scene)
  })

  it('removes a piece', () => {
    const scene = removePiece(addPiece(emptyScene(), 'disc', 'a'), 'a')
    expect(scene.pieces).toHaveLength(0)
  })
})

describe('cuts', () => {
  it('accumulates up to the cap then refuses more', () => {
    let scene = addPiece(emptyScene(), 'disc', 'a')
    for (let i = 0; i < MAX_CUTS_PER_PIECE; i++) scene = addCut(scene, 'a', CUT)
    expect(scene.pieces[0]!.cuts).toHaveLength(MAX_CUTS_PER_PIECE)

    const capped = addCut(scene, 'a', CUT)
    expect(capped).toBe(scene)
  })

  it('clears every cut, dropping the field entirely', () => {
    let scene = addCut(addPiece(emptyScene(), 'disc', 'a'), 'a', CUT)
    scene = clearCuts(scene, 'a')
    expect(scene.pieces[0]!.cuts).toBeUndefined()
  })

  it('is a no-op when there is nothing to clear', () => {
    const scene = addPiece(emptyScene(), 'disc', 'a')
    expect(clearCuts(scene, 'a')).toBe(scene)
  })
})

describe('history', () => {
  it('undoes back to the previous scene', () => {
    const first = addPiece(emptyScene(), 'disc', 'a')
    let history: History = { past: [], present: first }
    expect(canUndo(history)).toBe(false)

    history = pushHistory(history, addPiece(first, 'star', 'b'))
    expect(history.present.pieces).toHaveLength(2)
    expect(canUndo(history)).toBe(true)

    history = undo(history)
    expect(history.present.pieces).toHaveLength(1)
    expect(canUndo(history)).toBe(false)
  })

  it('stays put when there is nothing to undo', () => {
    const history = { past: [], present: emptyScene() }
    expect(undo(history)).toBe(history)
  })

  it('ignores a push that changed nothing', () => {
    const scene = emptyScene()
    const history = { past: [], present: scene }
    expect(pushHistory(history, scene)).toBe(history)
  })

  it('bounds the history so a long round cannot grow without limit', () => {
    // Dragging one piece, which has no cap — unlike adding pieces.
    let history: History = { past: [], present: addPiece(emptyScene(), 'disc', 'a') }
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      history = pushHistory(history, updatePiece(history.present, 'a', { x: i }))
    }
    expect(history.past).toHaveLength(MAX_HISTORY)
    // The newest state survives; only the oldest are dropped.
    expect(history.present.pieces[0]!.x).toBe(MAX_HISTORY + 19)
  })
})
