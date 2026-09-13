import { parseHex, toHex } from '../render/tint'
import {
  type Cut,
  MAX_CUTS_PER_PIECE,
  MAX_PIECES,
  MAX_SCALE,
  MAX_SQUASH,
  MAX_SQUASHES_PER_PIECE,
  MIN_SCALE,
  type Placed,
  type SceneNode,
  type Transformed,
  isCombo,
  type Scene,
  type Squash,
  type Tint,
  topZ,
} from '../shared/scene'
import { addToCombo, leafCount, localBox, makeCombo } from './combo'
import { clipPolygon, invertCut, polygonCentroid } from '../render/clip'
import { apply, pieceMatrix } from '../render/transform'

/**
 * Pure scene mutations. Keeping these out of React makes the editor's rules —
 * piece caps, layering, squash and cut limits, how paint layers — testable
 * without mounting a canvas. Every function returns a new Scene, which is also
 * what makes undo trivial.
 */

export function addPiece(
  scene: Scene,
  pieceId: string,
  id: string,
  at?: { x: number; y: number },
): Scene {
  if (sceneLeafCount(scene) >= MAX_PIECES) return scene

  const piece: Placed = {
    id,
    pieceId,
    x: at?.x ?? 500,
    y: at?.y ?? 500,
    scale: 1,
    rotation: 0,
    z: topZ(scene) + 1,
  }
  return { ...scene, pieces: [...scene.pieces, piece] }
}

export function updatePiece(scene: Scene, id: string, changes: Partial<Transformed>): Scene {
  return {
    ...scene,
    pieces: scene.pieces.map((piece) => (piece.id === id ? { ...piece, ...changes } : piece)),
  }
}

export function removePiece(scene: Scene, id: string): Scene {
  return { ...scene, pieces: scene.pieces.filter((piece) => piece.id !== id) }
}

export function movePiece(scene: Scene, id: string, x: number, y: number): Scene {
  return updatePiece(scene, id, { x, y })
}

/** Pinching gives both at once, so they are applied together. */
export function transformPiece(scene: Scene, id: string, scale: number, rotation: number): Scene {
  return updatePiece(scene, id, {
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    rotation,
  })
}

export function bringToFront(scene: Scene, id: string): Scene {
  return updatePiece(scene, id, { z: topZ(scene) + 1 })
}

export function sendToBack(scene: Scene, id: string): Scene {
  const lowest = scene.pieces.reduce((min, piece) => Math.min(min, piece.z), 0)
  return updatePiece(scene, id, { z: lowest - 1 })
}

/** Draw order, back to front — the order SceneView paints in. */
function stacking(scene: Scene): SceneNode[] {
  return [...scene.pieces].sort((a, b) => a.z - b.z)
}

/**
 * Whether a piece has anywhere to go: false at the top of the stack going up,
 * at the bottom going down, and for a picture holding a single piece.
 */
export function canRestack(scene: Scene, id: string, direction: 1 | -1): boolean {
  const index = stacking(scene).findIndex((piece) => piece.id === id)
  if (index === -1) return false
  const target = index + direction
  return target >= 0 && target < scene.pieces.length
}

/**
 * Moves a piece one step through the draw order, `1` towards the front.
 *
 * Swapping the two z values would be enough if they were always distinct, but
 * nothing guarantees that — a clamped submission or two pieces built the same
 * way can collide, and swapping equal values silently does nothing. Renumbering
 * the whole stack by its sorted position keeps every step effective.
 */
export function restackPiece(scene: Scene, id: string, direction: 1 | -1): Scene {
  const order = stacking(scene)
  const index = order.findIndex((piece) => piece.id === id)
  if (index === -1) return scene

  const target = index + direction
  if (target < 0 || target >= order.length) return scene

  const moved = order[index]!
  order[index] = order[target]!
  order[target] = moved

  const depth = new Map(order.map((piece, position) => [piece.id, position]))
  return {
    ...scene,
    pieces: scene.pieces.map((piece) => ({ ...piece, z: depth.get(piece.id) ?? piece.z })),
  }
}

/** `x` swaps left and right on the picture; `y` swaps top and bottom. */
export type FlipAxis = 'x' | 'y'

/**
 * Mirrors a piece about an axis of the picture, not of the sprite.
 *
 * Which matters as soon as a piece is turned: pressing "left to right" on a
 * flamingo lying on its side should still swap its left and right on screen,
 * and mirroring in the piece's own frame would flip it top to bottom instead.
 * The tools all aim at what the player can see, and this is no different.
 *
 * Every reflection is a mirror plus a turn, so both axes reuse the one `flipX`
 * flag and carry the rotation with them — negated for left-right, negated about
 * upright for top-bottom. A second `flipY` flag would be redundant state (both
 * set is a half turn) that the renderer, the hit test and the slice tool would
 * each have to learn about, for no shape they cannot already reach.
 */
