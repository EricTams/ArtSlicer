export type Rgb = readonly [number, number, number]

/**
 * Rec. 709 luminance, 0–1. The weights are perceptual rather than an average:
 * green carries most of the apparent brightness, blue almost none, so a plain
 * mean would turn a saturated blue nearly black and a yellow nearly white.
 */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * Recolours one pixel toward `target`, keeping how light or dark it was.
 *
 * Multiplying the paint over the sprite would only ever darken it, which works
 * for pale artwork and ruins anything that already has strong colours of its
 * own — spraying blue on a red car would give near-black rather than purple.
 * Driving the target colour by the pixel's brightness instead keeps the shading
 * and line work while genuinely changing the hue, whatever the art looks like.
 *
 * `amount` blends between the original pixel and that recoloured version, so a
 * light spray is a tint and a long one is a repaint.
 */
export function colorizePixel(r: number, g: number, b: number, target: Rgb, amount: number): Rgb {
  const light = luminance(r, g, b)
  return [
    r + (target[0] * light - r) * amount,
    g + (target[1] * light - g) * amount,
    b + (target[2] * light - b) * amount,
  ]
}
