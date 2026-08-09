import { useRef, useState } from 'react'

import type { Placed, Squash } from '../../shared/scene'
import { capturePointer } from '../pointer'
import { mergeSquash } from '../sceneEdit'
import { crushAngle, squeezeFactor } from '../squish'
import { PiecePreview, ToolShell } from './ToolShell'

const STAGE = 280
const CENTRE = STAGE / 2
/** Jaws never quite meet — a fully flattened preview would show nothing. */
const CLOSED_RADIUS = 18
/** Where the jaws rest before you touch anything. */
const OPEN_RADIUS = STAGE * 0.46
/** A press this close to the middle gives no swing direction to read. */
const MIN_START_RADIUS = 30
/** Distance that counts as a full swing. */
const FULL_SWING = STAGE * 0.34
const SPEED_REFERENCE = 900 // px/sec that counts as a hard slam

interface Swing {
  /** Direction from the art's centre to where the finger went down. */
  angle: number
  /** Distance from centre, along that axis. */
  radius: number
  time: number
  peakSpeed: number
  startRadius: number
}

/**
 * The crusher. The jaws come from wherever you put your finger and close along
 * the path you drag — so aiming and squeezing are one motion instead of a
 * slider plus a drag.
 */
export function SquishTool({
  piece,
  onCommit,
  onCancel,
}: {
  piece: Placed
  onCommit(squashes: Squash[]): void
  onCancel(): void
}) {
  /** Squeezes so far in this visit, previewed live and committed together. */
  const [pending, setPending] = useState<Squash[]>([])
  /** Where the jaws currently sit. Null means resting. */
  const [jaws, setJaws] = useState<{ angle: number; radius: number } | null>(null)

  const swing = useRef<Swing | null>(null)
  const total = pending.reduce((most, squash) => Math.max(most, squash.factor), 1)

  const pointOf = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left - CENTRE, y: event.clientY - rect.top - CENTRE }
  }

  return (
    <ToolShell
      title="Squish"
      hint={
        pending.length > 0
          ? `Crushed ${total.toFixed(1)}×. Swing again to flatten it more.`
          : 'Swipe through the art from any side. The jaws close the way you swing.'
      }
      onCancel={onCancel}
      onDone={() => (pending.length > 0 ? onCommit(pending) : onCancel())}
      doneLabel={pending.length > 0 ? 'Keep it' : 'Done'}
    >
      <div className="squish">
        <div
          className="squish__stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={(event) => {
            const p = pointOf(event)
            const radius = Math.hypot(p.x, p.y)
            // Starting on top of the art gives no direction to swing from.
            if (radius < MIN_START_RADIUS) return

            const angle = Math.atan2(p.y, p.x)
            swing.current = {
              angle,
              radius,
              startRadius: radius,
              time: performance.now(),
              peakSpeed: 0,
            }
            setJaws({ angle, radius })
            capturePointer(event)
          }}
          onPointerMove={(event) => {
            const state = swing.current
            if (!state) return

            // Track only movement along the swing's own axis, so a wobble
            // sideways neither closes the jaws nor counts as speed.
            const p = pointOf(event)
            const along = p.x * Math.cos(state.angle) + p.y * Math.sin(state.angle)
            const radius = Math.max(CLOSED_RADIUS, along)

            const now = performance.now()
            const dt = Math.max(1, now - state.time)
            state.peakSpeed = Math.max(
              state.peakSpeed,
              (Math.abs(radius - state.radius) / dt) * 1000,
            )
            state.radius = radius
            state.time = now

            setJaws({ angle: state.angle, radius })
          }}
          onPointerUp={() => {
            const state = swing.current
            swing.current = null
            setJaws(null)
            if (!state) return

            const travel = state.startRadius - state.radius
            // A nudge is not a squeeze.
            if (travel < 12) return

            const factor = squeezeFactor(travel / FULL_SWING, state.peakSpeed / SPEED_REFERENCE)
            setPending((current) => {
              const merged = mergeSquash(current, {
                angle: crushAngle(state.angle, piece.rotation),
                factor,
              })
              return merged ?? current
            })
          }}
          onPointerCancel={() => {
            swing.current = null
            setJaws(null)
          }}
        >
          <div className="squish__art">
            {/* Drawn at the piece's own angle — the jaws move around it now,
                rather than the art spinning to meet them. */}
            <PiecePreview piece={piece} size={STAGE} extraSquashes={pending} />
          </div>

          <Jaws angle={jaws?.angle ?? -Math.PI / 2} radius={jaws?.radius ?? OPEN_RADIUS} />
        </div>

        {pending.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={() => setPending([])}>
            Start over
          </button>
        )}
      </div>
    </ToolShell>
  )
}

/**
 * Two linked plates facing each other across the art. The wrapper turns so its
 * vertical axis lines up with the swing, which puts one jaw under the finger
 * and the other directly opposite.
 */
function Jaws({ angle, radius }: { angle: number; radius: number }) {
  const degrees = (angle * 180) / Math.PI - 90

  return (
    <div className="squish__jaws" style={{ transform: `rotate(${degrees}deg)` }}>
      <div className="jaw" style={{ transform: `translateY(${radius}px)` }}>
        <div className="jaw__teeth" />
      </div>
      <div className="jaw" style={{ transform: `translateY(${-radius}px)` }}>
        <div className="jaw__teeth" />
      </div>
    </div>
  )
}
