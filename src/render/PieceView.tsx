import type { ReactNode } from 'react'
import { Group, Image as KonvaImage } from 'react-konva'

import type { Placed, SceneNode, Squash } from '../shared/scene'
import { isCombo } from '../shared/scene'
import { localBox } from '../editor/combo'
import { clipPolygon } from './clip'
import { getImage, getPiece } from './pieces'
import { tinted } from './tint'

/**
 * Draws one piece. Shared by the canvas and by every tool, so what you see
 * while squishing or painting is literally the same rendering that lands in
 * the scene.
 *
 * Transform order, outermost first: place and rotate on the canvas, then
 * uniform scale, then each squash, then the sprite (clipped by its cuts).
 * Squashes nest rather than folding into scaleX/scaleY because a piece that
 * springs back upright can carry a crush along any axis, which an axis-aligned
 * scale cannot express.
 */
/**
 * One node of a scene: a sprite, or a combo holding more nodes.
 *
 * Both wear the same transform, which is the whole point — a combo turns,
 * sizes and crushes exactly as a piece does, and everything inside it comes
 * along because it is drawn inside that transform rather than beside it.
 */
export function SceneNodeView({
  node,
  interactive = false,
  draggable = false,
  onSelect,
  onDragEnd,
  overrideRotation,
  extraSquashes,
}: {
  node: SceneNode
  interactive?: boolean
  draggable?: boolean
  onSelect?: (id: string) => void
  onDragEnd?: (id: string, x: number, y: number) => void
  overrideRotation?: number
  extraSquashes?: readonly Squash[]
}) {
  if (!isCombo(node)) {
    return (
      <PieceNode
        piece={node}
        interactive={interactive}
        draggable={draggable}
        onSelect={onSelect}
        onDragEnd={onDragEnd}
        overrideRotation={overrideRotation}
        extraSquashes={extraSquashes}
      />
    )
  }

  const squashes = [...(node.squashes ?? []), ...(extraSquashes ?? [])]
  const rotation = overrideRotation ?? node.rotation

  /*
   * A slice on a combo cuts the whole thing at once, so the clip goes on the
   * group its children are drawn in rather than on each of them. The box comes
   * from what is inside, since a combo has no sprite of its own to measure,
   * and it is the same box splitPiece cut against — both sit in the space the
   * children are positioned in.
   */
  const box = localBox(node)
  const clip = clipPolygon(box.width, box.height, node.cuts)
  // Every cut removed the combo entirely.
  if (clip.length === 0) return null
  const hasCuts = Boolean(node.cuts?.length)

  return (
    <Group
      id={node.id}
      name="piece"
      x={node.x}
      y={node.y}
      rotation={(rotation * 180) / Math.PI}
      scaleX={node.scale * (node.flipX ? -1 : 1)}
      scaleY={node.scale}
      listening={interactive}
      draggable={draggable}
      onMouseDown={() => onSelect?.(node.id)}
      onTouchStart={() => onSelect?.(node.id)}
      onDragEnd={(e) => onDragEnd?.(node.id, e.target.x(), e.target.y())}
    >
      <Squashed squashes={squashes}>
        <Group
          x={-(node.pivot?.x ?? 0)}
          y={-(node.pivot?.y ?? 0)}
          // Same frame as the children's own coordinates, so the group's shift
          // carries the clip and what it clips together.
          clipFunc={
            hasCuts
              ? (ctx) => {
                  ctx.beginPath()
                  ctx.moveTo(clip[0]!.x, clip[0]!.y)
                  for (let i = 1; i < clip.length; i++) ctx.lineTo(clip[i]!.x, clip[i]!.y)
                  ctx.closePath()
                }
              : undefined
          }
        >
          {/* Children are drawn back to front among themselves; the combo as a
              whole sits at its own z among everything else. */}
          {[...node.children]
            .sort((a, b) => a.z - b.z)
            .map((child) => (
              <SceneNodeView key={child.id} node={child} interactive={false} />
            ))}
        </Group>
      </Squashed>
    </Group>
  )
}

export function PieceNode({
  piece,
  interactive = false,
  draggable = false,
  onSelect,
  onDragEnd,
  /** Applied on top of the stored transform, for tool-time previews. */
  overrideRotation,
  extraSquashes,
}: {
  piece: Placed
  interactive?: boolean
  draggable?: boolean
  onSelect?: (id: string) => void
  onDragEnd?: (id: string, x: number, y: number) => void
  overrideRotation?: number
  extraSquashes?: readonly Squash[]
}) {
  const def = getPiece(piece.pieceId)
  const image = getImage(piece.pieceId)
  // A sprite that failed to load is skipped rather than drawn as a blank box.
  if (!def || !image) return null

  const clip = clipPolygon(def.width, def.height, piece.cuts)
  // Every cut removed the piece entirely.
  if (clip.length === 0) return null

  const squashes = [...(piece.squashes ?? []), ...(extraSquashes ?? [])]

  const rotation = overrideRotation ?? piece.rotation

  return (
    <Group
      id={piece.id}
      name="piece"
      x={piece.x}
      y={piece.y}
      rotation={(rotation * 180) / Math.PI}
      scaleX={piece.scale * (piece.flipX ? -1 : 1)}
      scaleY={piece.scale}
      listening={interactive}
      draggable={draggable}
      onMouseDown={() => onSelect?.(piece.id)}
      onTouchStart={() => onSelect?.(piece.id)}
      onDragEnd={(e) => onDragEnd?.(piece.id, e.target.x(), e.target.y())}
    >
      <Squashed squashes={squashes}>
        {/* Innermost, so scaling, rotating and crushing all happen about the
            piece's own centre rather than the sprite's. */}
        <Group x={-(piece.pivot?.x ?? 0)} y={-(piece.pivot?.y ?? 0)}>
          <ClippedSprite
            piece={piece}
            width={def.width}
            height={def.height}
            image={image}
            clip={clip}
          />
        </Group>
      </Squashed>
    </Group>
  )
}

/**
 * Conjugates a scale by each squash's angle — rotate into the crush axis,
 * scale, rotate back — so the deformation happens along that axis while the
 * piece itself stays upright.
 */
function Squashed({ squashes, children }: { squashes: Squash[]; children: ReactNode }): ReactNode {
  return squashes.reduce<ReactNode>((inner, squash, index) => {
    const degrees = (squash.angle * 180) / Math.PI
    // Reciprocal scales: what the crush takes off one axis it gives back on
    // the other, so the piece keeps its area and only changes shape.
    return (
      <Group key={`squash-${index}`} rotation={degrees}>
        <Group scaleX={squash.factor} scaleY={1 / squash.factor}>
          <Group rotation={-degrees}>{inner}</Group>
        </Group>
      </Group>
    )
  }, children)
}

function ClippedSprite({
  piece,
  width,
  height,
  image,
  clip,
}: {
  piece: Placed
  width: number
  height: number
  image: HTMLImageElement
  clip: { x: number; y: number }[]
}) {
  const source = tinted(piece.pieceId, image, piece.tint)
  const hasCuts = Boolean(piece.cuts?.length)

  return (
    <Group
      // clipFunc runs per frame, so only pay for it on pieces actually sliced.
      clipFunc={
        hasCuts
          ? (ctx) => {
              ctx.beginPath()
              ctx.moveTo(clip[0]!.x, clip[0]!.y)
              for (let i = 1; i < clip.length; i++) ctx.lineTo(clip[i]!.x, clip[i]!.y)
              ctx.closePath()
            }
          : undefined
      }
    >
      <KonvaImage
        image={source}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
      />
    </Group>
  )
}
