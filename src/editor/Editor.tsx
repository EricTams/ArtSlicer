import type Konva from 'konva'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type Point, cutFromLine } from '../render/clip'
import { PALETTE, paletteColor } from '../render/palette'
import { SceneView } from '../render/SceneView'
import { MAX_CUTS_PER_PIECE, MAX_PIECES, type Placed, type Scene, emptyScene } from '../shared/scene'
import { PieceTray } from './PieceTray'
import { SelectionTransformer } from './SelectionTransformer'
import { SliceOverlay } from './SliceOverlay'
import {
  type History,
  addCut,
  addPiece,
  bringToFront,
  canUndo,
  clearCuts,
  flipPiece,
  pushHistory,
  removePiece,
  sendToBack,
  setBackground,
  setPieceTint,
  undo,
  updatePiece,
} from './sceneEdit'

interface Props {
  initialScene?: Scene
  onChange?(scene: Scene): void
}

type Mode = 'move' | 'slice'

/** Whether the palette is recolouring the selected piece or the backdrop. */
type PaintTarget = 'piece' | 'background'

export function Editor({ initialScene, onChange }: Props) {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: initialScene ?? emptyScene(),
  }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('move')
  const [paintTarget, setPaintTarget] = useState<PaintTarget>('piece')
  const [slice, setSlice] = useState<{ from: Point; to: Point } | null>(null)
  const stageRef = useRef<Konva.Stage>(null)

  const scene = history.present
  const selected = scene.pieces.find((piece) => piece.id === selectedId) ?? null

  const commit = useCallback((next: Scene) => {
    setHistory((current) => pushHistory(current, next))
  }, [])

  useEffect(() => {
    onChange?.(scene)
  }, [scene, onChange])

  // Leaving slice mode whenever the selection goes away keeps the two modes
  // from getting out of sync with what the toolbar shows.
  useEffect(() => {
    if (!selected) setMode('move')
  }, [selected])

  const { ref: canvasRef, size } = useSquareSize()

  const handleAdd = useCallback(
    (pieceId: string) => {
      const id = crypto.randomUUID().slice(0, 8)
      commit(addPiece(scene, pieceId, id))
      setSelectedId(id)
    },
    [commit, scene],
  )

  const handlePieceChange = useCallback(
    (id: string, changes: Partial<Placed>) => commit(updatePiece(scene, id, changes)),
    [commit, scene],
  )

  const sliceHandlers = useSliceGesture({
    active: mode === 'slice' && Boolean(selected),
    selectedId,
    stageRef,
    onPreview: setSlice,
    onCommit: (cut) => {
      if (!selectedId) return
      commit(addCut(scene, selectedId, cut))
      setSlice(null)
      setMode('move')
    },
  })

  const full = scene.pieces.length >= MAX_PIECES
  const cutsUsed = selected?.cuts?.length ?? 0

  return (
    <div className="editor">
      <div className="editor__canvas" ref={canvasRef} {...sliceHandlers}>
        {size > 0 && (
          <SceneView
            scene={scene}
            size={size}
            stageRef={stageRef}
            // In slice mode the canvas must not react to taps at all: a press
            // on bare canvas would otherwise clear the selection and cancel
            // the very cut being drawn. Dropping the handler also stops Konva
            // listening, so the slice gesture gets the raw pointer events.
            onSelect={mode === 'move' ? setSelectedId : undefined}
            draggable={mode === 'move'}
            onPieceChange={handlePieceChange}
          >
            {mode === 'move' && (
              <SelectionTransformer
                selectedId={selectedId}
                flipX={Boolean(selected?.flipX)}
                onChange={handlePieceChange}
              />
            )}
            {slice && <SliceOverlay from={slice.from} to={slice.to} />}
          </SceneView>
        )}
      </div>

      <div className="editor__tools">
        <ToolButton
          label="Undo"
          glyph="↶"
          disabled={!canUndo(history)}
          onClick={() => setHistory(undo(history))}
        />
        <ToolButton
          label="Flip"
          glyph="⇄"
          disabled={!selected}
          onClick={() => selected && commit(flipPiece(scene, selected.id))}
        />
        <ToolButton
          label="Front"
          glyph="⬆"
          disabled={!selected}
          onClick={() => selected && commit(bringToFront(scene, selected.id))}
        />
        <ToolButton
          label="Back"
          glyph="⬇"
          disabled={!selected}
          onClick={() => selected && commit(sendToBack(scene, selected.id))}
        />
        <ToolButton
          label={cutsUsed ? `Slice ${cutsUsed}/${MAX_CUTS_PER_PIECE}` : 'Slice'}
          glyph="✂"
          on={mode === 'slice'}
          disabled={!selected || cutsUsed >= MAX_CUTS_PER_PIECE}
          onClick={() => setMode(mode === 'slice' ? 'move' : 'slice')}
        />
        <ToolButton
          label="Unslice"
          glyph="⟲"
          disabled={!selected || cutsUsed === 0}
          onClick={() => selected && commit(clearCuts(scene, selected.id))}
        />
        <ToolButton
          label="Delete"
          glyph="🗑"
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            commit(removePiece(scene, selected.id))
            setSelectedId(null)
          }}
        />
      </div>

      {mode === 'slice' && (
        <p className="editor__hint">Drag across the piece — the side you start on is cut away.</p>
      )}

      <div className="editor__paint">
        <div className="editor__painttabs">
          <button
            type="button"
            className={`chip${paintTarget === 'piece' ? ' chip--on' : ''}`}
            onClick={() => setPaintTarget('piece')}
          >
            Piece
          </button>
          <button
            type="button"
            className={`chip${paintTarget === 'background' ? ' chip--on' : ''}`}
            onClick={() => setPaintTarget('background')}
          >
            Background
          </button>
        </div>
        <div className="swatches">
          {PALETTE.map((color, index) => {
            const active =
              paintTarget === 'piece'
                ? (selected?.tint ?? 0) === index
                : (scene.bg ?? 0) === index
            return (
              <button
                key={color}
                type="button"
                className={`swatch${active ? ' swatch--on' : ''}`}
                style={{ background: paletteColor(index) }}
                disabled={paintTarget === 'piece' && !selected}
                aria-label={`Colour ${index}`}
                onClick={() =>
                  paintTarget === 'piece'
                    ? selected && commit(setPieceTint(scene, selected.id, index))
                    : commit(setBackground(scene, index))
                }
              />
            )
          })}
        </div>
      </div>

      <PieceTray onAdd={handleAdd} disabled={full} />
      {full && <p className="editor__hint">That is all {MAX_PIECES} pieces — delete one to add another.</p>}
    </div>
  )
}

