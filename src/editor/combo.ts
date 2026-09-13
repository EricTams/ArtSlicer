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
import { inkPoints, kept } from '../render/ink'
import { getPiece } from '../render/pieces'
import { apply as applyLinear, pieceMatrix } from '../render/transform'
import type { Point } from '../render/clip'
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

  /*
   * Every part of the old transform has to go, not just the parts replaced
   * above. The decomposition describes the node's whole position and shape, so
   * a leftover mirror, squeeze or pivot is applied on top of a transform that
   * already accounts for it — and a pivot is exactly that, since nodeMatrix
   * ends by shifting onto it. Cuts stay: they are in the sprite and the sprite
   * has not moved within itself.
   */
  if (!local.flipX) delete (rebased as { flipX?: boolean }).flipX
  if (!local.squash) delete (rebased as { squashes?: unknown }).squashes
  delete (rebased as { pivot?: unknown }).pivot
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
  return recentreCombo({ ...shell, children: members.map((member) => rebase(member, shell)) })
}

/** Adds one more node to an existing combo, without it appearing to move. */
export function addToCombo(combo: Combo, node: SceneNode): Combo {
  return recentreCombo({ ...combo, children: [...combo.children, rebase(node, combo)] })
}

/**
 * Where a node has art, in its own coordinates, whatever is under it.
 *
 * A combo asks its children and brings their answers up through their own
 * transforms, so a combo of combos still reports one set of points in one
 * frame. Cuts are applied on the way, at every level, because a slice higher
 * up removes art below it just as surely.
 */
export function inkOf(node: SceneNode): Point[] {
  const own = isCombo(node)
    ? node.children.flatMap((child) => {
        const matrix = nodeMatrix(child)
        return inkOf(child).map((point) => apply(matrix, point.x, point.y))
      })
    : inkPoints(node.pieceId)

  return node.cuts?.length ? own.filter((point) => kept(node.cuts, point)) : own
}

/**
 * The box a node's art fills, in its own coordinates, or nothing when it has
 * none left.
 *
 * Measured off the art rather than the sprite's rectangle. The rectangles are
 * already trimmed to the art, so they are not loose — but a windsock's box is
 * mostly streamers, and the middle of the box is not the middle of what anyone
 * looking at it would call the windsock.
 */
export function inkBounds(
  node: SceneNode,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points = inkOf(node)
  if (points.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * The box a combo's children occupy, in the space they are stored in.
 *
 * Unlike localBox this is where they actually are rather than how far they
 * reach from the origin, which is the difference between knowing a combo's
 * size and knowing its middle.
 */
function contentBounds(
  combo: Combo,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const child of combo.children) {
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
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/**
 * Moves a combo's origin to the middle of what it holds, without the artwork
 * moving a pixel.
 *
 * The origin is where the combo turns and grows from, where its ring is drawn
 * and where its handle hangs off. Adding a part extends the combo on one side,
 * so an origin left where it was is no longer the middle of anything — the
 * ring sits off to one side and turning the combo swings it rather than
 * spinning it.
 *
 * Shifting the origin would slide the artwork, so it is cancelled out: the
 * offset travels through the combo's own turn, size and squeezes to reach the
 * scene, exactly as it does when a slice recentres a piece.
 */
export function recentreCombo(combo: Combo): Combo {
  // What the art fills, falling back to what the rectangles do when a combo
  // has been cut down to nothing an eye could find.
  const bounds = inkBounds(combo) ?? contentBounds(combo)
  if (!bounds) return combo

  const centre = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
  const previous = combo.pivot ?? { x: 0, y: 0 }
  const shift = applyLinear(pieceMatrix(combo), {
    x: centre.x - previous.x,
    y: centre.y - previous.y,
  })

  return { ...combo, pivot: centre, x: combo.x + shift.x, y: combo.y + shift.y }
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


/** What a tap on a piece means, which depends on whether grouping is armed. */
export type Tap =
  | { action: 'select'; id: string }
  | { action: 'group'; into: string; add: string; comboId: string }

/**
 * Reads a tap.
 *
 * Kept apart from the canvas because the interesting part is not the touch: it
 * is which id the player is left holding afterwards. Adding to a combo keeps
 * that combo's id, while two loose pieces make a new one, and getting that
 * wrong leaves the selection pointing at something that no longer exists.
 */
export function readTap(
  scene: { pieces: SceneNode[] },
  selectedId: string | null,
  tappedId: string,
  freshId: string,
  grouping: boolean,
): Tap {
  // Nothing to join, or joining something to itself.
  if (!grouping || !selectedId || selectedId === tappedId) {
    return { action: 'select', id: tappedId }
  }

  const into = scene.pieces.find((node) => node.id === selectedId)
  if (!into) return { action: 'select', id: tappedId }

  return {
    action: 'group',
    into: selectedId,
    add: tappedId,
    comboId: isCombo(into) ? selectedId : freshId,
  }
}


/**
 * The same node again under fresh ids, all the way down.
 *
 * Slicing copies whatever it cuts, and a combo brings its contents along. Two
 * halves holding children under one set of ids would be two different things
 * claiming to be the same parts — fine while nothing looks a child up, and a
 * trap the moment something does.
 *
 * Derived from the parent's id rather than minted, so the result is the same
 * every time for a given slice: easier to test, and easier to read in a
 * snapshot than a fistful of random ids.
 */
export function withFreshIds(node: SceneNode, id: string): SceneNode {
  if (!isCombo(node)) return { ...node, id }
  return {
    ...node,
    id,
    children: node.children.map((child, index) => withFreshIds(child, `${id}-${index}`)),
  }
}


/**
 * How far a node reaches from its own origin, before its scale is applied.
 *
 * What anything that wants to sit *outside* a node needs to know. A sprite is
 * a couple of hundred units across and a combo of several is a lot more, so a
 * fixed distance that clears one will be buried inside the other.
 */
export function reachOf(node: SceneNode): number {
  const box = localBox(node)
  return Math.hypot(box.width / 2, box.height / 2)
}
