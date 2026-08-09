import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Transformer } from 'react-konva'

import type { Placed } from '../shared/scene'

interface Props {
  selectedId: string | null
  /** True when the piece is mirrored, so scale can be stored unmirrored. */
  flipX: boolean
  onChange(id: string, changes: Partial<Placed>): void
}

/**
 * Drag/scale/rotate handles for the selected piece. Attaches by looking the
 * node up in the stage, which avoids threading a ref through the shared
 * renderer just for the editor's benefit.
 */
export function SelectionTransformer({ selectedId, flipX, onChange }: Props) {
  const ref = useRef<Konva.Transformer>(null)

  useEffect(() => {
    const transformer = ref.current
    if (!transformer) return

    const stage = transformer.getStage()
    const node = selectedId ? stage?.findOne(`#${selectedId}`) : null

    transformer.nodes(node ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }, [selectedId])

  return (
    <Transformer
      ref={ref}
      // Sized for fingertips, not mouse pointers — these are pressed on a phone.
      anchorSize={28}
      anchorStroke="#ff4d8d"
      anchorFill="#ffffff"
      anchorCornerRadius={14}
      borderStroke="#ff4d8d"
      borderStrokeWidth={3}
      rotateAnchorOffset={40}
      // Corners only: edge handles are too dense to hit accurately on a phone.
      enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
      rotationSnapTolerance={7}
      onTransformEnd={(e) => {
        if (!selectedId) return
        const node = e.target
        onChange(selectedId, {
          x: node.x(),
          y: node.y(),
          // The node's scale carries the mirror; store the piece's own scale
          // so flipping stays an independent toggle.
          scaleX: node.scaleX() * (flipX ? -1 : 1),
          scaleY: node.scaleY(),
          rotation: (node.rotation() * Math.PI) / 180,
        })
      }}
    />
  )
}
