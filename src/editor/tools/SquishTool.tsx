import { useRef, useState } from 'react'

import { MAX_SQUASH, type Placed, type Squash } from '../../shared/scene'
import { capturePointer } from '../pointer'
import { crushAngle, squeezeFactor } from '../squish'
import { PiecePreview, ToolShell } from './ToolShell'

const STAGE = 280
const CENTRE = STAGE / 2
/** Jaws never quite meet — a fully flattened preview would show nothing. */
const CLOSED_RADIUS = 18
/** Where the jaws rest before you touch anything. */
const OPEN_RADIUS = STAGE * 0.46
/**
 * How far inside the rim still counts as taking hold of a jaw.
 *
 * Every crush has to start out here, so the only way to squeeze again is to let
 * go, reach back out and swipe again — three crushes are three swipes, not one
 * long drag with three wiggles in it.
 */
const GRAB_SLOP = 46
const GRAB_RADIUS = OPEN_RADIUS - GRAB_SLOP
/** Distance that counts as a full swing. */
const FULL_SWING = STAGE * 0.34
const SPEED_REFERENCE = 900 // px/sec that counts as a hard slam

interface Swing {
  /** Direction from the art's centre to where the finger went down. */
  angle: number
  /** Where the jaw sits now: its distance from centre, along that axis. */
  radius: number
  /**
   * Gap between the finger and the jaw it took hold of. Held constant so the
   * jaw follows the swipe one for one instead of snapping under the finger.
   */
  grabOffset: number
  time: number
  peakSpeed: number
  startRadius: number
}

/**
 * The crusher. The jaws ride a track around the art: take hold of one at the
 * rim, swipe it through, let go. Aiming and squeezing stay one motion, and the
 * grab is what makes it swipe, swipe, swipe rather than one long push.
 */
export function SquishTool({
  piece,
  onSqueeze,
  onClose,
}: {
  piece: Placed
  /** Applied straight away — each squeeze is its own undo step. */
  onSqueeze(squash: Squash): void
  onClose(): void
}) {
  /** How far the jaws are closed, while one is held. Null means resting. */
  const [held, setHeld] = useState<{ angle: number; radius: number } | null>(null)
  /** The jaws stay where the last swipe left them, so the track reads as real. */
  const [restAngle, setRestAngle] = useState(-Math.PI / 2)
  /** Set by a press that landed short of the jaws, so the hint can say so. */
  const [missed, setMissed] = useState(false)

  const swing = useRef<Swing | null>(null)
  const total = (piece.squashes ?? []).reduce((most, squash) => Math.max(most, squash.factor), 1)

  const pointOf = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left - CENTRE, y: event.clientY - rect.top - CENTRE }
  }

  return (
    <ToolShell
      title="Squish"
      hint={
        missed
          ? 'Start at the edge — take hold of a jaw, then swipe it through.'
          : total >= MAX_SQUASH
            ? // Saying so beats letting them swipe at an axis that cannot give.
              `Crushed ${total.toFixed(1)}× — as flat as that way goes. Swipe another way to reshape it.`
            : total > 1
              ? `Crushed ${total.toFixed(1)}×. Grab a jaw and swipe again to flatten it more.`
              : 'Grab a jaw at the edge and swipe it through the art.'
      }
      onClose={onClose}
    >
      <div className="squish">
        <div
          className="squish__stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={(event) => {
            const p = pointOf(event)
            const radius = Math.hypot(p.x, p.y)
            // The jaws have to be taken hold of out at the rim. A press on the
            // art itself is not a grab, so it does nothing at all.
            if (radius < GRAB_RADIUS) {
              setMissed(true)
              return
            }

            const angle = Math.atan2(p.y, p.x)
            setMissed(false)
            swing.current = {
              angle,
              // The jaw is picked up where it rests, not where the finger
              // landed, so reaching past the rim is not a head start.
              radius: OPEN_RADIUS,
              startRadius: OPEN_RADIUS,
              grabOffset: radius - OPEN_RADIUS,
              time: performance.now(),
              peakSpeed: 0,
            }
            setRestAngle(angle)
            setHeld({ angle, radius: OPEN_RADIUS })
            capturePointer(event)
          }}
          onPointerMove={(event) => {
            const state = swing.current
            if (!state) return

            // Track only movement along the swing's own axis, so a wobble
            // sideways neither closes the jaws nor counts as speed.
            const p = pointOf(event)
            const along = p.x * Math.cos(state.angle) + p.y * Math.sin(state.angle)
            const radius = Math.min(OPEN_RADIUS, Math.max(CLOSED_RADIUS, along - state.grabOffset))

            const now = performance.now()
            const dt = Math.max(1, now - state.time)
            state.peakSpeed = Math.max(
              state.peakSpeed,
              (Math.abs(radius - state.radius) / dt) * 1000,
            )
            state.radius = radius
            state.time = now

            setHeld({ angle: state.angle, radius })
          }}
          onPointerUp={() => {
            const state = swing.current
            swing.current = null
            // Letting go springs the jaws back open, so the next crush has to
            // start with another grab.
            setHeld(null)
            if (!state) return

            const travel = state.startRadius - state.radius
            // A nudge is not a squeeze.
            if (travel < 12) return

            const factor = squeezeFactor(travel / FULL_SWING, state.peakSpeed / SPEED_REFERENCE)
            onSqueeze({ angle: crushAngle(state.angle, piece.rotation), factor })
          }}
          onPointerCancel={() => {
            swing.current = null
            setHeld(null)
          }}
        >
          <div className="squish__art">
            {/* Drawn at the piece's own angle — the jaws move around it now,
                rather than the art spinning to meet them. */}
            <PiecePreview piece={piece} size={STAGE} />
          </div>

          {/* The track the jaws sit on, and the band a grab has to land in. */}
          <div
            className="squish__track"
            style={{ width: OPEN_RADIUS * 2, height: OPEN_RADIUS * 2, borderWidth: GRAB_SLOP }}
          />

          <Jaws
            angle={held?.angle ?? restAngle}
            radius={held?.radius ?? OPEN_RADIUS}
            held={held !== null}
          />
        </div>
      </div>
    </ToolShell>
  )
}

/**
 * Two linked plates facing each other across the art. The wrapper turns so its
 * vertical axis lines up with the swing, which puts one jaw under the finger
 * and the other directly opposite.
 */
function Jaws({ angle, radius, held }: { angle: number; radius: number; held: boolean }) {
  const degrees = (angle * 180) / Math.PI - 90

  return (
    <div
      className={`squish__jaws${held ? ' squish__jaws--held' : ''}`}
      style={{ transform: `rotate(${degrees}deg)` }}
    >
      <div className="jaw" style={{ transform: `translateY(${radius}px)` }}>
        <div className="jaw__teeth" />
      </div>
      <div className="jaw" style={{ transform: `translateY(${-radius}px)` }}>
        <div className="jaw__teeth" />
      </div>
    </div>
  )
}
