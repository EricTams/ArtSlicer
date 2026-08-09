import { useState } from 'react'

import type { Scene } from '../shared/scene'
import { Editor } from './Editor'
import { usePiecesLoaded } from './usePiecesLoaded'

/**
 * Standalone editor at #/editor. Exists so the build tools can be developed
 * and playtested without standing up a lobby and two devices first — the
 * editor is the part of this game that needs the most iteration.
 */
export function EditorPlayground() {
  const loaded = usePiecesLoaded()
  const [scene, setScene] = useState<Scene | null>(null)

  if (!loaded) {
    return (
      <div className="screen screen--center">
        <p className="tagline">Loading junk…</p>
      </div>
    )
  }

  return (
    <>
      <Editor onChange={setScene} />
      <p
        className="muted"
        style={{ textAlign: 'center', fontSize: '0.7rem', padding: '0 8px 8px' }}
      >
        {scene?.pieces.length ?? 0} {scene?.pieces.length === 1 ? 'piece' : 'pieces'} ·{' '}
        {JSON.stringify(scene).length} bytes on the wire
      </p>
    </>
  )
}
