import type { ReactNode } from 'react'
import { Layer, Stage } from 'react-konva'

import { PieceNode } from '../../render/PieceView'
import { DESIGN_SIZE, type Placed, type Squash } from '../../shared/scene'

/** Full-screen chrome shared by every tool: a title, a way out, and a done. */
export function ToolShell({
  title,
  hint,
  onCancel,
  onDone,
  doneLabel = 'Done',
  children,
}: {
  title: string
  hint?: string
  onCancel(): void
  onDone(): void
  doneLabel?: string
  children: ReactNode
}) {
  return (
    <div className="tool2">
      <header className="tool2__head">
        <button type="button" className="tool2__back" onClick={onCancel} aria-label="Cancel">
          ✕
        </button>
        <h2 className="tool2__title">{title}</h2>
        <button type="button" className="tool2__done" onClick={onDone}>
          {doneLabel}
        </button>
      </header>
      {hint && <p className="tool2__hint">{hint}</p>}
      <div className="tool2__body">{children}</div>
    </div>
  )
}

/**
 * One piece, centred, drawn with the real renderer so a tool's preview is the
 * actual result rather than an approximation of it.
 */
export function PiecePreview({
  piece,
  size,
  rotation,
  extraSquashes,
}: {
  piece: Placed
  size: number
  /** Overrides the piece's own angle — the squish tool spins it to aim. */
  rotation?: number
  /** Not yet committed, so a tool can preview what it is about to apply. */
  extraSquashes?: readonly Squash[]
}) {
  const centred: Placed = { ...piece, x: DESIGN_SIZE / 2, y: DESIGN_SIZE / 2 }
  const scale = size / DESIGN_SIZE

  return (
    <Stage width={size} height={size} scaleX={scale} scaleY={scale} listening={false}>
      <Layer listening={false}>
        <PieceNode piece={centred} overrideRotation={rotation} extraSquashes={extraSquashes} />
      </Layer>
    </Stage>
  )
}
