import { useEffect, useState } from 'react'

import { loadAllPieces } from '../render/pieces'

/**
 * Sprites must be decoded before the canvas draws them — decoding mid-round
 * would stall the editor at exactly the wrong moment.
 */
export function usePiecesLoaded(): boolean {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadAllPieces().then(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return loaded
}
