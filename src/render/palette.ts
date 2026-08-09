/**
 * A fixed palette rather than a free colour picker: faster to tap on a phone,
 * and it keeps everyone's creations looking like they belong to one game.
 *
 * Tinting is a multiply blend, which can only darken. Source sprites are
 * therefore drawn light — near-white with grey shading — and these swatches
 * are mid-tone so the shading still reads after the multiply.
 */
export const PALETTE: readonly string[] = [
  '#ffffff', // untinted, keeps the sprite's own tones
  '#ff5a5a',
  '#ff8a3d',
  '#ffc44d',
  '#f6ef6a',
  '#5ce68f',
  '#3dbb8a',
  '#4dd8ff',
  '#5b8dff',
  '#9a7dff',
  '#ff7ad9',
  '#c98a5b',
  '#8d8fa3',
  '#3a3a48',
]

export const DEFAULT_TINT = 0

export function paletteColor(index: number | undefined): string {
  if (index === undefined) return PALETTE[DEFAULT_TINT]!
  return PALETTE[index] ?? PALETTE[DEFAULT_TINT]!
}

/** Index 0 is a no-op, so the tint pass can be skipped entirely. */
export function isUntinted(index: number | undefined): boolean {
  return index === undefined || index === DEFAULT_TINT
}