function ToolButton({
  label,
  glyph,
  onClick,
  disabled,
  on,
}: {
  label: string
  glyph: string
  onClick(): void
  disabled?: boolean
  on?: boolean
}) {
  return (
    <button
      type="button"
      className={`tool${on ? ' tool--on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className="tool__glyph">{glyph}</span>
      <span className="tool__label">{label}</span>
    </button>
  )
}

/** The canvas is square and as large as the space allows. */
function useSquareSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box) setSize(Math.floor(Math.min(box.width, box.height)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, size }
}

/**
 * Turns a drag across the canvas into a cut in the selected piece's local
 * space. Working in local space means the cut follows the piece when it is
 * later moved, rotated, or scaled.
 */
function useSliceGesture({
  active,
  selectedId,
  stageRef,
  onPreview,
  onCommit,
}: {
  active: boolean
  selectedId: string | null
  stageRef: RefObject<Konva.Stage | null>
  onPreview(line: { from: Point; to: Point } | null): void
  onCommit(cut: { nx: number; ny: number; d: number }): void
}) {
  const start = useRef<{ design: Point; local: Point } | null>(null)

  const locate = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): { design: Point; local: Point } | null => {
      const stage = stageRef.current
      if (!stage || !selectedId) return null

      const rect = event.currentTarget.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }

      const node = stage.findOne(`#${selectedId}`)
      if (!node) return null

      // Inverting the node's absolute transform undoes the stage scale and the
      // piece's own translate/rotate/scale/flip in one step.
      const local = node.getAbsoluteTransform().copy().invert().point(screen)
      const scale = stage.scaleX() || 1
      return { design: { x: screen.x / scale, y: screen.y / scale }, local }
    },
    [selectedId, stageRef],
  )

  const memo = useMemo(
    () => ({
      onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (!active) return
        const point = locate(event)
        if (!point) return
        start.current = point
        onPreview({ from: point.design, to: point.design })
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (!active || !start.current) return
        const point = locate(event)
        if (point) onPreview({ from: start.current.design, to: point.design })
      },
      onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
        if (!active || !start.current) return
        const from = start.current
        start.current = null
        const point = locate(event)
        onPreview(null)
        if (!point) return

        const cut = cutFromLine(from.local, point.local)
        if (cut) onCommit(cut)
      },
    }),
    [active, locate, onPreview, onCommit],
  )

  return active ? memo : {}
}

