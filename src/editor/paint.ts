import { toHex } from '../render/tint'

/**
 * The five tubes. Everything else is mixed from these.
 *
 * The three colours are pure primaries rather than agreeable approximations of
 * them. A red tube holding forty units of green and blue carries that muddiness
 * into every mix made from it, and there is no way to take it back out.
 */
export const TUBES = [
  { id: 'red', label: 'Red', rgb: [255, 0, 0] },
  { id: 'green', label: 'Green', rgb: [0, 255, 0] },
  { id: 'blue', label: 'Blue', rgb: [0, 0, 255] },
  { id: 'black', label: 'Black', rgb: [0, 0, 0] },
  { id: 'white', label: 'White', rgb: [255, 255, 255] },
] as const

/**
 * Where each coloured tube sits on the hue circle. Black and white are missing
 * on purpose: they have no hue to offer and only move the value.
 */
const HUE: Partial<Record<TubeId, number>> = { red: 0, green: 120, blue: 240 }

export type TubeId = (typeof TUBES)[number]['id']

export type Jar = Record<TubeId, number>

export const EMPTY_JAR: Jar = { red: 0, green: 0, blue: 0, black: 0, white: 0 }

/** How much a jar holds before the squeeze stops registering. */
export const JAR_CAPACITY = 10

export function jarTotal(jar: Jar): number {
  return TUBES.reduce((sum, tube) => sum + jar[tube.id], 0)
}

export function jarIsEmpty(jar: Jar): boolean {
  return jarTotal(jar) <= 0
}

/**
 * The colour the jar has become.
 *
 * Averaging the tubes channel by channel is what makes paint go muddy: the
 * average of two saturated colours is always less saturated than either, and
 * the average of red and green is a dark olive rather than the yellow anyone
 * squeezing them together is expecting.
 *
 * So hue is treated as the direction it is. Each coloured tube pulls the mix
 * toward its own point on the wheel, and what is left over says how much they
 * agreed — full strength when they point the same way, nothing at all when
 * they cancel. Black and white never enter into it and only move the value,
 * which keeps the two halves of the jar learnable on their own: more white
 * lightens, more black darkens, and the colour underneath stays put.
 */
export function mixedColor(jar: Jar): string {
  const total = jarTotal(jar)
  if (total <= 0) return '#ffffff'

  let x = 0
  let y = 0
  let coloured = 0
  for (const tube of TUBES) {
    const hue = HUE[tube.id]
    const amount = jar[tube.id]
    if (hue === undefined || amount <= 0) continue
    const radians = (hue * Math.PI) / 180
    x += Math.cos(radians) * amount
    y += Math.sin(radians) * amount
    coloured += amount
  }

  // White above the middle, black below, pure colour in between.
  const lightness = 0.5 + (0.5 * (jar.white - jar.black)) / total

  // Nothing but black and white in the jar: a grey off the same scale.
  if (coloured <= 0) return toHex(...hslToRgb(0, 0, lightness))

  /*
   * The primaries sit 120 degrees apart, so any two of them agree exactly by
   * half. Doubling puts an ordinary two-tube mix at full strength — which is
   * the whole point of mixing — while all three together still cancel to grey.
   */
  const agreement = Math.hypot(x, y) / coloured
  const saturation = Math.min(1, agreement * 2)
  const hue = (Math.atan2(y, x) * 180) / Math.PI
  return toHex(...hslToRgb(hue, saturation, lightness))
}

/** Hue in degrees, saturation and lightness 0–1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const sector = ((((h % 360) + 360) % 360) / 60) % 6
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] = sectorRgb(sector, chroma, second)
  const lift = l - chroma / 2
  return [(r + lift) * 255, (g + lift) * 255, (b + lift) * 255]
}

/** Which two channels the hue's sixth of the wheel lights up. */
function sectorRgb(sector: number, chroma: number, second: number): [number, number, number] {
  if (sector < 1) return [chroma, second, 0]
  if (sector < 2) return [second, chroma, 0]
  if (sector < 3) return [0, chroma, second]
  if (sector < 4) return [0, second, chroma]
  if (sector < 5) return [second, 0, chroma]
  return [chroma, 0, second]
}

export function squeeze(jar: Jar, tube: TubeId, amount: number): Jar {
  if (amount <= 0) return jar
  const room = JAR_CAPACITY - jarTotal(jar)
  if (room <= 0) return jar
  return { ...jar, [tube]: jar[tube] + Math.min(amount, room) }
}

/**
 * How much tint one second of spraying lays down. Slow enough that a light
 * dusting is possible, fast enough that a solid colour takes about three
 * seconds rather than testing anyone's patience.
 */
export const SPRAY_PER_SECOND = 0.35
