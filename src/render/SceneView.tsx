import type Konva from 'konva'
import type { ReactNode, Ref } from 'react'
import { Layer, Rect, Stage } from 'react-konva'

import { DESIGN_SIZE, type Scene } from '../shared/scene'
import { PieceNode } from './PieceView'

interface Props {
  scene: Scene
  /** Rendered size in CSS pixels; the scene is always authored at DESIGN_SIZE. */
  size: number
  /** Interactive canvases pass handlers; read-only displays leave these off. */
  onSelect?: (id: string) => void
  onPieceMove?: (id: string, x: number, y: number) => void
  draggable?: boolean
  stageRef?: Ref<Konva.Stage>
  children?: ReactNode
}

/**
 * The one renderer for a Scene.
 *
 * The phone's canvas wraps it with gestures; the host renders it read-only and
 * much larger. Sharing the implementation is what guarantees a player's
 * preview matches what the room sees — two renderers would inevitably drift.
 */
export function SceneView({
  scene,
  size,
  onSelect,
  onPieceMove,
  draggable = false,
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
      style={{ touchAction: 'none' }}
    >
      <Layer listening={interactive}>
        <Rect
          x={0}
          y={0}
          width={DESIGN_SIZE}
          height={DESIGN_SIZE}
          fill={scene.bg ?? '#ffffff'}
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
              onDragEnd={onPieceMove}
            />
          ))}
        {children}
      </Layer>
    </Stage>
  )
}
