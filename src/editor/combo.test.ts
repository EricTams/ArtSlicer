import { describe, expect, it } from 'vitest'

import { apply, multiply, squashMatrix } from '../render/transform2d'
import {
  MAX_COMBO_DEPTH,
  MAX_PIECES,
  type Combo,
  type Placed,
  type Scene,
  type SceneNode,
  isCombo,
  sanitizeScene,
} from '../shared/scene'
import {
  addToCombo,
  leafCount,
  leaves,
  makeCombo,
  nodeMatrix,
  readTap,
  worldMatrix,
} from './combo'
import { addPiece, groupPieces, sceneLeafCount } from './sceneEdit'

function piece(over: Partial<Placed> = {}): Placed {
  return { id: 'p', pieceId: 'sock', x: 0, y: 0, scale: 1, rotation: 0, z: 0, ...over }
}

/**
 * Where the node actually puts ink. Comparing matrices field by field would
 * pass for a transform that is right on paper and wrong on screen, so this
 * asks the only question that matters: does the sprite land in the same place?
 */
function corners(node: SceneNode, parents: SceneNode[] = []): Array<{ x: number; y: number }> {
  const m = worldMatrix(node, parents)
  return [
    apply(m, 0, 0),
    apply(m, 100, 0),
    apply(m, 0, 100),
    apply(m, -60, 35),
  ]
}

function sameInk(got: Array<{ x: number; y: number }>, want: Array<{ x: number; y: number }>): void {
  expect(got).toHaveLength(want.length)
  got.forEach((point, i) => {
    expect(Math.abs(point.x - want[i]!.x)).toBeLessThan(1e-7)
    expect(Math.abs(point.y - want[i]!.y)).toBeLessThan(1e-7)
  })
}

/** Combos in every awkward state a piece might be dropped into. */
const AWKWARD: Array<[string, Partial<Combo>]> = [
  ['plain', {}],
  ['moved', { x: 140, y: -80 }],
  ['turned', { rotation: 0.9 }],
  ['sized up', { scale: 2.4 }],
  ['sized down', { scale: 0.3 }],
  ['mirrored', { flipX: true }],
  ['squished', { squashes: [{ angle: 0.4, factor: 1.9 }] }],
  ['squished twice, on different axes', {
    squashes: [
      { angle: 0.2, factor: 1.5 },
      { angle: -1.1, factor: 2.2 },
    ],
  }],
  ['turned and squished', { rotation: -2.2, squashes: [{ angle: 1.3, factor: 1.7 }] }],
  ['moved, turned, sized, mirrored and squished', {
    x: -55,
    y: 210,
    rotation: 1.75,
    scale: 1.8,
    flipX: true,
    squashes: [{ angle: 0.65, factor: 2.6 }],
  }],
  ['pivoted, as a sliced combo would be', { pivot: { x: 40, y: -25 }, rotation: 0.5 }],
]

describe('adding a piece to a combo', () => {
  it.each(AWKWARD)('leaves it exactly where it was when the combo is %s', (_name, shape) => {
    const combo: Combo = { id: 'c', x: 0, y: 0, scale: 1, rotation: 0, z: 5, children: [], ...shape }
    const joining = piece({ x: 90, y: -30, rotation: 0.4, scale: 1.6 })

    const before = corners(joining)
    const after = addToCombo(combo, joining)
    const child = after.children[0]!

    sameInk(corners(child, [after]), before)
  })

  it.each(AWKWARD)('leaves a squished, mirrored piece alone too when the combo is %s', (_name, shape) => {
    const combo: Combo = { id: 'c', x: 0, y: 0, scale: 1, rotation: 0, z: 5, children: [], ...shape }
    const joining = piece({
      x: -120,
      y: 75,
      rotation: -1.4,
      scale: 0.7,
      flipX: true,
      squashes: [{ angle: 0.9, factor: 2.1 }],
    })

    const before = corners(joining)
    const after = addToCombo(combo, joining)
    sameInk(corners(after.children[0]!, [after]), before)
  })

  it('keeps earlier members put when another one joins', () => {
    const first = piece({ id: 'a', x: 20, y: 10, rotation: 0.3 })
    const second = piece({ id: 'b', x: -40, y: 60, scale: 1.4 })
    const combo = makeCombo([first, second], 'c')

    const before = combo.children.map((child) => corners(child, [combo]))
    const grown = addToCombo(combo, piece({ id: 'c3', x: 5, y: 5 }))

    grown.children.slice(0, 2).forEach((child, i) => {
      sameInk(corners(child, [grown]), before[i]!)
    })
  })

  it('stays exact through repeated additions to a combo that keeps changing', () => {
    let combo = makeCombo([piece({ id: 'a', x: 10, y: 10 })], 'c')

    for (let i = 0; i < 8; i++) {
      // Crushed, turned and grown between additions, so every piece joins a
      // combo in a state no earlier one saw.
      combo = {
        ...combo,
        rotation: combo.rotation + 0.3,
        scale: combo.scale * 1.05,
        squashes: [...(combo.squashes ?? []), { angle: i * 0.5, factor: 1.2 }],
      }

      const joining = piece({
        id: `p${i}`,
        x: i * 30 - 100,
        y: i * -17,
        rotation: i * 0.4,
        scale: 1 + i * 0.1,
      })
      const before = corners(joining)

      combo = addToCombo(combo, joining)
      sameInk(corners(combo.children[combo.children.length - 1]!, [combo]), before)
    }

    expect(combo.children).toHaveLength(9)
  })
})


