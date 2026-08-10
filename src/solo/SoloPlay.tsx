import { useCallback, useState } from 'react'

import { Editor } from '../editor/Editor'
import { usePiecesLoaded } from '../editor/usePiecesLoaded'
import { shufflePrompts } from '../game/prompts'

/**
 * Solo play: straight into the draw screen, no lobby and no clock. Instead of
 * submitting, you take a new prompt and start again — so it doubles as the
 * place to learn the tools before playing with other people.
 */
export function SoloPlay() {
  const loaded = usePiecesLoaded()
  const [pool, setPool] = useState<string[]>(() => shufflePrompts())
  const [round, setRound] = useState(0)

  const prompt = pool[round % pool.length] ?? ''

  const nextPrompt = useCallback(() => {
    setRound((current) => {
      const next = current + 1
      // Reshuffle rather than repeat once the pool is exhausted.
      if (next >= pool.length) {
        setPool(shufflePrompts())
        return 0
      }
      return next
    })
  }, [pool.length])

  if (!loaded) {
    return (
      <div className="screen screen--center">
        <p className="tagline">Loading the junk…</p>
      </div>
    )
  }

  return (
    <div className="build">
      {/* No header at all: the prompt is inside the picture, so the screen is
          the picture and its controls. */}
      <div className="build__editor">
        {/* Keyed on the round so a new prompt clears the picture and hands you
            a fresh set of parts, rather than editing the last one. */}
        <Editor key={round} prompt={prompt} />
      </div>

      <button className="btn btn--wide" onClick={nextPrompt}>
        New prompt
      </button>
    </div>
  )
}
