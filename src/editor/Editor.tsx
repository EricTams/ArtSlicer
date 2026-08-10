import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Circle, Line } from 'react-konva'

import { pieceAt } from '../render/hitTest'
import { HANDLE_DRAW_RADIUS, handlePosition } from './handle'
import { SceneView } from '../render/SceneView'
import type { Cut, Placed, Scene, Squash } from '../shared/scene'
import { MAX_CUTS_PER_PIECE, MAX_PIECES, emptyScene } from '../shared/scene'
import { PartsTray } from './PartsTray'
import { isOverCanvas, toScene } from './canvasCoords'
import { EMPTY_JAR, type Jar } from './paint'
import {
  type History,
  addPiece,
  addSquash,
  canRestack,
  canUndo,
  movePiece,
  pushHistory,
  removePiece,
  restackPiece,
  splitPiece,
  sprayPiece,
  transformPiece,
  undo,
} from './sceneEdit'
import { ColorTool } from './tools/ColorTool'
import { SliceTool } from './tools/SliceTool'
import { SquishTool } from './tools/SquishTool'
import { useCanvasGestures } from './useCanvasGestures'

interface Props {
  initialScene?: Scene
  /** Shown inset in the picture's own corner, so it stays with what you're making. */
  prompt?: string
  onChange?(scene: Scene): void
}

type Screen = 'canvas' | 'colour' | 'squish' | 'slice'

/**
 * Phone-first build screen: your picture, and a parts bin. Everything you do
 * to a piece happens in its own full-screen tool, so each one can stay a
 * single physical action instead of a panel of controls.
 */
export function Editor({ initialScene, prompt, onChange }: Props) {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: initialScene ?? emptyScene(),
  }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('canvas')
  const [trayOpen, setTrayOpen] = useState(false)
  // Mixed paint outlives the tool, so colouring several pieces the same shade
  // doesn't mean mixing it again each time.
  const [jar, setJar] = useState<Jar>(EMPTY_JAR)

  const scene = history.present
  const selected = scene.pieces.find((piece) => piece.id === selectedId) ?? null

  const commit = useCallback((next: Scene) => {
    setHistory((current) => pushHistory(current, next))
  }, [])

  /** Drags emit continuously; they must not each become an undo step. */
  const live = useCallback((next: Scene) => {
    setHistory((current) => ({ ...current, present: next }))
  }, [])

  useEffect(() => {
    onChange?.(scene)
  }, [scene, onChange])

  const { element: canvasElement, setElement: setCanvasElement, size } = useSquareSize()
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  const selectedRef = useRef(selected)
  selectedRef.current = selected

  useCanvasGestures(
    canvasElement,
    size,
    useCallback((x: number, y: number) => pieceAt(sceneRef.current, x, y), []),
    useCallback(() => selectedRef.current, []),
    {
      onMove: useCallback((id, x, y) => live(movePiece(sceneRef.current, id, x, y)), [live]),
      onTransform: useCallback(
        (id, scale, rotation) => live(transformPiece(sceneRef.current, id, scale, rotation)),
        [live],
      ),
      onTap: useCallback((id: string) => setSelectedId(id), []),
      onTapEmpty: useCallback(() => setSelectedId(null), []),
      onDragOut: useCallback(
        (id: string, origin: { x: number; y: number }) => {
          // Put the piece back where the drag started before binning it. The
          // drag itself only ever touched the live scene, so without this the
          // step undo restores is the piece halfway off the picture.
          const restored = movePiece(sceneRef.current, id, origin.x, origin.y)
          live(restored)
          commit(removePiece(restored, id))
          setSelectedId(null)
        },
        [live, commit],
      ),
    },
  )

  const full = scene.pieces.length >= MAX_PIECES

  const place = useCallback(
    (pieceId: string, at?: { x: number; y: number }) => {
      const id = crypto.randomUUID().slice(0, 8)
      commit(addPiece(sceneRef.current, pieceId, id, at))
      setSelectedId(id)
    },
    [commit],
  )

  const canvasRef = useRef(canvasElement)
  canvasRef.current = canvasElement
  const sizeRef = useRef(size)
  sizeRef.current = size

  const dropPiece = useCallback(
    (pieceId: string, clientX: number, clientY: number) => {
      const element = canvasRef.current
      if (!element) return
      place(pieceId, toScene(element, sizeRef.current, clientX, clientY))
    },
    [place],
  )

  const canDropAt = useCallback(
    (clientX: number, clientY: number) =>
      !!canvasRef.current && isOverCanvas(canvasRef.current, clientX, clientY),
    [],
  )

  return (
    <>
      <div className="make">
        <div className="make__canvas" ref={setCanvasElement}>
          {size > 0 && (
            <div className="make__stage" style={{ width: size, height: size }}>
              <SceneView scene={scene} size={size}>
                {selected && <SelectionRing piece={selected} />}
              </SceneView>
              {/* Sits over the picture but takes no pointer events, so a drag
                  that starts on it still reaches the canvas underneath. */}
              {prompt && <p className="make__label">make: {prompt}</p>}
            </div>
          )}
        </div>

        {/* Both rows stay mounted whatever is selected. Swapping the tools for
            the hint changes the column's height, and the canvas is the flexible
            track above it, so it would resize under the player mid-gesture. */}
        <p className="make__hint">
          {scene.pieces.length === 0
            ? 'Open the parts bin to grab something.'
            : 'Drag to move · tap a piece for tools · drag its dot to size and turn'}
        </p>

        <div className="make__tools">
          <ToolButton
            glyph="🎨"
            label="Colour"
            disabled={!selected}
            onClick={() => setScreen('colour')}
          />
          <ToolButton
            glyph="🗜️"
            label="Squish"
            disabled={!selected}
            onClick={() => setScreen('squish')}
          />
          <ToolButton
            glyph="🔪"
            label="Slice"
            disabled={!selected}
            onClick={() => setScreen('slice')}
          />
          {/* Acts on the picture straight away rather than opening a tool: one
              step through the draw order per press. */}
          <div className="order" aria-label="Draw order">
            <div className="order__arrows">
              <button
                type="button"
                className="order__arrow"
                aria-label="Bring forward"
                disabled={!selected || !canRestack(scene, selected.id, 1)}
                onClick={() => selected && commit(restackPiece(scene, selected.id, 1))}
              >
                ▲
              </button>
              <button
                type="button"
                className="order__arrow"
                aria-label="Send back"
                disabled={!selected || !canRestack(scene, selected.id, -1)}
                onClick={() => selected && commit(restackPiece(scene, selected.id, -1))}
              >
                ▼
              </button>
            </div>
            <span className="order__label">Order</span>
          </div>
          <ToolButton
            glyph="🗑"
            label="Bin it"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              commit(removePiece(scene, selected.id))
              setSelectedId(null)
            }}
          />
        </div>

        <div className="make__bottom">
          <button
            type="button"
            className="btn btn--ghost make__undo"
            disabled={!canUndo(history)}
            onClick={() => setHistory(undo(history))}
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn make__bin"
            aria-expanded={trayOpen}
            onClick={() => setTrayOpen((open) => !open)}
          >
            Parts bin{full ? ' (full)' : ''}
          </button>
        </div>

        {trayOpen && (
          <PartsTray
            full={full}
            onClose={() => setTrayOpen(false)}
            onAdd={place}
            onDrop={dropPiece}
            canDropAt={canDropAt}
          />
        )}
      </div>

      {/* Tools layer over the canvas rather than replacing it. Unmounting the
          canvas would tear down the Konva stage and leave the resize observer
          and gesture listeners bound to a detached node. */}
      {selected && screen === 'colour' && (
        <ColorTool
          piece={selected}
          jar={jar}
          onJarChange={setJar}
          // Paint lands as it is sprayed; the whole hold becomes one undo step
          // rather than one per animation frame.
          onSpray={(color, delta) => live(sprayPiece(sceneRef.current, selected.id, color, delta))}
          onSprayEnd={() => commit(sceneRef.current)}
          onClose={() => setScreen('canvas')}
        />
      )}

      {selected && screen === 'squish' && (
        <SquishTool
          piece={selected}
          onSqueeze={(squash: Squash) => commit(addSquash(sceneRef.current, selected.id, squash))}
          onClose={() => setScreen('canvas')}
        />
      )}

      {selected && screen === 'slice' && (
        <SliceTool
          piece={selected}
          canSlice={!full && (selected.cuts?.length ?? 0) < MAX_CUTS_PER_PIECE}
          onCut={(cut: Cut, separation) => {
            commit(
              splitPiece(
                sceneRef.current,
                selected.id,
                cut,
                crypto.randomUUID().slice(0, 8),
                separation,
              ),
            )
            setScreen('canvas')
          }}
          onClose={() => setScreen('canvas')}
        />
      )}
    </>
  )
}

