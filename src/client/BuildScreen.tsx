import { useCallback, useEffect, useRef, useState } from 'react'

import { Editor } from '../editor/Editor'
import { Countdown } from '../shared/Countdown'
import { autoSubmitDelay } from './autoSubmit'
import type { Scene } from '../shared/scene'

interface Props {
  prompt: string
  roundIndex: number
  totalRounds: number
  deadline: number | null
  clockOffset: number
  submitted: boolean
  onSubmit(scene: Scene): void
}

/** The phone's build phase: the prompt, a clock, and the editor. */
export function BuildScreen({
  prompt,
  roundIndex,
  totalRounds,
  deadline,
  clockOffset,
  submitted,
  onSubmit,
}: Props) {
  // Held in a ref rather than state: the editor emits on every drag, and
  // re-rendering this screen for each one would fight the canvas.
  const sceneRef = useRef<Scene>({ pieces: [] })
  const [sent, setSent] = useState(false)
  /** Which deadline has already been auto-sent for. */
  const autoSentFor = useRef<number | null>(null)

  const handleChange = useCallback((scene: Scene) => {
    sceneRef.current = scene
  }, [])

  const handleSubmit = useCallback(() => {
    setSent(true)
    onSubmit(sceneRef.current)
  }, [onSubmit])

  /**
   * Nobody should lose a picture to forgetting the button. The round ends on
   * the host's clock, so the local one is only usable through the offset the
   * ping keeps measuring.
   *
   * Guarded per deadline rather than with a flag: that offset lands again on
   * every pong, and without it each arrival would re-run this with the time
   * already past and fire a submission every three seconds. A deadline that
   * genuinely moves — the host absorbing a suspension — is a different one,
   * and earns a fresh send at the new time.
   */
  useEffect(() => {
    if (deadline === null || autoSentFor.current === deadline) return

    const timer = setTimeout(() => {
      autoSentFor.current = deadline
      // An untouched canvas is not work anyone is about to lose, and a blank
      // entry on the ballot is worse than no entry at all.
      if (sceneRef.current.pieces.length === 0) return
      setSent(true)
      onSubmit(sceneRef.current)
    }, autoSubmitDelay(deadline, clockOffset, Date.now()))

    return () => clearTimeout(timer)
  }, [deadline, clockOffset, onSubmit])

  return (
    <div className="build">
      <header className="build__head">
        <p className="build__round">
          Round {roundIndex + 1} of {totalRounds}
        </p>
        <Countdown deadline={deadline} clockOffset={clockOffset} />
      </header>

      <div className="build__editor">
        <Editor prompt={prompt} onChange={handleChange} />
      </div>

      <button className="btn btn--wide" onClick={handleSubmit}>
        {/* Resubmitting is allowed right up to the deadline, so the button
            stays live and just changes what it says. */}
        {submitted || sent ? 'Submitted — send again?' : 'Submit artwork'}
      </button>
    </div>
  )
}
