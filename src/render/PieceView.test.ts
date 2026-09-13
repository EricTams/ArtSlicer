import { describe, expect, it } from 'vitest'

import { makeCombo } from '../editor/combo'
import type { Combo, Placed, SceneNode } from '../shared/scene'
import { SceneNodeView } from './PieceView'

const piece = (id: string, over: Partial<Placed> = {}): Placed => ({
  id,
  pieceId: 'argyle-sock',
  x: 500,
  y: 500,
  scale: 1,
  rotation: 0,
  z: 0,
  ...over,
})

/**
 * Walks what a component returned, without rendering it.
 *
 * These components take no hooks, so calling one hands back a plain tree of
 * elements. That is enough to ask what it would draw — which is the only way
 * to catch a renderer that has been handed something and quietly ignores it,
 * since no amount of checking the data will notice.
 */
function findProp(node: unknown, prop: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProp(item, prop)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node !== 'object' || node === null) return undefined

  const element = node as { props?: Record<string, unknown> }
  if (!element.props) return undefined
  if (element.props[prop] !== undefined) return element.props[prop]
  return findProp(element.props['children'], prop)
}

const sliced = (): Combo => ({
  ...makeCombo([piece('a', { x: 460 }), piece('b', { x: 540 })], 'c'),
  cuts: [{ nx: 1, ny: 0, d: 0 }],
})

describe('drawing a combo', () => {
  it('clips it when it has been sliced', () => {
    // The bug this exists for: the cut was stored on the combo and never drawn,
    // so both halves of a slice came out whole and the slice looked like a copy.
    expect(findProp(SceneNodeView({ node: sliced() }), 'clipFunc')).toBeTypeOf('function')
  })

  it('does not pay for a clip on a combo that has not been sliced', () => {
    const whole: SceneNode = makeCombo([piece('a'), piece('b')], 'c')
    expect(findProp(SceneNodeView({ node: whole }), 'clipFunc')).toBeUndefined()
  })

  it('draws everything inside it either way', () => {
    const tree = SceneNodeView({ node: sliced() })
    const seen: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk)
      if (typeof node !== 'object' || node === null) return
      const element = node as { props?: Record<string, unknown> }
      const child = element.props?.['node'] as SceneNode | undefined
      if (child) seen.push(child.id)
      walk(element.props?.['children'])
    }
    walk(tree)
    // makeCombo keeps its members' own ids; only a slice's copy renames them.
    expect(seen).toContain('a')
    expect(seen).toContain('b')
  })
})
