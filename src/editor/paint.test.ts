import { describe, expect, it } from 'vitest'

import { EMPTY_JAR, JAR_CAPACITY, type Jar, mixedColor, squeeze } from './paint'

const jar = (parts: Partial<Jar>): Jar => ({ ...EMPTY_JAR, ...parts })

describe('a single tube', () => {
  it.each([
    ['red', '#ff0000'],
    ['green', '#00ff00'],
    ['blue', '#0000ff'],
  ] as const)('leaves %s pure', (tube, hex) => {
    expect(mixedColor(jar({ [tube]: 3 }))).toBe(hex)
  })
})

describe('mixing two colours', () => {
  // The whole complaint about averaging: these used to come out muddy.
  it.each([
    ['red + green', { red: 1, green: 1 }, '#ffff00'],
    ['green + blue', { green: 1, blue: 1 }, '#00ffff'],
    ['red + blue', { red: 1, blue: 1 }, '#ff00ff'],
  ])('makes %s a full-strength secondary', (_name, parts, hex) => {
    expect(mixedColor(jar(parts))).toBe(hex)
  })

  it('leans the hue toward whichever tube was squeezed harder', () => {
    expect(mixedColor(jar({ red: 2, green: 1 }))).toBe('#ff8000')
    expect(mixedColor(jar({ red: 1, green: 2 }))).toBe('#80ff00')
  })

  it('is the ratio that matters, not the quantity', () => {
    expect(mixedColor(jar({ red: 1, green: 1 }))).toBe(mixedColor(jar({ red: 4, green: 4 })))
  })
})

describe('black and white', () => {
  it('tints without shifting the hue', () => {
    expect(mixedColor(jar({ red: 1, white: 1 }))).toBe('#ff8080')
  })

  it('shades without shifting the hue', () => {
    expect(mixedColor(jar({ red: 1, black: 1 }))).toBe('#800000')
  })

  it('makes a grey on their own, with no hue to carry', () => {
    expect(mixedColor(jar({ black: 1, white: 1 }))).toBe('#808080')
  })

  it('reaches the ends of the scale', () => {
    expect(mixedColor(jar({ white: 2 }))).toBe('#ffffff')
    expect(mixedColor(jar({ black: 2 }))).toBe('#000000')
  })
})

describe('mixing everything', () => {
  it('cancels to grey, because the three primaries pull evenly apart', () => {
    const mixed = mixedColor(jar({ red: 1, green: 1, blue: 1 }))
    const channels = [1, 3, 5].map((at) => parseInt(mixed.slice(at, at + 2), 16))
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(2)
  })
})

describe('the empty jar', () => {
  it('is white rather than nothing, so the preview has something to show', () => {
    expect(mixedColor(EMPTY_JAR)).toBe('#ffffff')
  })
})

describe('squeeze', () => {
  it('stops accepting paint once the jar is full', () => {
    const full = squeeze(EMPTY_JAR, 'red', JAR_CAPACITY + 5)
    expect(full.red).toBe(JAR_CAPACITY)
    expect(squeeze(full, 'blue', 1).blue).toBe(0)
  })
})
