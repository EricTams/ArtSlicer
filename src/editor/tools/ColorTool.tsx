import { useCallback, useEffect, useRef, useState } from 'react'

import type { Placed } from '../../shared/scene'
import {
  EMPTY_JAR,
  type Jar,
  JAR_CAPACITY,
  SPRAY_PER_SECOND,
  TUBES,
  type TubeId,
  jarIsEmpty,
  jarTotal,
  mixedColor,
  squeeze,
} from '../paint'
import { capturePointer } from '../pointer'
import { PiecePreview, ToolShell } from './ToolShell'

/**
 * Colour, as a physical act: squeeze paint out of tubes into a jar, then hold
 * the spray button on your piece. There is no colour picker anywhere — the
 * colour you get is whatever ratio you actually squeezed.
 */
export function ColorTool({
  piece,
  jar,
  onJarChange,
  onSpray,
  onDone,
  onCancel,
}: {
  piece: Placed
  /** Held by the editor so a mixed colour survives across pieces. */
  jar: Jar
  onJarChange(jar: Jar): void
  onSpray(color: string, delta: number): void
  onDone(): void
  onCancel(): void
}) {
  const color = mixedColor(jar)
  const empty = jarIsEmpty(jar)
  const fill = Math.min(1, jarTotal(jar) / JAR_CAPACITY)

  return (
    <ToolShell
      title="Colour"
      hint={
        empty
          ? 'Drag down on the tubes to squeeze paint into the jar.'
          : 'Hold SPRAY. The longer you hold, the stronger it gets.'
      }
      onCancel={onCancel}
      onDone={onDone}
    >
      <div className="paint">
        <div className="paint__stage">
          <PiecePreview piece={piece} size={220} />
        </div>

        <div className="paint__tubes">
          {TUBES.map((tube) => (
            <Tube
              key={tube.id}
              id={tube.id}
              label={tube.label}
              color={`rgb(${tube.rgb.join(',')})`}
              onSqueeze={(amount) => onJarChange(squeeze(jar, tube.id, amount))}
            />
          ))}
        </div>

        <div className="paint__jarrow">
          <Jarr color={color} fill={fill} empty={empty} />
          <button
            type="button"
            className="btn btn--ghost paint__empty"
            disabled={empty}
            onClick={() => onJarChange(EMPTY_JAR)}
          >
            Empty jar
          </button>
        </div>

        <SprayButton disabled={empty} color={color} onSpray={onSpray} />
      </div>
    </ToolShell>
  )
}

/**
 * A tube you drag downward to squeeze. Paint comes out in proportion to how
 * far you pull, so a careful nudge and a hard yank differ — which is the whole
 * point of mixing by ratio.
 */
function Tube({
  id,
  label,
  color,
  onSqueeze,
}: {
  id: TubeId
  label: string
  color: string
  onSqueeze(amount: number): void
}) {
  const lastY = useRef<number | null>(null)
  const [squeezing, setSqueezing] = useState(false)

  return (
    <button
      type="button"
      className={`tube${squeezing ? ' tube--on' : ''}`}
      aria-label={`Squeeze ${label}`}
      onPointerDown={(event) => {
        lastY.current = event.clientY
        setSqueezing(true)
        capturePointer(event)
      }}
      onPointerMove={(event) => {
        if (lastY.current === null) return
        const dy = event.clientY - lastY.current
        // Only downward drags squeeze; pulling back up does nothing, so you
        // cannot un-squeeze by wiggling.
        if (dy > 0) {
          lastY.current = event.clientY
          onSqueeze(dy / 60)
        }
      }}
      onPointerUp={() => {
        lastY.current = null
        setSqueezing(false)
      }}
      onPointerCancel={() => {
        lastY.current = null
        setSqueezing(false)
      }}
    >
      <span className="tube__body" style={{ background: color }}>
        <span className="tube__cap" />
      </span>
      <span className="tube__label">{id}</span>
    </button>
  )
}

function Jarr({ color, fill, empty }: { color: string; fill: number; empty: boolean }) {
  return (
    <div className="jar" aria-label="Paint jar">
      <div className="jar__glass">
        <div
          className="jar__paint"
          style={{ height: `${Math.max(fill * 100, empty ? 0 : 6)}%`, background: color }}
        />
      </div>
      <span className="jar__label">{empty ? 'empty' : color}</span>
    </div>
  )
}

/**
 * Hold to spray. Tint is applied continuously while held rather than on
 * release, so you can watch the colour build and stop when it looks right.
 */
function SprayButton({
  disabled,
  color,
  onSpray,
}: {
  disabled: boolean
  color: string
  onSpray(color: string, delta: number): void
}) {
  const [spraying, setSpraying] = useState(false)
  const frame = useRef<number | null>(null)
  const last = useRef(0)

  const stop = useCallback(() => {
    setSpraying(false)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  useEffect(() => {
    if (!spraying) return

    last.current = performance.now()
    const step = (now: number): void => {
      const dt = (now - last.current) / 1000
      last.current = now
      onSpray(color, dt * SPRAY_PER_SECOND)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [spraying, color, onSpray])

  return (
    <button
      type="button"
      className={`spray${spraying ? ' spray--on' : ''}`}
      disabled={disabled}
      style={{ '--spray-color': color } as React.CSSProperties}
      onPointerDown={(event) => {
        if (disabled) return
        setSpraying(true)
        capturePointer(event)
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
    >
      {disabled ? 'Mix some paint first' : spraying ? 'Spraying…' : 'Hold to spray'}
    </button>
  )
}
