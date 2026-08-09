import { toHex } from '../render/tint'

/** The five tubes. Everything else is mixed from these. */
export const TUBES = [
  { id: 'red', label: 'Red', rgb: [220, 40, 40] },
  { id: 'green', label: 'Green', rgb: [40, 190, 80] },
  { id: 'blue', label: 'Blue', rgb: [50, 90, 230] },
  { id: 'black', label: 'Black', rgb: [20, 20, 26] },
  { id: 'white', label: 'White', rgb: [250, 250, 250] },
] as const

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
 * The mixed colour is the ratio of what was squeezed in — a weighted average
 * of the tube colours. Predictable enough that players can learn it (more
 * white lightens, more black darkens) without needing real pigment chemistry.
 */
export function mixedColor(jar: Jar): string {
  const total = jarTotal(jar)
  if (total <= 0) return '#ffffff'

  let r = 0
  let g = 0
  let b = 0
  for (const tube of TUBES) {
    const share = jar[tube.id] / total
    r += tube.rgb[0] * share
    g += tube.rgb[1] * share
    b += tube.rgb[2] * share
  }
  return toHex(r, g, b)
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
