import type { ReactNode } from 'react'
import { Group, Image as KonvaImage } from 'react-konva'

import type { Placed, Squash } from '../shared/scene'
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
        <ClippedSprite
          piece={piece}
          width={def.width}
          height={def.height}
          image={image}
          clip={clip}
        />
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
    // Crushing along the axis stretches across it, so the piece keeps roughly
    // its area rather than simply shrinking.
    const across = Math.sqrt(squash.factor)
    return (
      <Group key={`squash-${index}`} rotation={degrees}>
        <Group scaleX={across} scaleY={1 / squash.factor}>
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
