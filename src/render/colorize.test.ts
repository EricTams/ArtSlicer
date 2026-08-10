import { describe, expect, it } from 'vitest'

import { colorizePixel, luminance } from './colorize'

const RED = [255, 0, 0] as const
const BLUE = [0, 0, 255] as const

describe('luminance', () => {
  it('runs 0 to 1 from black to white', () => {
    expect(luminance(0, 0, 0)).toBe(0)
    expect(luminance(255, 255, 255)).toBeCloseTo(1)
  })

  it('weights green far above blue, as the eye does', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255))
    // A plain mean would call these equal and turn blue art nearly black.
    expect(luminance(0, 0, 255)).toBeLessThan(0.1)
  })
})

describe('colorizePixel', () => {
  it('leaves the pixel alone at zero strength', () => {
    expect(colorizePixel(12, 34, 56, RED, 0)).toEqual([12, 34, 56])
  })

  it('takes a white pixel fully to the sprayed colour', () => {
    const [r, g, b] = colorizePixel(255, 255, 255, RED, 1)
    expect(r).toBeCloseTo(255)
    expect(g).toBeCloseTo(0)
    expect(b).toBeCloseTo(0)
  })

  it('keeps shading: a darker pixel stays darker after painting', () => {
    const light = colorizePixel(220, 220, 220, RED, 1)
    const dark = colorizePixel(90, 90, 90, RED, 1)
    expect(light[0]).toBeGreaterThan(dark[0])
  })

  it('leaves black black, whatever is sprayed on it', () => {
    expect(colorizePixel(0, 0, 0, RED, 1)).toEqual([0, 0, 0])
  })

  /** The case multiply got wrong: strong colours could only ever go darker. */
  it('genuinely changes hue on art that already has colours of its own', () => {
    const [r, g, b] = colorizePixel(200, 30, 30, BLUE, 1)
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
    // Multiplying blue over red would have given near-black instead.
    expect(b).toBeGreaterThan(40)
  })

  it('blends part way at part strength', () => {
    const half = colorizePixel(255, 255, 255, RED, 0.5)
    expect(half[0]).toBeCloseTo(255)
    expect(half[1]).toBeCloseTo(127.5)
  })

  it('never leaves the byte range', () => {
    for (const amount of [0, 0.3, 1]) {
      for (const pixel of [
        [0, 0, 0],
        [255, 255, 255],
        [255, 0, 128],
      ] as const) {
        for (const channel of colorizePixel(pixel[0], pixel[1], pixel[2], RED, amount)) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(255)
        }
      }
    }
  })
})
