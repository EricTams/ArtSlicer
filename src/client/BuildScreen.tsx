import { useCallback, useRef, useState } from 'react'

import { Editor } from '../editor/Editor'
import { Countdown } from '../shared/Countdown'
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

  const handleChange = useCallback((scene: Scene) => {
    sceneRef.current = scene
  }, [])

  const handleSubmit = useCallback(() => {
    setSent(true)
    onSubmit(sceneRef.current)
  }, [onSubmit])

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
