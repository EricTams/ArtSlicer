import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Circle, Line } from 'react-konva'

import { pieceAt } from '../render/hitTest'
import { HANDLE_DRAW_RADIUS, handlePosition } from './handle'
import { SceneView } from '../render/SceneView'
import type { Cut, Placed, Scene, Squash } from '../shared/scene'
import { MAX_PIECES, emptyScene } from '../shared/scene'
import { PartsBin } from './PartsBin'
import { EMPTY_JAR, type Jar } from './paint'
import {
  type History,
  addPiece,
  addSquash,
  canUndo,
  movePiece,
  pushHistory,
  removePiece,
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
  onChange?(scene: Scene): void
}

type Screen = 'canvas' | 'bin' | 'colour' | 'squish' | 'slice'

/**
 * Phone-first build screen: your picture, and a parts bin. Everything you do
 * to a piece happens in its own full-screen tool, so each one can stay a
 * single physical action instead of a panel of controls.
 */
export function Editor({ initialScene, onChange }: Props) {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: initialScene ?? emptyScene(),
  }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('canvas')
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
    },
  )

  const full = scene.pieces.length >= MAX_PIECES

  return (
    <>
      <div className="make">
        <div className="make__canvas" ref={setCanvasElement}>
          {size > 0 && (
            <SceneView scene={scene} size={size}>
              {selected && <SelectionRing piece={selected} />}
            </SceneView>
          )}
        </div>

        {selected ? (
          <div className="make__tools">
            <ToolButton glyph="🎨" label="Colour" onClick={() => setScreen('colour')} />
            <ToolButton glyph="🗜️" label="Squish" onClick={() => setScreen('squish')} />
            <ToolButton glyph="🔪" label="Slice" onClick={() => setScreen('slice')} />
            <ToolButton
              glyph="🗑"
              label="Bin it"
              onClick={() => {
                commit(removePiece(scene, selected.id))
                setSelectedId(null)
              }}
            />
          </div>
        ) : (
          <p className="make__hint">
            {scene.pieces.length === 0
              ? 'Open the parts bin to grab something.'
              : 'Drag to move · tap a piece for tools · drag its dot to size and turn'}
          </p>
        )}

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
          <button type="button" className="btn make__bin" onClick={() => setScreen('bin')}>
            Parts bin{full ? ' (full)' : ''}
          </button>
        </div>
      </div>

      {/* Tools layer over the canvas rather than replacing it. Unmounting the
          canvas would tear down the Konva stage and leave the resize observer
          and gesture listeners bound to a detached node. */}
      {screen === 'bin' && (
        <PartsBin
          full={full}
          onClose={() => setScreen('canvas')}
          onPick={(pieceId) => {
            const id = crypto.randomUUID().slice(0, 8)
            commit(addPiece(sceneRef.current, pieceId, id))
            setSelectedId(id)
            setScreen('canvas')
          }}
        />
      )}

      {selected && screen === 'colour' && (
        <ColorTool
          piece={selected}
          jar={jar}
          onJarChange={setJar}
          onSpray={(color, delta) => live(sprayPiece(sceneRef.current, selected.id, color, delta))}
          onDone={() => {
            // One undo step for the whole spray, not one per animation frame.
            commit(sceneRef.current)
            setScreen('canvas')
          }}
          onCancel={() => setScreen('canvas')}
        />
      )}

      {selected && screen === 'squish' && (
        <SquishTool
          piece={selected}
          onCommit={(squashes: Squash[]) => {
            // Applied one at a time so the same merging rule governs both the
            // preview inside the tool and what lands on the piece.
            let next = sceneRef.current
            for (const squash of squashes) next = addSquash(next, selected.id, squash)
            commit(next)
            setScreen('canvas')
          }}
          onCancel={() => setScreen('canvas')}
        />
      )}

      {selected && screen === 'slice' && (
        <SliceTool
          piece={selected}
          onCommit={(cut: Cut, separation) => {
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
          onCancel={() => setScreen('canvas')}
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

function ToolButton({ glyph, label, onClick }: { glyph: string; label: string; onClick(): void }) {
  return (
    <button type="button" className="bigtool" onClick={onClick}>
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