export function flipPiece(scene: Scene, id: string, axis: FlipAxis): Scene {
  const piece = find(scene, id)
  if (!piece) return scene

  const turned = axis === 'x' ? -piece.rotation : Math.PI - piece.rotation
  return updatePiece(scene, id, { flipX: !piece.flipX, rotation: wrapAngle(turned) })
}

/** Keeps rotation in (-π, π] so repeated flips cannot wind it up. */
function wrapAngle(radians: number): number {
  const turn = Math.PI * 2
  const wrapped = radians % turn
  if (wrapped > Math.PI) return wrapped - turn
  if (wrapped <= -Math.PI) return wrapped + turn
  return wrapped
}

/**
 * Paint layers rather than replaces: spraying a second colour blends it into
 * whatever is already on the piece, weighted by how much of each was applied.
 * Spraying the same colour twice simply makes it stronger.
 */
export function sprayPiece(scene: Scene, id: string, color: string, delta: number): Scene {
  const node = find(scene, id)
  if (!node || delta <= 0) return scene
  // Paint lives on the sprite, so spraying a combo reaches every sprite in it.
  return replace(scene, mapLeaves(node, (piece) => ({ ...piece, tint: blend(piece.tint, color, delta) })))
}

/** Layers `color` over whatever is already there, weighted by how much of each. */
function blend(existing: Tint | undefined, color: string, delta: number): Tint {
  if (!existing || existing.amount <= 0) return { color, amount: Math.min(1, delta) }

  const total = existing.amount + delta
  const [r1, g1, b1] = parseHex(existing.color)
  const [r2, g2, b2] = parseHex(color)
  const mix = (a: number, b: number): number => (a * existing.amount + b * delta) / total

  return {
    color: toHex(mix(r1, r2), mix(g1, g2), mix(b1, b2)),
    amount: Math.min(1, total),
  }
}

export function clearTint(scene: Scene, id: string): Scene {
  const node = find(scene, id)
  if (!node) return scene
  return replace(
    scene,
    mapLeaves(node, (piece) => {
      const next = { ...piece }
      delete next.tint
      return next
    }),
  )
}

/** Applies a change to every sprite under a node, combo or not. */
export function mapLeaves(node: SceneNode, change: (piece: Placed) => Placed): SceneNode {
  return isCombo(node)
    ? { ...node, children: node.children.map((child) => mapLeaves(child, change)) }
    : change(node)
}

/**
 * Squeezes aimed the same way are the same crush, continued. Merging them
 * keeps repeated hits from stacking a nested transform each time — which is
 * what makes "squeeze it again" the natural way to reach an extreme shape
 * rather than an expensive one.
 */
const SAME_AXIS_TOLERANCE = 0.15

export function mergeSquash(squashes: readonly Squash[], next: Squash): Squash[] | null {
  const result = [...squashes]
  const last = result[result.length - 1]

  if (last && axisGap(last.angle, next.angle) < SAME_AXIS_TOLERANCE) {
    result[result.length - 1] = {
      angle: last.angle,
      // Crushes along one axis multiply: squeezing 1.5× twice is 2.25×.
      factor: Math.min(MAX_SQUASH, last.factor * next.factor),
    }
    return result
  }

  if (result.length >= MAX_SQUASHES_PER_PIECE) return null
  result.push({ ...next, factor: Math.min(MAX_SQUASH, next.factor) })
  return result
}

/**
 * How far apart two crushes are aimed, as axes rather than directions.
 *
 * A crush along θ and one along θ + π are the same squeeze approached from the
 * other side — which is precisely what happens when the player grabs the jaw
 * nearest their hand and swipes back the other way. Treating those as separate
 * crushes would spend an axis slot on nothing and stall the readout.
 */
function axisGap(a: number, b: number): number {
  const diff = Math.abs(angleBetween(a, b))
  return Math.min(diff, Math.PI - diff)
}

/** Smallest signed angle between two directions, accounting for wraparound. */
function angleBetween(a: number, b: number): number {
  const diff = (b - a) % (Math.PI * 2)
  if (diff > Math.PI) return diff - Math.PI * 2
  if (diff < -Math.PI) return diff + Math.PI * 2
  return diff
}

export function addSquash(scene: Scene, id: string, squash: Squash): Scene {
  const piece = find(scene, id)
  if (!piece) return scene

  const squashes = mergeSquash(piece.squashes ?? [], squash)
  if (!squashes) return scene
  return updatePiece(scene, id, { squashes })
}

export function clearSquashes(scene: Scene, id: string): Scene {
  const piece = find(scene, id)
  if (!piece?.squashes?.length) return scene
  const next = { ...piece }
  delete next.squashes
  return replace(scene, next)
}

/**
 * A cut splits one piece into two independent pieces — each keeps the same
 * colour, squashes and angle, and takes opposite sides of the cut.
 *
 * `separation` is the direction to nudge the halves apart, in scene space. The
 * cut's own normal lives in the piece's frame, which points somewhere else
 * entirely once the piece has been turned or crushed, so the caller passes the
 * direction it drew on screen.
 */
