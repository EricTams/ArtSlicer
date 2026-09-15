import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'

import { roomCodeFromScan } from '../shared/roomCode'
import { type Frame, SCAN_EDGE, cameraProblem, frameSize, loadDecoder } from './qrScan'

/**
 * The host's QR code as a picture, without a screen to draw it on.
 *
 * Built from the same encoder the host screen uses, so this asks the question
 * that matters end to end: does what the host puts up decode back to the code
 * it was made from? A camera adds blur and skew this cannot, but the encoder
 * settings, the colours and the decoder's options are all pinned here.
 */
function drawQr(text: string, modulePixels = 4, quietModules = 4): Frame {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const modules = qr.modules.size
  const width = (modules + quietModules * 2) * modulePixels

  // White page, dark modules — the way the host draws it, which is the way
  // phone cameras read most reliably.
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (!qr.modules.data[row * modules + column]) continue
      const left = (column + quietModules) * modulePixels
      const top = (row + quietModules) * modulePixels
      for (let y = top; y < top + modulePixels; y++) {
        for (let x = left; x < left + modulePixels; x++) {
          const at = (y * width + x) * 4
          data[at] = 0x12
          data[at + 1] = 0x10
          data[at + 2] = 0x1a
        }
      }
    }
  }
  return { data, width, height: width }
}

describe('frameSize', () => {
  it('squeezes a camera frame down to the edge it decodes at', () => {
    const size = frameSize(1920, 1080)
    expect(size.width).toBe(SCAN_EDGE)
    // The same picture, not a squashed one: a code is only findable while it
    // is still square.
    expect(size.width / size.height).toBeCloseTo(1920 / 1080, 2)
  })

  it('works the same way up', () => {
    const size = frameSize(1080, 1920)
    expect(size.height).toBe(SCAN_EDGE)
    expect(size.width).toBe(Math.round((1080 / 1920) * SCAN_EDGE))
  })

  it('leaves a small frame alone rather than enlarging it', () => {
    expect(frameSize(320, 240)).toEqual({ width: 320, height: 240 })
  })

  it('has nothing to scale before the camera has delivered a frame', () => {
    expect(frameSize(0, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('cameraProblem', () => {
  it('says what to do about it, which differs by what went wrong', () => {
    expect(cameraProblem({ name: 'NotAllowedError' })).toMatch(/permission/i)
    expect(cameraProblem({ name: 'NotFoundError' })).toMatch(/no camera/i)
    expect(cameraProblem({ name: 'NotReadableError' })).toMatch(/using the camera/i)
  })

  it('still says something when the failure is nothing it knows', () => {
    expect(cameraProblem(new Error('boom'))).toBeTruthy()
    expect(cameraProblem(undefined)).toBeTruthy()
  })
})

describe('reading the host’s code', () => {
  it('decodes the link the host puts on screen back to the room code', async () => {
    const decode = await loadDecoder()
    const text = decode(drawQr('https://example.com/ArtSlicer/#/join/ACDF'))

    expect(text).toBe('https://example.com/ArtSlicer/#/join/ACDF')
    expect(roomCodeFromScan(text!)).toBe('ACDF')
  })

  it('finds nothing in a picture with no code in it', async () => {
    const decode = await loadDecoder()
    expect(decode({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 })).toBeNull()
  })
})