/**
 * A soft marker so it's obvious which piece the tools will act on. Drawn as a
 * ring around the piece's centre rather than a bounding box, because a sliced
 * and squashed piece has no meaningful box.
 */
function SelectionRing({ piece }: { piece: Placed }) {
  const handle = handlePosition(piece)

  return (
    <>
      <Circle
        x={piece.x}
        y={piece.y}
        radius={30}
        stroke="#ff4d8d"
        strokeWidth={7}
        dash={[18, 12]}
        listening={false}
      />
      {/* Tether, so it reads as attached to the piece rather than floating. */}
      <Line
        points={[piece.x, piece.y, handle.x, handle.y]}
        stroke="#ff4d8d"
        strokeWidth={5}
        dash={[14, 10]}
        listening={false}
      />
      {/* Drag this to size and turn the piece — the only way to do either
          with a mouse, which has just one pointer. */}
      <Circle
        x={handle.x}
        y={handle.y}
        radius={HANDLE_DRAW_RADIUS}
        fill="#ff4d8d"
        stroke="#ffffff"
        strokeWidth={6}
        listening={false}
      />
    </>
  )
}

function ToolButton({
  glyph,
  label,
  disabled,
  onClick,
}: {
  glyph: string
  label: string
  disabled: boolean
  onClick(): void
}) {
  return (
    <button type="button" className="bigtool" disabled={disabled} onClick={onClick}>
      <span className="bigtool__glyph">{glyph}</span>
      <span className="bigtool__label">{label}</span>
    </button>
  )
}

/**
 * The canvas is square and as large as the space allows.
 *
 * Measures once directly, then observes. Waiting for the observer alone is not
 * enough: its callbacks ride the rendering steps, which are paused while a tab
 * is hidden, so an editor mounted in the background would sit at zero and draw
 * nothing until something happened to resize it.
 *
 * Re-runs whenever the element identity changes rather than only on mount —
 * observing a node that has since been replaced silently reports zero too.
 */
function useSquareSize() {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState(0)

  useLayoutEffect(() => {
    if (!element) return

    const measure = (): void => {
      const box = element.getBoundingClientRect()
      setSize(Math.floor(Math.min(box.width, box.height)))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return { element, setElement, size }
}
