import { useRef, useState } from 'react'

import type { Placed, Squash } from '../../shared/scene'
import { capturePointer } from '../pointer'
import { mergeSquash } from '../sceneEdit'
import { PiecePreview, ToolShell } from './ToolShell'

const STAGE = 260
/** How far apart the jaws start, as a fraction of the stage. */
const OPEN_GAP = 0.9
const CLOSED_GAP = 0.12

/**
 * One squeeze deliberately does little: a gentle full close is 1.2×, a hard
 * slam 1.7×. Extreme shapes come from hitting it again and again, which is
 * what makes it a crusher rather than a slider — and repeated squeezes at the
 * same aim merge into a single crush, so hammering it costs nothing.
 */
const GENTLE_SQUEEZE = 0.2
const SPEED_BONUS = 0.5
const SPEED_REFERENCE = 900 // px/sec that counts as a hard slam

export function SquishTool({
  piece,
  onCommit,
  onCancel,
}: {
  piece: Placed
  onCommit(squashes: Squash[]): void
  onCancel(): void
}) {
  /** How far the art is spun on screen, to aim it at the jaws. */
  const [angle, setAngle] = useState(0)
  const [gap, setGap] = useState(OPEN_GAP)
  /** Squeezes so far in this visit, previewed live and committed together. */
  const [pending, setPending] = useState<Squash[]>([])

  const drag = useRef<{ y: number; time: number; peakSpeed: number } | null>(null)

  const total = pending.reduce((most, squash) => Math.max(most, squash.factor), 1)

  return (
    <ToolShell
      title="Squish"
      hint={
        pending.length > 0
          ? `Crushed ${total.toFixed(1)}×. Keep squeezing to flatten it more.`
          : 'Spin the art to aim, then drag the jaws together. Squeeze again and again.'
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
            drag.current = { y: event.clientY, time: performance.now(), peakSpeed: 0 }
            capturePointer(event)
          }}
          onPointerMove={(event) => {
            const state = drag.current
            if (!state) return

            const now = performance.now()
            const dy = event.clientY - state.y
            const dt = Math.max(1, now - state.time)
            const speed = (Math.abs(dy) / dt) * 1000

            state.y = event.clientY
            state.time = now
            state.peakSpeed = Math.max(state.peakSpeed, speed)

            setGap((current) => {
              // Dragging down from the top jaw closes the gap.
              const next = current - (dy * 2) / STAGE
              return Math.max(CLOSED_GAP, Math.min(OPEN_GAP, next))
            })
          }}
          onPointerUp={() => {
            const state = drag.current
            drag.current = null
            if (!state) return

            const closed = (OPEN_GAP - gap) / (OPEN_GAP - CLOSED_GAP)
            // A nudge is not a squeeze; let the jaws spring back.
            if (closed < 0.08) {
              setGap(OPEN_GAP)
              return
            }

            const speedFraction = Math.min(state.peakSpeed / SPEED_REFERENCE, 1)
            const factor = 1 + closed * (GENTLE_SQUEEZE + speedFraction * SPEED_BONUS)

            setPending((current) => {
              // The jaws crush vertically on screen. The art is spun by `angle`
              // to aim, so in the piece's own frame that direction is turned
              // the other way — otherwise the crush lands mirrored.
              const merged = mergeSquash(current, { angle: -angle, factor })
              return merged ?? current
            })
            setGap(OPEN_GAP)
          }}
        >
          <Jaw position="top" gap={gap} stage={STAGE} />
          <div className="squish__art">
            <PiecePreview
              piece={piece}
              size={STAGE}
              rotation={angle}
              // Show everything squeezed so far, live.
              extraSquashes={pending}
            />
          </div>
          <Jaw position="bottom" gap={gap} stage={STAGE} />
        </div>

        <label className="squish__spin">
          <span className="muted">Spin to aim</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={5}
            value={Math.round((angle * 180) / Math.PI)}
            onChange={(event) => setAngle((Number(event.target.value) * Math.PI) / 180)}
          />
        </label>

        {pending.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={() => setPending([])}>
            Start over
          </button>
        )}
      </div>
    </ToolShell>
  )
}

function Jaw({ position, gap, stage }: { position: 'top' | 'bottom'; gap: number; stage: number }) {
  const offset = ((1 - gap) / 2) * stage
  return (
    <div
      className={`jaw jaw--${position}`}
      style={{ [position]: 0, transform: `translateY(${position === 'top' ? offset : -offset}px)` }}
    >
      <div className="jaw__teeth" />
    </div>
  )
}
