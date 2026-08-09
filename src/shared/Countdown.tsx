import { useEffect, useState } from 'react'

interface Props {
  /** Absolute epoch ms on the host's clock. */
  deadline: number | null
  /** Host clock minus this device's clock; zero on the host itself. */
  clockOffset?: number
  className?: string
}

/**
 * Counts down to a host-owned deadline. The host broadcasts absolute
 * timestamps rather than remaining seconds, and each phone corrects for its
 * own clock skew, so every screen in the room agrees even though nothing is
 * synchronised tick by tick.
 */
export function Countdown({ deadline, clockOffset = 0, className }: Props) {
  const [remaining, setRemaining] = useState(() => compute(deadline, clockOffset))

  useEffect(() => {
    setRemaining(compute(deadline, clockOffset))
    if (deadline === null) return

    const timer = setInterval(() => setRemaining(compute(deadline, clockOffset)), 250)
    return () => clearInterval(timer)
  }, [deadline, clockOffset])

  if (deadline === null) return null

  const seconds = Math.ceil(remaining / 1000)
  // The last ten seconds are the ones people react to, so mark them.
  const urgent = seconds <= 10

  return (
    <span
      className={`countdown${urgent ? ' countdown--urgent' : ''}${className ? ` ${className}` : ''}`}
    >
      {formatClock(seconds)}
    </span>
  )
}

function compute(deadline: number | null, clockOffset: number): number {
  if (deadline === null) return 0
  return Math.max(0, deadline - (Date.now() + clockOffset))
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : String(seconds)
}
