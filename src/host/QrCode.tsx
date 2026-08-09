import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

interface Props {
  value: string
  size?: number
}

/**
 * The join link as a QR code. Rendered light-on-dark inverted (dark modules on
 * white) because phone cameras read that far more reliably than the reverse,
 * even on a dark page.
 */
export function QrCode({ value, size = 320 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 2,
      // A quiet zone plus real white is what makes this scannable across a room.
      color: { dark: '#12101a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
  }, [value, size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ borderRadius: 12, display: 'block' }}
    />
  )
}
