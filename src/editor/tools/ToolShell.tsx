import type { ReactNode } from 'react'
import { Layer, Stage } from 'react-konva'

import { PieceNode } from '../../render/PieceView'
import { DESIGN_SIZE, type Placed, type Squash } from '../../shared/scene'

/**
 * Full-screen chrome shared by every tool: a title and a way back.
 *
 * There is deliberately no confirm step. Tools change the piece as you use
 * them, exactly like the physical actions they imitate, and the canvas's undo
 * covers a change of mind — asking "keep this?" after every squeeze or cut put
 * a decision between the player and the next thing they wanted to do.
 */
export function ToolShell({
  title,
  hint,
  onClose,
  children,
}: {
  title: string
  hint?: string
  onClose(): void
  children: ReactNode
}) {
  return (
    <div className="tool2">
      <header className="tool2__head">
        <span className="tool2__spacer" aria-hidden="true" />
        <h2 className="tool2__title">{title}</h2>
        <button type="button" className="tool2__done" onClick={onClose}>
          Done
        </button>
      </header>
      {hint && <p className="tool2__hint">{hint}</p>}
      <div className="tool2__body">{children}</div>
    </div>
  )
}

/**
 * Any number of pieces at their own positions, drawn with the real renderer so
 * a tool's preview is the actual result rather than an approximation of it.
 */
export function PieceStage({
  pieces,
  size,
  rotation,
  extraSquashes,
}: {
  pieces: readonly Placed[]
  size: number
  /** Overrides each piece's own angle, for tools that turn it while previewing. */
  rotation?: number
  /** Not yet committed, so a tool can preview what it is about to apply. */
  extraSquashes?: readonly Squash[]
}) {
  const scale = size / DESIGN_SIZE

  return (
    <Stage width={size} height={size} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        {pieces.map((piece) => (
          <PieceNode
            key={piece.id}
            piece={piece}
            overrideRotation={rotation}
            extraSquashes={extraSquashes}
          />
        ))}
      </Layer>
    </Stage>
  )
}

/** The common case: one piece, centred. */
export function PiecePreview({
  piece,
  size,
  rotation,
  extraSquashes,
}: {
  piece: Placed
  size: number
  rotation?: number
  extraSquashes?: readonly Squash[]
}) {
  const centred: Placed = { ...piece, x: DESIGN_SIZE / 2, y: DESIGN_SIZE / 2 }
  return (
    <PieceStage pieces={[centred]} size={size} rotation={rotation} extraSquashes={extraSquashes} />
  )
}
