import {
  IDENTITY,
  apply,
  type Mat,
  compose,
  decompose,
  invert,
  multiply,
  rotation,
  scaling,
  squashMatrix,
  translation,
} from '../render/transform2d'
import { getPiece } from '../render/pieces'
import type { Combo, Placed, SceneNode, Transformed } from '../shared/scene'
import { isCombo } from '../shared/scene'

/**
 * The transform a node applies to everything inside it, in the order the
 * renderer nests: position, turn, size and mirror, then each squash, then the
 * shift onto the node's own pivot.
 */
export function nodeMatrix(node: Transformed): Mat {
  const squashes = node.squashes ?? []
  // squashes[0] is nested innermost, so it composes last of the stack.
  const crushes = squashes.reduceRight(
    (acc, squash) => multiply(acc, squashMatrix(squash.angle, squash.factor)),
    IDENTITY,
  )

  return compose(
    translation(node.x, node.y),
    rotation(node.rotation),
    scaling(node.scale * (node.flipX ? -1 : 1), node.scale),
    crushes,
    translation(-(node.pivot?.x ?? 0), -(node.pivot?.y ?? 0)),
  )
}

/** Where a node ends up once every combo above it has had its say. */
export function worldMatrix(node: Transformed, parents: readonly Transformed[] = []): Mat {
  return parents.reduceRight(
    (acc, parent) => multiply(nodeMatrix(parent), acc),
    nodeMatrix(node),
  )
}

/**
 * A node's fields rewritten so that, placed inside `parent`, it stays exactly
 * where it looks like it is now.
 *
 * Joining a combo must not move or reshape anything. The parent's transform is
 * undone on the way in, and whatever that leaves — a turn, a size, a mirror, a
 * squeeze standing in for the parent's own — is what the node stores. Every
 * invertible transform decomposes into precisely the fields a node has, which
 * is the reason this can be exact rather than approximate.
 */
export function rebase(node: SceneNode, parent: Transformed): SceneNode {
  const local = decompose(multiply(invert(nodeMatrix(parent)), nodeMatrix(node)))

  const rebased = {
    ...node,
    x: local.x,
    y: local.y,
    rotation: local.rotation,
    scale: local.scale,
    ...(local.flipX ? { flipX: true } : {}),
    ...(local.squash ? { squashes: [local.squash] } : {}),
  }

  // A node keeps its own pivot, so anything the decomposition folded in has to
  // come back out; otherwise the shift would be applied twice.
  if (!local.flipX) delete (rebased as { flipX?: boolean }).flipX
  if (!local.squash) delete (rebased as { squashes?: unknown }).squashes
  return rebased as SceneNode
}

/** Everything a node draws, flattened — what counts against the piece limit. */
export function leafCount(node: SceneNode): number {
  return isCombo(node) ? node.children.reduce((sum, kid) => sum + leafCount(kid), 0) : 1
}

export function leaves(node: SceneNode): Placed[] {
  return isCombo(node) ? node.children.flatMap(leaves) : [node]
}

/** Where a combo should sit when first made: the middle of what went into it. */
export function centreOf(nodes: readonly SceneNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 }
  const sum = nodes.reduce((acc, node) => ({ x: acc.x + node.x, y: acc.y + node.y }), {
    x: 0,
    y: 0,
  })
  return { x: sum.x / nodes.length, y: sum.y / nodes.length }
}

/**
 * Makes one thing out of several.
 *
 * The combo starts with no turn, no squeeze and no mirror of its own, sitting
 * at the middle of what it was given — a fresh frame of reference, so what the
 * player does to it from here reads plainly. The members are rebased into it
 * and none of them move.
 */
export function makeCombo(members: readonly SceneNode[], id: string): Combo {
  const centre = centreOf(members)
  const shell: Combo = {
    id,
    x: centre.x,
    y: centre.y,
    scale: 1,
    rotation: 0,
    z: Math.max(...members.map((member) => member.z)),
    children: [],
  }
  return { ...shell, children: members.map((member) => rebase(member, shell)) }
}

/** Adds one more node to an existing combo, without it appearing to move. */
export function addToCombo(combo: Combo, node: SceneNode): Combo {
  return { ...combo, children: [...combo.children, rebase(node, combo)] }
}

/**
 * A box in the node's own space big enough to hold everything it draws.
 *
 * A sprite knows its own size; a combo has to ask its children and allow for
 * where each of them sits. Used where a single extent stands in for the whole
 * node — recentring after a slice, most of all, which otherwise has nothing to
 * take a middle of.
 *
 * Axis-aligned and centred on the node's origin, so it is generous for a combo
 * whose contents sit off to one side. That costs a slightly loose box and
 * never a wrong one.
 */
export function localBox(node: SceneNode): { width: number; height: number } {
  if (!isCombo(node)) {
    const def = getPiece(node.pieceId)
    return def ? { width: def.width, height: def.height } : { width: 0, height: 0 }
  }

  let halfWidth = 0
  let halfHeight = 0
  for (const child of node.children) {
    const box = localBox(child)
    const matrix = nodeMatrix(child)
    const corners: Array<[number, number]> = [
      [-box.width / 2, -box.height / 2],
      [box.width / 2, -box.height / 2],
      [box.width / 2, box.height / 2],
      [-box.width / 2, box.height / 2],
    ]
    for (const [cx, cy] of corners) {
      const point = apply(matrix, cx, cy)
      halfWidth = Math.max(halfWidth, Math.abs(point.x))
      halfHeight = Math.max(halfHeight, Math.abs(point.y))
    }
  }
  return { width: halfWidth * 2, height: halfHeight * 2 }
}