describe('making a combo', () => {
  it('starts with a fresh transform, so the combo itself reads plainly', () => {
    const combo = makeCombo([piece({ id: 'a', x: 10, y: 20, rotation: 1 })], 'c')
    expect(combo.rotation).toBe(0)
    expect(combo.scale).toBe(1)
    expect(combo.squashes).toBeUndefined()
    expect(combo.flipX).toBeUndefined()
  })

  it('sits at the middle of what went into it', () => {
    const combo = makeCombo([piece({ id: 'a', x: 0, y: 0 }), piece({ id: 'b', x: 100, y: 40 })], 'c')
    expect(combo.x).toBe(50)
    expect(combo.y).toBe(20)
  })

  it('moves nothing it was made from', () => {
    const members = [
      piece({ id: 'a', x: 0, y: 0, rotation: 0.7, scale: 1.3 }),
      piece({ id: 'b', x: 100, y: 40, flipX: true, squashes: [{ angle: 0.3, factor: 1.6 }] }),
    ]
    const before = members.map((m) => corners(m))
    const combo = makeCombo(members, 'c')

    combo.children.forEach((child, i) => sameInk(corners(child, [combo]), before[i]!))
  })

  it('takes the topmost z of its members, so it sits where they sat', () => {
    expect(makeCombo([piece({ id: 'a', z: 2 }), piece({ id: 'b', z: 7 })], 'c').z).toBe(7)
  })
})

