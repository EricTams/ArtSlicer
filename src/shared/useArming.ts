import { useEffect, useState } from 'react'

/** How long an armed button stays armed before it goes quiet again. */
const LAPSE_MS = 4000

/**
 * A press that has to be made twice.
 *
 * For the buttons that end a game a room full of people may be in the middle
 * of. The first press only arms, and the arming lapses on its own, so neither
 * a stray touch nor a forgotten one leaves a live game a single tap from over.
 *
 * The caller keeps its own label and styling — what these buttons have in
 * common is the behaviour, not the look: one is a quiet pill in the corner of
 * the host's screen, the other sits in a notice on the front door.
 */
export function useArming(
  onConfirm: () => void,
  lapseMs = LAPSE_MS,
): { armed: boolean; press(): void } {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), lapseMs)
    return () => clearTimeout(timer)
  }, [armed, lapseMs])

  return {
    armed,
    press: () => {
      if (!armed) {
        setArmed(true)
        return
      }
      setArmed(false)
      onConfirm()
    },
  }
}
