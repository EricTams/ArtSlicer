import { useEffect, useState } from 'react'

/**
 * Whether this device is big enough to act as the room's shared screen.
 *
 * Deliberately based on viewport width rather than user-agent sniffing: what
 * matters is whether a gallery of eight drawings is legible from across a
 * room, and a narrow laptop window is no better for that than a phone.
 */
const BIG_SCREEN_QUERY = '(min-width: 900px)'

/**
 * `?screen=small` / `?screen=big` forces the choice, so both layouts can be
 * developed and checked on one machine without resizing anything.
 */
function override(): boolean | null {
  const value = new URLSearchParams(window.location.search).get('screen')
  if (value === 'small') return false
  if (value === 'big') return true
  return null
}

export function useBigScreen(): boolean {
  const [big, setBig] = useState(() => override() ?? window.matchMedia(BIG_SCREEN_QUERY).matches)

  useEffect(() => {
    if (override() !== null) return
    const query = window.matchMedia(BIG_SCREEN_QUERY)
    const onChange = (event: MediaQueryListEvent): void => setBig(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return big
}
