import { isUntinted, paletteColor } from './palette'

/**
 * Pre-tinted sprite cache.
 *
 * Konva's filter pipeline needs a `cache()` call per node and re-runs whenever
 * a node changes, which is far too slow on a phone with 25 pieces on screen.
 * Instead each (sprite, colour) pair is composited once into an offscreen
 * canvas and reused by every instance, on both the phone and the host.
 */
const cache = new Map<string, HTMLCanvasElement>()

export type TintSource = HTMLImageElement | HTMLCanvasElement

/**
 * Returns a canvas of `image` tinted to the palette colour, or the original
 * image when the tint is a no-op.
 */
export function tinted(pieceId: string, image: TintSource, tint: number | undefined): TintSource {
  if (isUntinted(tint)) return image

  const key = `${pieceId}:${tint}`
  const hit = cache.get(key)
  if (hit) return hit

  const built = buildTinted(image, paletteColor(tint))
  // A zero-sized source (image not decoded yet) would poison the cache.
  if (!built) return image

  cache.set(key, built)
  return built
}

function buildTinted(image: TintSource, color: string): HTMLCanvasElement | null {
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 1. The sprite as drawn.
  ctx.drawImage(image, 0, 0)

  // 2. Multiply the colour through it. Multiply (rather than a flat fill)
  //    preserves the sprite's shading instead of flattening it to a silhouette.
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)

  // 3. Multiply also painted the transparent regions, so mask back to the
  //    sprite's original alpha.
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(image, 0, 0)

  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

/** Test seam and a way to reclaim memory between games. */
export function clearTintCache(): void {
  cache.clear()
}

export function tintCacheSize(): number {
  return cache.size
}
