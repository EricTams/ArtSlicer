import { useCallback, useEffect, useRef, useState } from 'react'

import { type Point, cutFromLine, invertCut } from '../../render/clip'
import { getPiece } from '../../render/pieces'
import { apply, invert, pieceMatrix } from '../../render/transform'
import { DESIGN_SIZE, type Cut, type Placed } from '../../shared/scene'
import { capturePointer } from '../pointer'
import { PieceStage, ToolShell } from './ToolShell'

const STAGE = 300
/** A swipe shorter than this is a tap, not a cut. */
const MIN_SWIPE = 36
/** How long the halves take to spring apart, in ms. */
const CUT_MS = 520
/** How far apart they end up, in scene units. */
const CUT_SPREAD = 130
/** A beat after the halves settle, so the split is seen before the tool goes. */
const SETTLE_MS = 260

interface Result {
  cut: Cut
  /** Perpendicular to the swipe, in scene space — the way the halves part. */
  normal: Point
  line: { from: Point; to: Point }
}

/**
 * Slicing: aim a swipe across the piece and it comes apart into two you can
 * move, colour and squish separately. The cut is drawn as a blade trail while
 * you aim and a flash along the line when it lands, because a piece quietly
 * becoming two pieces reads as nothing happening at all.
 */
export function SliceTool({
  piece,
  canSlice,
  onCut,
  onClose,
}: {
  piece: Placed
  /** False when the picture is full, or this piece has been cut all it can be. */
  canSlice: boolean
  onCut(cut: Cut, separation: Point): void
  onClose(): void
}) {
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [missed, setMissed] = useState(false)
  /** 0 → 1 as the halves come apart. */
  const [progress, setProgress] = useState(0)

  const start = useRef<Point | null>(null)
  const frame = useRef<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (settle.current !== null) clearTimeout(settle.current)
    },
    [],
  )

  /**
   * Runs the split, then applies it and leaves. There is nothing to confirm —
   * the cut you drew is the cut you get, and undo is a tap away on the canvas.
   */
  const play = useCallback(
    (cut: Cut, normal: Point) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      const began = performance.now()

      const step = (now: number): void => {
        const t = Math.min(1, (now - began) / CUT_MS)
        // Fast out, easing to a stop — a cut snaps apart, it doesn't drift.
        setProgress(1 - (1 - t) ** 3)
        if (t < 1) frame.current = requestAnimationFrame(step)
        else frame.current = null
      }
      frame.current = requestAnimationFrame(step)

      // The cut is committed on a timer rather than at the end of the
      // animation: frames stop entirely while a tab is hidden, and a player
      // who glanced at a notification mid-swipe would come back to a tool that
      // never finished and a cut that never happened.
      settle.current = setTimeout(() => onCut(cut, normal), CUT_MS + SETTLE_MS)
    },
    [onCut],
  )

  const attempt = (from: Point, to: Point): void => {
    // Already cutting, or nothing left to cut with.
    if (result || !canSlice) return
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_SWIPE) return

    const centre = { x: STAGE / 2, y: STAGE / 2 }
    const def = getPiece(piece.pieceId)
    const radius = def
      ? (Math.max(def.width, def.height) / 2) * piece.scale * (STAGE / DESIGN_SIZE)
      : 60

    // Did the swipe pass through the piece, or sail past it?
    if (distanceToLine(centre, from, to) > radius * 1.35) {
      setMissed(true)
      setResult(null)
      return
    }

    const matrix = invert(pieceMatrix(piece))
    if (!matrix) return

    // Screen → the piece's own coordinates, undoing scale, angle and squashes.
    const toScene = DESIGN_SIZE / STAGE
    const toLocal = (p: Point): Point =>
      apply(matrix, { x: (p.x - centre.x) * toScene, y: (p.y - centre.y) * toScene })

    const cut = cutFromLine(toLocal(from), toLocal(to))
    if (!cut) return

    // The halves part perpendicular to the swipe as drawn on screen, which is
    // scene space — the cut's own normal points elsewhere once the piece is
    // turned or crushed.
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)

    const normal = { x: -dy / length, y: dx / length }
    setMissed(false)
    setProgress(0)
    setResult({ cut, normal, line: { from, to } })
    play(cut, normal)
  }

  const halves = result ? previewHalves(piece, result, progress) : [centred(piece)]

  return (
    <ToolShell
      title="Slice"
      hint={
        !canSlice
          ? 'No room to split this one — bin a piece first.'
          : result
            ? 'Split!'
            : missed
              ? 'Missed — swipe straight through it.'
              : 'Swipe across the art to cut it in two.'
      }
      onClose={onClose}
    >
      <div className="slice">
        <div
          className="slice__stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            start.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
            setDrag({ from: start.current, to: start.current })
            capturePointer(event)
          }}
          onPointerMove={(event) => {
            const from = start.current
            if (!from) return
            const rect = event.currentTarget.getBoundingClientRect()
            setDrag({ from, to: { x: event.clientX - rect.left, y: event.clientY - rect.top } })
          }}
          onPointerUp={(event) => {
            const from = start.current
            start.current = null
            setDrag(null)
            if (!from) return
            const rect = event.currentTarget.getBoundingClientRect()
            attempt(from, { x: event.clientX - rect.left, y: event.clientY - rect.top })
          }}
          onPointerCancel={() => {
            start.current = null
            setDrag(null)
          }}
        >
          <div className="slice__art">
            <PieceStage pieces={halves} size={STAGE} />
          </div>

          {/* The blade while aiming. */}
          {drag && <Blade from={drag.from} to={drag.to} />}

          {/* The flash along the cut, fading as the halves part. */}
          {result && progress < 1 && <Slash line={result.line} fade={progress} />}
        </div>
      </div>
    </ToolShell>
  )
}

