import { useEffect } from 'react'

/**
 * Keeps the screen awake while hosting. The host holds all game state and
 * every connection, so a phone that dims and locks itself during a two-minute
 * build phase would stall the whole room.
 *
 * This only covers the screen sleeping. The lock is released automatically
 * whenever the page is hidden, so it cannot help when the host switches apps —
 * that case is handled by reconnecting, not prevented.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async (): Promise<void> => {
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // Denied (low battery, permissions policy). Play continues; the screen
        // just isn't held awake.
      }
    }

    // The lock dies when the page is hidden, so take it again on return.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
