import type Konva from 'konva'
import type { ReactNode, Ref } from 'react'
import { Group, Image as KonvaImage, Layer, Rect, Stage } from 'react-konva'

import { DESIGN_SIZE, type Placed, type Scene } from '../shared/scene'
import { clipPolygon } from './clip'
import { paletteColor } from './palette'
import { getImage, getPiece } from './pieces'
import { tinted } from './tint'

interface Props {
  scene: Scene
  /** Rendered size in CSS pixels; the scene is always authored at DESIGN_SIZE. */
  size: number
  /** Interactive editors pass handlers; read-only displays leave these off. */
  onSelect?: (id: string | null) => void
  /** Off while slicing, so a cut drag isn't swallowed by a piece drag. */
  draggable?: boolean
  onPieceChange?: (id: string, changes: Partial<Placed>) => void
  /** Lets the editor map pointer positions into a piece's local space. */
  stageRef?: Ref<Konva.Stage>
  /** Editor overlays (selection transformer, slice guide) draw on top. */
  children?: ReactNode
}

/**
 * The one renderer for a Scene.
 *
 * The phone editor wraps this with gestures and a selection outline; the host
 * renders it read-only and much larger. Sharing the implementation is what
 * guarantees a player's preview matches what the room sees — two renderers
 * would inevitably drift.
 */
export function SceneView({
  scene,
  size,
  onSelect,
  draggable = false,
  onPieceChange,
  stageRef,
  children,
}: Props) {
  const scale = size / DESIGN_SIZE
  const interactive = Boolean(onSelect)

  return (
    <Stage
      ref={stageRef}
      width={size}
      height={size}
      scaleX={scale}
      scaleY={scale}
      // Tapping bare canvas clears the selection.
      onMouseDown={(e) => interactive && e.target === e.target.getStage() && onSelect?.(null)}
      onTouchStart={(e) => interactive && e.target === e.target.getStage() && onSelect?.(null)}
      style={{ touchAction: 'none' }}
    >
      <Layer listening={interactive}>
        <Rect
          x={0}
          y={0}
          width={DESIGN_SIZE}
          height={DESIGN_SIZE}
          fill={scene.bg === undefined ? '#ffffff' : paletteColor(scene.bg)}
          listening={false}
        />
        {[...scene.pieces]
          .sort((a, b) => a.z - b.z)
          .map((piece) => (
            <PieceNode
              key={piece.id}
              piece={piece}
              interactive={interactive}
              draggable={draggable}
              onSelect={onSelect}
              onPieceChange={onPieceChange}
            />
          ))}
        {children}
      </Layer>
    </Stage>
  )
}

interface PieceProps {
  piece: Placed
  interactive: boolean
  draggable: boolean
  onSelect?: (id: string | null) => void
  onPieceChange?: (id: string, changes: Partial<Placed>) => void
}

function PieceNode({ piece, interactive, draggable, onSelect, onPieceChange }: PieceProps) {
  const def = getPiece(piece.pieceId)
  const image = getImage(piece.pieceId)
  // A sprite that failed to load is skipped rather than drawn as a blank box.
  if (!def || !image) return null

  const source = tinted(piece.pieceId, image, piece.tint)
  const clip = clipPolygon(def.width, def.height, piece.cuts)
  // Every cut removed the piece entirely.
  if (clip.length === 0) return null

  const hasCuts = Boolean(piece.cuts?.length)

  return (
    <Group
      id={piece.id}
      name="piece"
      x={piece.x}
      y={piece.y}
      rotation={(piece.rotation * 180) / Math.PI}
      scaleX={piece.scaleX * (piece.flipX ? -1 : 1)}
      scaleY={piece.scaleY}
      listening={interactive}
      draggable={draggable}
      onMouseDown={() => onSelect?.(piece.id)}
      onTouchStart={() => onSelect?.(piece.id)}
      onDragEnd={(e) => onPieceChange?.(piece.id, { x: e.target.x(), y: e.target.y() })}
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
        width={def.width}
        height={def.height}
        offsetX={def.width / 2}
        offsetY={def.height / 2}
      />
    </Group>
  )
}