function centred(piece: Placed): Placed {
  return { ...piece, x: DESIGN_SIZE / 2, y: DESIGN_SIZE / 2 }
}

/** The two halves, drifting apart along the cut as the animation runs. */
function previewHalves(piece: Placed, result: Result, progress: number): Placed[] {
  const spread = CUT_SPREAD * progress * piece.scale
  const existing = piece.cuts ?? []
  const base = centred(piece)

  return [
    {
      ...base,
      id: `${piece.id}-a`,
      cuts: [...existing, result.cut],
      x: base.x - result.normal.x * spread,
      y: base.y - result.normal.y * spread,
    },
    {
      ...base,
      id: `${piece.id}-b`,
      cuts: [...existing, invertCut(result.cut)],
      x: base.x + result.normal.x * spread,
      y: base.y + result.normal.y * spread,
    },
  ]
}

/** The line you're about to cut along, drawn right across the piece. */
function Blade({ from, to }: { from: Point; to: Point }) {
  const extended = extend(from, to)
  if (!extended) return null

  return (
    <svg className="slice__blade" width={STAGE} height={STAGE}>
      <line
        x1={extended.from.x}
        y1={extended.from.y}
        x2={extended.to.x}
        y2={extended.to.y}
        className="slice__blade-guide"
      />
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="slice__blade-edge" />
    </svg>
  )
}

/** The flash when the cut lands. */
function Slash({ line, fade }: { line: { from: Point; to: Point }; fade: number }) {
  const extended = extend(line.from, line.to)
  if (!extended) return null

  const ends = {
    x1: extended.from.x,
    y1: extended.from.y,
    x2: extended.to.x,
    y2: extended.to.y,
  }

  return (
    // Squared rather than linear, so it stays bright through the moment the
    // halves separate and only then drops away.
    <svg className="slice__blade" width={STAGE} height={STAGE} style={{ opacity: 1 - fade ** 2 }}>
      <line {...ends} className="slice__slash-halo" strokeWidth={70 * (1 - fade) + 6} />
      <line {...ends} className="slice__slash-glow" strokeWidth={26 * (1 - fade) + 4} />
      {/* A hot core that thins to nothing, like a blade pulling away. */}
      <line {...ends} className="slice__slash-core" strokeWidth={7 * (1 - fade) + 1} />
    </svg>
  )
}

/** Stretches a segment past both ends, so the cut reads as an infinite line. */
function extend(from: Point, to: Point): { from: Point; to: Point } | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return null

  const ux = (dx / length) * STAGE
  const uy = (dy / length) * STAGE
  return {
    from: { x: from.x - ux, y: from.y - uy },
    to: { x: to.x + ux, y: to.y + uy },
  }
}

/** Perpendicular distance from a point to the infinite line through a→b. */
function distanceToLine(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return Infinity
  return Math.abs(dy * (point.x - a.x) - dx * (point.y - a.y)) / length
}
