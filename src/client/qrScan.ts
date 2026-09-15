/**
 * Reading the host's QR code with the phone's own camera.
 *
 * The phone camera app can already do this, but what it does with what it
 * finds is open the link in the browser. A player who added ArtSlicer to their
 * home screen is then out of the app and in a fresh Safari window, with a
 * different store, no wake lock, and browser chrome over the bottom of the
 * canvas. Scanning from inside the app keeps them where they are.
 */

/**
 * The long edge the camera's picture is squeezed onto before it is decoded.
 *
 * Decoding costs what the picture holds, and phones hand over far more than
 * finding a QR code needs. Small enough to be cheap every tenth of a second on
 * a mid-range phone, big enough that a code held at arm's length from a laptop
 * across the room is still several pixels a module.
 */
export const SCAN_EDGE = 640

/** Roughly ten looks a second, which is faster than anyone can aim a phone. */
export const SCAN_INTERVAL_MS = 100

/** The size to decode a camera frame at: the same picture, no bigger than needed. */
export function frameSize(width: number, height: number, edge = SCAN_EDGE): {
  width: number
  height: number
} {
  const longest = Math.max(width, height)
  // Before the camera has delivered anything there is nothing to scale.
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 }

  // Never upscale: enlarging a frame invents no detail and costs real time.
  const scale = Math.min(1, edge / longest)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * What the decoder needs of a camera frame, which is what an `ImageData`
 * already is — named so that the decoder can be handed a picture from
 * anywhere, a test's drawing of one included.
 */
export interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type Decoder = (frame: Frame) => string | null

/**
 * The QR decoder, fetched when the scanner opens.
 *
 * A quarter of a megabyte of decoder is not something to make every player
 * download before they can read the front screen, and most never open the
 * scanner at all. Loaded on its own, it arrives while the camera is still
 * warming up.
 */
export async function loadDecoder(): Promise<Decoder> {
  const { default: jsQR } = await import('jsqr')
  return (frame) =>
    jsQR(frame.data, frame.width, frame.height, {
      // The host draws dark modules on white. Looking for the negative as well
      // would double what every frame costs, to find codes we never produce.
      inversionAttempts: 'dontInvert',
    })?.data ?? null
}

/**
 * Whether this device can scan at all.
 *
 * Cameras are only offered to a secure page, and on one that isn't — the dev
 * server over a LAN address, most of all — `mediaDevices` is simply absent
 * rather than present and refusing. So this is one check, not two.
 */
export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/**
 * What to tell the player when the camera won't start.
 *
 * Each of these has a different thing to do about it, which is the reason they
 * are not one message: a permission the player can grant, a camera that isn't
 * there, and a camera another app is holding.
 */
export function cameraProblem(error: unknown): string {
  switch (nameOf(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The camera needs permission before it can scan. Type the code instead.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera on this device. Type the code instead.'
    case 'NotReadableError':
    case 'AbortError':
      return 'Something else is using the camera. Close it and try again.'
    default:
      return 'The camera didn’t start. Type the code instead.'
  }
}

/** DOMExceptions carry the useful part in `name`; anything else may not have one. */
function nameOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : ''
}
