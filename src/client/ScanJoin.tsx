import { useEffect, useRef, useState } from 'react'

import { roomCodeFromScan } from '../shared/roomCode'
import {
  SCAN_INTERVAL_MS,
  cameraProblem,
  frameSize,
  loadDecoder,
} from './qrScan'

interface Props {
  /** Called once, with the code read off the host's screen. */
  onCode(code: string): void
  onClose(): void
}

/**
 * The camera, pointed at the host's QR code.
 *
 * There is no shutter and no confirm step: the player aims the phone and the
 * code is read, because the only thing they could confirm is that they are
 * looking at the right screen — which they can already see they are.
 */
export function ScanJoin({ onCode, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // The scan loop is started once and outlives any re-render, so it reads the
  // callback through a ref rather than closing over the one it started with.
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    /*
     * Everything below is torn down by this flag. The camera is asked for
     * before it is granted, so a scanner closed in between — or React's second
     * pass in development — would otherwise leave a stream running with
     * nothing holding it and the phone's camera light on.
     */
    let stopped = false
    let frame = 0
    let stream: MediaStream | null = null

    const stop = (): void => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }

    const run = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, where a phone has one. `ideal` rather than a hard
          // requirement, so a laptop still scans with the only camera it has.
          video: { facingMode: { ideal: 'environment' } },
        })
      } catch (error) {
        if (!stopped) setProblem(cameraProblem(error))
        return
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      video.srcObject = stream
      // Muted and inline, so iOS plays it without asking and without taking
      // the picture full-screen out of our hands.
      await video.play().catch(() => undefined)

      const decode = await loadDecoder()
      if (stopped) return

      // Reused every frame: allocating a canvas ten times a second is work the
      // decoder could have had instead.
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) {
        setProblem(cameraProblem(undefined))
        return
      }

      let last = 0
      const look = (now: number): void => {
        frame = requestAnimationFrame(look)
        if (now - last < SCAN_INTERVAL_MS) return
        last = now
        if (video.readyState < video.HAVE_CURRENT_DATA) return

        const size = frameSize(video.videoWidth, video.videoHeight)
        if (size.width === 0) return

        canvas.width = size.width
        canvas.height = size.height
        context.drawImage(video, 0, 0, size.width, size.height)

        const text = decode(context.getImageData(0, 0, size.width, size.height))
        const code = text ? roomCodeFromScan(text) : null
        // Anything else in shot — a poster, a wifi code — is simply not a
        // reason to stop looking for the one we came for.
        if (!code) return

        stop()
        onCodeRef.current(code)
      }
      frame = requestAnimationFrame(look)
    }

    void run()
    return stop
  }, [])

  return (
    <div className="scan">
      <video
        ref={videoRef}
        className="scan__video"
        muted
        autoPlay
        playsInline
        // Nothing here is for the player to hear or control; it is a viewfinder.
        aria-hidden="true"
      />

      <div className="scan__chrome">
        <p className="scan__hint" role="status">
          {problem ?? 'Point at the code on the host’s screen'}
        </p>
        {/* Only drawn while there is something to aim, so the frame never
            hangs over a message explaining that there is no camera. */}
        {!problem && <div className="scan__frame" aria-hidden="true" />}
        <button type="button" className="btn btn--wide scan__close" onClick={onClose}>
          {problem ? 'Back' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
