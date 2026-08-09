import { useCallback, useEffect, useRef, useState } from 'react'

import { type Point, cutFromLine } from '../../render/clip'
import { apply, invert, pieceMatrix } from '../../render/transform'
import { getPiece } from '../../render/pieces'
import type { Cut, Placed } from '../../shared/scene'
import { capturePointer } from '../pointer'
import { PiecePreview, ToolShell } from './ToolShell'

const STAGE = 300
/**
 * Long enough that the flick is a matter of aim rather than reflexes. The arc
 * slows near the apex, so most of this is usable hang time.
 */
const TOSS_MS = 2400
/** How high the toss carries the piece, as a fraction of the stage. */
const TOSS_HEIGHT = 0.34
const SPIN_RADIANS = 0.9
/** A flick shorter than this is a tap, not a cut. */
const MIN_FLICK = 40

type Phase = 'ready' | 'airborne' | 'cut'

/**
 * Slicing, as a physical act: toss the piece up and flick through it while
 * it's in the air. The cut splits it into two pieces you can then treat
 * separately, so slicing makes parts rather than just trimming them.
 */
export function SliceTool({
  piece,
  onCommit,
  onCancel,
}: {
  piece: Placed
  onCommit(cut: Cut): void
  onCancel(): void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [t, setT] = useState(0)
  const [flick, setFlick] = useState<{ from: Point; to: Point } | null>(null)
  const [missed, setMissed] = useState(false)

  const start = useRef<Point | null>(null)
  const frame = useRef<number | null>(null)

  const toss = useCallback(() => {
    setMissed(false)
    setFlick(null)
    setPhase('airborne')

    const began = performance.now()
    const step = (now: number): void => {
      const progress = (now - began) / TOSS_MS
      if (progress >= 1) {
        setT(0)
        setPhase('ready')
        frame.current = null
        return
      }
      setT(progress)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  // A simple arc: up, then back down.
  const lift = phase === 'airborne' ? Math.sin(Math.PI * t) * STAGE * TOSS_HEIGHT : 0
  const spin = phase === 'airborne' ? t * SPIN_RADIANS : 0
  const shownRotation = piece.rotation + spin

  const handleFlick = (from: Point, to: Point): void => {
    if (phase !== 'airborne') return
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_FLICK) return

    // Where the piece actually is at this instant.
    const centre = { x: STAGE / 2, y: STAGE / 2 - lift }
    const def = getPiece(piece.pieceId)
    const radius = def ? (Math.max(def.width, def.height) / 2) * piece.scale * (STAGE / 1000) : 60

    // Did the flick pass through the piece, or miss it entirely?
    if (distanceToLine(centre, from, to) > radius * 1.3) {
      setMissed(true)
      return
    }

    const matrix = invert(pieceMatrix(piece, shownRotation))
    if (!matrix) return

    // Screen → the piece's own coordinates, undoing scale, angle and squashes.
    const scale = 1000 / STAGE
    const toLocal = (p: Point): Point =>
      apply(matrix, { x: (p.x - centre.x) * scale, y: (p.y - centre.y) * scale })

    const cut = cutFromLine(toLocal(from), toLocal(to))
    if (!cut) return

    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setFlick({ from, to })
    setPhase('cut')
  }

  return (
    <ToolShell
      title="Slice"
      hint={
        phase === 'cut'
          ? 'Clean cut. Both halves drop back onto your picture.'
          : phase === 'airborne'
            ? missed
              ? 'Missed! Flick right through it.'
              : 'Now — flick across it!'
            : 'Toss it up, then flick your finger through it.'
      }
      onCancel={onCancel}
      onDone={() => {
        if (phase !== 'cut') {
          onCancel()
          return
        }
        const matrix = invert(pieceMatrix(piece, shownRotation))
        const centre = { x: STAGE / 2, y: STAGE / 2 - lift }
        const scale = 1000 / STAGE
        if (!matrix || !flick) {
          onCancel()
          return
        }
        const toLocal = (p: Point): Point =>
          apply(matrix, { x: (p.x - centre.x) * scale, y: (p.y - centre.y) * scale })
        const cut = cutFromLine(toLocal(flick.from), toLocal(flick.to))
        if (cut) onCommit(cut)
        else onCancel()
      }}
      doneLabel={phase === 'cut' ? 'Keep both' : 'Done'}
    >
      <div className="slice">
        <div
          className="slice__stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            start.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
            capturePointer(event)
          }}
          onPointerUp={(event) => {
            const from = start.current
            start.current = null
            if (!from) return
            const rect = event.currentTarget.getBoundingClientRect()
            handleFlick(from, { x: event.clientX - rect.left, y: event.clientY - rect.top })
          }}
        >
          <div className="slice__art" style={{ transform: `translateY(${-lift}px)` }}>
            <PiecePreview piece={piece} size={STAGE} rotation={shownRotation} />
          </div>

          {flick && (
            <svg className="slice__flick" width={STAGE} height={STAGE}>
              <line
                x1={flick.from.x}
                y1={flick.from.y}
                x2={flick.to.x}
                y2={flick.to.y}
                stroke="#ffffff"
                strokeWidth={3}
              />
            </svg>
          )}
        </div>

        <button
          type="button"
          className="btn btn--wide"
          onClick={toss}
          disabled={phase === 'airborne'}
        >
          {phase === 'cut' ? 'Toss again' : phase === 'airborne' ? 'In the air…' : 'Toss it up'}
        </button>
      </div>
    </ToolShell>
  )
}

/** Perpendicular distance from a point to the infinite line through a→b. */
function distanceToLine(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return Infinity
  return Math.abs(dy * (point.x - a.x) - dx * (point.y - a.y)) / length
}
