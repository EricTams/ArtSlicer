import { useRef, useState } from 'react'

import { MAX_SQUASH, type Placed, type Squash } from '../../shared/scene'
import { capturePointer } from '../pointer'
import { PiecePreview, ToolShell } from './ToolShell'

const STAGE = 260
/** How far apart the jaws start, as a fraction of the stage. */
const OPEN_GAP = 0.9
const CLOSED_GAP = 0.12

/**
 * Fast crushes deform more than slow ones. Squeezing gently lets you dial in a
 * shape; slamming the jaws shut flattens it — which is the bit that makes the
 * tool feel like a tool rather than a slider.
 */
const SPEED_REFERENCE = 900 // px/sec that counts as a hard slam
const MAX_SPEED_BONUS = 2.2

export function SquishTool({
  piece,
  onCommit,
  onCancel,
}: {
  piece: Placed
  onCommit(squash: Squash): void
  onCancel(): void
}) {
  /** How far the art is spun on screen, to aim it at the jaws. */
  const [angle, setAngle] = useState(0)
  const [gap, setGap] = useState(OPEN_GAP)
  const [squash, setSquash] = useState<Squash | null>(null)

  const drag = useRef<{ y: number; time: number; peakSpeed: number } | null>(null)

  const commit = (): void => {
    if (squash) onCommit(squash)
    else onCancel()
  }

  return (
    <ToolShell
      title="Squish"
      hint={
        squash
          ? `Crushed ${squash.factor.toFixed(1)}×. Squeeze again or hit Done.`
          : 'Spin the art to aim, then drag the jaws together. Fast squeezes crush harder.'
      }
      onCancel={onCancel}
      onDone={commit}
      doneLabel={squash ? 'Keep it' : 'Done'}
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
            // Only closing counts; opening the jaws back up just resets them.
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
            if (closed < 0.08) {
              setGap(OPEN_GAP)
              return
            }

            const speedBonus = 1 + Math.min(state.peakSpeed / SPEED_REFERENCE, 1) * MAX_SPEED_BONUS
            const factor = Math.min(MAX_SQUASH, 1 + closed * speedBonus)
            // The jaws crush vertically on screen. The art is spun by `angle`
            // to aim, so in the piece's own frame that direction is turned the
            // other way — otherwise the crush lands mirrored.
            setSquash({ angle: -angle, factor })
            setGap(OPEN_GAP)
          }}
        >
          <Jaw position="top" gap={gap} stage={STAGE} />
          <div className="squish__art">
            <PiecePreview
              piece={piece}
              size={STAGE}
              rotation={angle}
              // Show the crush that is being applied, live.
              extraSquash={squash ?? null}
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

        {squash && (
          <button type="button" className="btn btn--ghost" onClick={() => setSquash(null)}>
            Undo this squeeze
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
