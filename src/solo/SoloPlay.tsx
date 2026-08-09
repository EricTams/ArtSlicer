import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
  const navigate = useNavigate()

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
      <header className="build__head">
        <div>
          <p className="build__round">Make something like</p>
          <h2 className="build__prompt">{prompt}</h2>
        </div>
        <button
          type="button"
          className="linkbtn"
          onClick={() => navigate('/')}
          aria-label="Leave solo play"
        >
          Quit
        </button>
      </header>

      <div className="build__editor">
        {/* Keyed on the round so a new prompt clears the picture and hands you
            a fresh set of parts, rather than editing the last one. */}
        <Editor key={round} />
      </div>

      <button className="btn btn--wide" onClick={nextPrompt}>
        New prompt
      </button>
    </div>
  )
}