describe('counting what is inside', () => {
  it('counts sprites and not combos, which is what the piece limit is about', () => {
    const inner = makeCombo([piece({ id: 'a' }), piece({ id: 'b' })], 'c1')
    const outer = makeCombo([inner, piece({ id: 'c' })], 'c2')
    expect(leafCount(outer)).toBe(3)
    expect(leaves(outer).map((leaf) => leaf.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('nodeMatrix', () => {
  it('puts a plain piece exactly where its coordinates say', () => {
    const m = nodeMatrix(piece({ x: 30, y: 40 }))
    const p = apply(m, 0, 0)
    expect(p.x).toBeCloseTo(30)
    expect(p.y).toBeCloseTo(40)
  })

  it('nests squashes the way the renderer does, with the last one outermost', () => {
    /*
     * PieceView wraps its children with squashes[0] first, so squashes[1] ends
     * up outside it. Getting this backwards cancels out everywhere inside this
     * module — a combo would still round-trip against itself — and is only
     * wrong against what is actually drawn, so it is pinned here directly.
     */
    const inner = { angle: 0.3, factor: 1.8 }
    const outer = { angle: -0.9, factor: 2.4 }
    const got = nodeMatrix(piece({ squashes: [inner, outer] }))

    const rendered = multiply(
      squashMatrix(outer.angle, outer.factor),
      squashMatrix(inner.angle, inner.factor),
    )
    const reversed = multiply(
      squashMatrix(inner.angle, inner.factor),
      squashMatrix(outer.angle, outer.factor),
    )

    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expect(Math.abs(got[key] - rendered[key])).toBeLessThan(1e-9)
    }
    /*
     * And the two orders really are different, or the check above proves
     * nothing. It has to be an off-diagonal entry: both squashes are
     * symmetric, so their products are each other's transpose and the
     * diagonal agrees however they are ordered.
     */
    expect(Math.abs(rendered.b - reversed.b)).toBeGreaterThan(1e-6)
  })

  it('applies the pivot inside the turn, not outside it', () => {
    const turned = nodeMatrix(piece({ rotation: Math.PI / 2, pivot: { x: 10, y: 0 } }))
    const p = apply(turned, 10, 0)
    // The pivot point is what stays put under rotation.
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0)
  })
})

describe('a combo in a scene', () => {
  it('survives the wire, children and all', () => {
    const combo = makeCombo(
      [piece({ id: 'a', x: 20, y: 10, rotation: 0.3 }), piece({ id: 'b', x: -40, y: 60 })],
      'c',
    )
    const scene: Scene = { pieces: [combo] }

    const back = sanitizeScene(JSON.parse(JSON.stringify(scene)), () => true)
    expect(back).not.toBeNull()
    const node = back!.pieces[0]!
    expect(isCombo(node)).toBe(true)
    expect((node as Combo).children).toHaveLength(2)
  })

  it('drops a combo holding nothing, which would only be a transform to walk', () => {
    const empty = { ...makeCombo([piece({ id: 'a' })], 'c'), children: [] }
    const back = sanitizeScene({ pieces: [empty] }, () => true)
    expect(back!.pieces).toHaveLength(0)
  })

  it('refuses to nest past the depth limit', () => {
    let node: SceneNode = piece({ id: 'leaf' })
    for (let i = 0; i < MAX_COMBO_DEPTH + 3; i++) node = makeCombo([node], `c${i}`)

    const back = sanitizeScene(JSON.parse(JSON.stringify({ pieces: [node] })), () => true)
    // Too deep to keep, and the whole branch goes rather than half of it.
    expect(back!.pieces).toHaveLength(0)
  })

  it('counts sprites across the whole tree against the piece limit', () => {
    // Each combo holds a handful; together they ask for more than is allowed.
    const many = Array.from({ length: 10 }, (_, c) =>
      makeCombo(
        Array.from({ length: 5 }, (_, i) => piece({ id: `p${c}-${i}` })),
        `c${c}`,
      ),
    )
    const back = sanitizeScene(JSON.parse(JSON.stringify({ pieces: many })), () => true)
    const kept = back!.pieces.reduce((sum, node) => sum + leafCount(node), 0)
    expect(kept).toBeLessThanOrEqual(MAX_PIECES)
    expect(kept).toBeGreaterThan(0)
  })

  it('throws away a child whose sprite is not in the manifest', () => {
    const combo = makeCombo([piece({ id: 'a', pieceId: 'real' }), piece({ id: 'b', pieceId: 'fake' })], 'c')
    const back = sanitizeScene(JSON.parse(JSON.stringify({ pieces: [combo] })), (id) => id === 'real')
    expect(leafCount(back!.pieces[0]!)).toBe(1)
  })
})

describe('grouping in a scene', () => {
  const twoPieces = (): Scene => ({
    pieces: [
      { id: 'a', pieceId: 'sock', x: 100, y: 100, scale: 1, rotation: 0.2, z: 0 },
      { id: 'b', pieceId: 'ball', x: 200, y: 140, scale: 1.5, rotation: 0, z: 1 },
    ],
  })

  it('replaces both with one thing', () => {
    const scene = groupPieces(twoPieces(), 'a', 'b', 'c')
    expect(scene.pieces).toHaveLength(1)
    expect(isCombo(scene.pieces[0]!)).toBe(true)
    expect(leafCount(scene.pieces[0]!)).toBe(2)
  })

  it('moves neither of them', () => {
    const before = twoPieces()
    const after = groupPieces(before, 'a', 'b', 'c')
    const combo = after.pieces[0] as Combo

    before.pieces.forEach((original, i) => {
      sameInk(corners(combo.children[i]!, [combo]), corners(original))
    })
  })

  it('grows a combo rather than wrapping it again', () => {
    let scene = groupPieces(twoPieces(), 'a', 'b', 'c')
    scene = {
      ...scene,
      pieces: [...scene.pieces, { id: 'd', pieceId: 'cone', x: 40, y: 40, scale: 1, rotation: 0, z: 2 }],
    }
    scene = groupPieces(scene, 'c', 'd', 'c2')

    expect(scene.pieces).toHaveLength(1)
    const combo = scene.pieces[0] as Combo
    // Three members of one combo, not a combo holding a combo.
    expect(combo.children).toHaveLength(3)
    expect(combo.children.every((child) => !isCombo(child))).toBe(true)
  })

  it('leaves a piece where it looks when it joins a combo already turned and crushed', () => {
    let scene = groupPieces(twoPieces(), 'a', 'b', 'c')
    scene = {
      ...scene,
      pieces: scene.pieces.map((node) => ({
        ...node,
        rotation: 1.1,
        scale: 1.7,
        flipX: true,
        squashes: [{ angle: 0.6, factor: 2.2 }],
      })),
    }
    const joining: Placed = { id: 'd', pieceId: 'cone', x: 300, y: 90, scale: 0.8, rotation: -0.5, z: 9 }
    scene = { ...scene, pieces: [...scene.pieces, joining] }

    const before = corners(joining)
    const grown = groupPieces(scene, 'c', 'd', 'c2')
    const combo = grown.pieces[0] as Combo

    sameInk(corners(combo.children[combo.children.length - 1]!, [combo]), before)
  })

  it('does nothing when asked to group something with itself', () => {
    const scene = twoPieces()
    expect(groupPieces(scene, 'a', 'a', 'c')).toBe(scene)
  })

  it('does nothing when either side is not there', () => {
    const scene = twoPieces()
    expect(groupPieces(scene, 'a', 'nope', 'c')).toBe(scene)
    expect(groupPieces(scene, 'nope', 'b', 'c')).toBe(scene)
  })
})

describe('the piece limit', () => {
  it('counts sprites inside combos, not the things sitting at the top', () => {
    const combo = makeCombo(
      Array.from({ length: 5 }, (_, i) => piece({ id: `p${i}` })),
      'c',
    )
    expect(sceneLeafCount({ pieces: [combo, piece({ id: 'loose' })] })).toBe(6)
  })

  it('stops a new piece once the sprites inside combos have filled the picture', () => {
    const combo = makeCombo(
      Array.from({ length: MAX_PIECES }, (_, i) => piece({ id: `p${i}` })),
      'c',
    )
    const full: Scene = { pieces: [combo] }
    // One top-level node, but no room at all.
    expect(addPiece(full, 'sock', 'new').pieces).toHaveLength(1)
  })
})

describe('reading a tap', () => {
  const scene = (): Scene => ({
    pieces: [
      { id: 'a', pieceId: 'sock', x: 0, y: 0, scale: 1, rotation: 0, z: 0 },
      { id: 'b', pieceId: 'ball', x: 50, y: 0, scale: 1, rotation: 0, z: 1 },
    ],
  })

  it('just selects when grouping is not armed', () => {
    expect(readTap(scene(), 'a', 'b', 'fresh', false)).toEqual({ action: 'select', id: 'b' })
  })

  it('joins the tapped piece to the held one when it is', () => {
    expect(readTap(scene(), 'a', 'b', 'fresh', true)).toEqual({
      action: 'group',
      into: 'a',
      add: 'b',
      comboId: 'fresh',
    })
  })

  it('keeps the combo’s own id when adding to one, not the new one', () => {
    // Otherwise the selection is left pointing at something that never existed.
    const withCombo: Scene = {
      pieces: [
        makeCombo([piece({ id: 'a' }), piece({ id: 'b' })], 'c'),
        piece({ id: 'd', x: 90 }),
      ],
    }
    expect(readTap(withCombo, 'c', 'd', 'fresh', true)).toEqual({
      action: 'group',
      into: 'c',
      add: 'd',
      comboId: 'c',
    })
  })

  it('selects rather than grouping a piece with itself', () => {
    expect(readTap(scene(), 'a', 'a', 'fresh', true)).toEqual({ action: 'select', id: 'a' })
  })

  it('selects when nothing is held to group with', () => {
    expect(readTap(scene(), null, 'b', 'fresh', true)).toEqual({ action: 'select', id: 'b' })
  })

  it('selects when what was held has since gone', () => {
    expect(readTap(scene(), 'vanished', 'b', 'fresh', true)).toEqual({ action: 'select', id: 'b' })
  })
})