export function splitPiece(
  scene: Scene,
  id: string,
  cut: Cut,
  newId: string,
  separation?: { x: number; y: number },
): Scene {
  const piece = find(scene, id)
  if (!piece) return scene

  const existing = piece.cuts ?? []
  // Out of cuts, or no room for the second half: leave the piece whole rather
  // than half-applying the slice.
  if (existing.length >= MAX_CUTS_PER_PIECE) return scene
  // Slicing a combo copies everything in it, so the cost is what it holds.
  if (sceneLeafCount(scene) + leafCount(piece) > MAX_PIECES) return scene

  // Enough that the two halves visibly separate — otherwise a clean cut looks
  // like nothing happened — without flinging them apart.
  const nudge = 45 * piece.scale
  const direction = normalize(separation ?? { x: cut.nx, y: cut.ny })

  const keep = nudged(recentre(piece, [...existing, cut]), direction, -nudge)
  const offcut = nudged(
    { ...recentre(piece, [...existing, invertCut(cut)]), id: newId, z: piece.z + 1 },
    direction,
    nudge,
  )

  return { ...scene, pieces: [...scene.pieces.map((p) => (p.id === id ? keep : p)), offcut] }
}

export function setBackground(scene: Scene, color: string): Scene {
  return { ...scene, bg: color }
}

/**
 * Applies a new set of cuts and moves the piece's origin to the middle of
 * whatever survives them, without the piece appearing to move.
 *
 * Both halves of a slice need this. Left on the original sprite's centre, a
 * thin offcut would turn and crush about a point outside itself, and its
 * selection ring and handle would float in empty space beside it.
 */
function recentre(piece: SceneNode, cuts: Cut[]): SceneNode {
  const box = localBox(piece)
  if (box.width === 0 || box.height === 0) return { ...piece, cuts }

  const polygon = clipPolygon(box.width, box.height, cuts)
  // Nothing left of this side; leave the origin alone rather than divide by it.
  if (polygon.length === 0) return { ...piece, cuts }

  const pivot = polygonCentroid(polygon)
  const previous = piece.pivot ?? { x: 0, y: 0 }

  // Shifting the origin would slide the artwork, so cancel it out: the offset
  // travels through the piece's own scale, rotation and squashes to reach the
  // scene.
  const shift = apply(pieceMatrix(piece), {
    x: pivot.x - previous.x,
    y: pivot.y - previous.y,
  })

  return { ...piece, cuts, pivot, x: piece.x + shift.x, y: piece.y + shift.y }
}

function nudged(piece: SceneNode, direction: { x: number; y: number }, amount: number): SceneNode {
  return { ...piece, x: piece.x + direction.x * amount, y: piece.y + direction.y * amount }
}

function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(v.x, v.y)
  return length < 1e-6 ? { x: 1, y: 0 } : { x: v.x / length, y: v.y / length }
}

function find(scene: Scene, id: string): SceneNode | undefined {
  return scene.pieces.find((piece) => piece.id === id)
}

function replace(scene: Scene, piece: SceneNode): Scene {
  return { ...scene, pieces: scene.pieces.map((p) => (p.id === piece.id ? piece : p)) }
}

/**
 * Undo history. Bounded because a phone holding every intermediate drag state
 * would grow without limit over a long round.
 */
export const MAX_HISTORY = 30

export interface History {
  past: Scene[]
  present: Scene
}

export function pushHistory(history: History, next: Scene): History {
  if (next === history.present) return history
  const past = [...history.past, history.present].slice(-MAX_HISTORY)
  return { past, present: next }
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1]
  if (!previous) return history
  return { past: history.past.slice(0, -1), present: previous }
}

export function canUndo(history: History): boolean {
  return history.past.length > 0
}


/**
 * Makes one thing out of two.
 *
 * Adding to something that is already a combo grows it rather than wrapping it
 * again: "keep adding parts" should build one object, not a stack of shells
 * each holding the last. Wrapping only happens when there is nothing to grow.
 *
 * The new member takes the combo's z, since a combo is drawn as one and its
 * parts no longer sit separately in the picture's stacking.
 */
export function groupPieces(scene: Scene, intoId: string, addId: string, newId: string): Scene {
  if (intoId === addId) return scene
  const into = find(scene, intoId)
  const adding = find(scene, addId)
  if (!into || !adding) return scene

  const combo = isCombo(into) ? addToCombo(into, adding) : makeCombo([into, adding], newId)
  const dropped = scene.pieces.filter((node) => node.id !== intoId && node.id !== addId)
  return { ...scene, pieces: [...dropped, combo] }
}

/** Sprites in the whole picture, which is what the piece limit counts. */
export function sceneLeafCount(scene: Scene): number {
  return scene.pieces.reduce((sum, node) => sum + leafCount(node), 0)
}
