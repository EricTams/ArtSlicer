import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Circle, Line } from 'react-konva'

import { pieceAt } from '../render/hitTest'
import { HANDLE_DRAW_RADIUS, handlePosition } from './handle'
import { SceneView } from '../render/SceneView'
import type { Cut, Scene, SceneNode, Squash } from '../shared/scene'
import { MAX_CUTS_PER_PIECE, MAX_PIECES, emptyScene } from '../shared/scene'
import { PartsTray } from './PartsTray'
import { randomUUID } from '../shared/randomId'
import { readTap } from './combo'
import { isOverCanvas, toScene } from './canvasCoords'
import { EMPTY_JAR, type Jar } from './paint'
import {
  type History,
  addPiece,
  addSquash,
  canRestack,
  canUndo,
  flipPiece,
  groupPieces,
  movePiece,
  pushHistory,
  removePiece,
  restackPiece,
  sceneLeafCount,
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
  /**
   * The screen's own action, sat in the row beside the parts bin rather than
   * given a line of its own. A whole row for one button is a row the picture
   * does not get, and on a short screen that is the difference the picture
   * notices most.
   */
  action?: ReactNode
}

type Screen = 'canvas' | 'colour' | 'squish' | 'slice'

/**
 * Phone-first build screen: your picture, and a parts bin. Everything you do
 * to a piece happens in its own full-screen tool, so each one can stay a
 * single physical action instead of a panel of controls.
 */
export function Editor({ initialScene, prompt, onChange, action }: Props) {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: initialScene ?? emptyScene(),
  }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('canvas')
  const [trayOpen, setTrayOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  /**
   * Waiting for the second piece. Grouping needs two, and the canvas only ever
   * has one selection, so the tool arms and the next tap says what joins.
   */
  const [grouping, setGrouping] = useState(false)
  // Mixed paint outlives the tool, so colouring several pieces the same shade
  // doesn't mean mixing it again each time.
  const [jar, setJar] = useState<Jar>(EMPTY_JAR)

  /*
   * Every tool in the drawer needs a selection, so losing one empties it.
   * Closing it outright rather than hiding it keeps the next tap on a piece
   * from popping a drawer the player did not ask for.
   */
  useEffect(() => {
    if (!selectedId) setToolsOpen(false)
  }, [selectedId])

  /** Colour, Squish and Slice each take over the screen; the drawer goes. */
  const openTool = useCallback((next: Screen) => {
    setToolsOpen(false)
    setScreen(next)
  }, [])

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
      onTap: useCallback(
        (id: string) => {
          const fresh = randomUUID().slice(0, 8)
          const tap = readTap(sceneRef.current, selectedRef.current?.id ?? null, id, fresh, grouping)

          setGrouping(false)
          if (tap.action === 'group') {
            commit(groupPieces(sceneRef.current, tap.into, tap.add, fresh))
            // The combo is what is in hand now, so the next thing acts on it.
            setSelectedId(tap.comboId)
            return
          }
          setSelectedId(tap.id)
        },
        [grouping, commit],
      ),
      onTapEmpty: useCallback(() => {
        setGrouping(false)
        setSelectedId(null)
      }, []),
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

  const full = sceneLeafCount(scene) >= MAX_PIECES

  const place = useCallback(
    (pieceId: string, at?: { x: number; y: number }) => {
      const id = randomUUID().slice(0, 8)
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

        {/* One element in one place; the stylesheet decides whether it is a
            drawer over the picture or a row under it, because which of those
            is right depends only on whether the screen has the height. */}
        <div
          className={`tray make__toolbox${toolsOpen ? ' make__toolbox--open' : ''}`}
          role="group"
          aria-label="Tools"
        >
          <div className="tray__head make__toolbox-head">
            <span className="tray__title">Tools</span>
            <button
              type="button"
              className="tray__close"
              onClick={() => setToolsOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="make__tools">
          <ToolButton
            glyph="🎨"
            label="Colour"
            disabled={!selected}
            onClick={() => openTool('colour')}
          />
          <ToolButton
            glyph="🗜️"
            label="Squish"
            disabled={!selected}
            onClick={() => openTool('squish')}
          />
          <ToolButton
            glyph="🔪"
            label="Slice"
            disabled={!selected}
            onClick={() => openTool('slice')}
          />
          {/* Both pairs act on the picture straight away rather than opening a
              tool: one press, one step. */}
          <PairTool label="Order">
            <PairButton
              glyph="▲"
              label="Bring forward"
              disabled={!selected || !canRestack(scene, selected.id, 1)}
              onClick={() => selected && commit(restackPiece(scene, selected.id, 1))}
            />
            <PairButton
              glyph="▼"
              label="Send back"
              disabled={!selected || !canRestack(scene, selected.id, -1)}
              onClick={() => selected && commit(restackPiece(scene, selected.id, -1))}
            />
          </PairTool>
          <PairTool label="Flip">
            <PairButton
              glyph="⇄"
              label="Flip left to right"
              disabled={!selected}
              onClick={() => selected && commit(flipPiece(scene, selected.id, 'x'))}
            />
            <PairButton
              glyph="⇅"
              label="Flip top to bottom"
              disabled={!selected}
              onClick={() => selected && commit(flipPiece(scene, selected.id, 'y'))}
            />
          </PairTool>
          {/* Two taps by nature: this one arms, and the next piece touched is
              what joins. Armed, it says so, because nothing else on screen
              would explain why the next tap behaves differently. */}
          <ToolButton
            glyph="🔗"
            label={grouping ? 'Tap a piece' : 'Group'}
            disabled={!selected || scene.pieces.length < 2}
            onClick={() => setGrouping((armed) => !armed)}
          />
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
          {/* Every tool needs a selection, so this says so rather than opening
              a drawer of six dead buttons. The hint above says what to do. */}
          <button
            type="button"
            className="btn make__toolsbtn"
            aria-expanded={toolsOpen}
            disabled={!selected}
            onClick={() => {
              setTrayOpen(false)
              setToolsOpen((open) => !open)
            }}
          >
            Tools
          </button>
          <button
            type="button"
            className="btn make__bin"
            aria-expanded={trayOpen}
            onClick={() => {
              setToolsOpen(false)
              setTrayOpen((open) => !open)
            }}
          >
            Parts bin{full ? ' (full)' : ''}
          </button>
          {action}
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
                randomUUID().slice(0, 8),
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
function SelectionRing({ piece }: { piece: SceneNode }) {
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

/**
 * Shaped like a tool button, but holding two controls instead of being one —
 * for the pairs that are opposites of each other and need no tool screen.
 */
function PairTool({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pairtool" aria-label={label}>
      <div className="pairtool__buttons">{children}</div>
      <span className="pairtool__label">{label}</span>
    </div>
  )
}

function PairButton({
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
    <button
      type="button"
      className="pairtool__button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {glyph}
    </button>
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
