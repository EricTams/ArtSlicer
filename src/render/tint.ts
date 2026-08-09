import type { Tint } from '../shared/scene'

/**
 * Pre-tinted sprite cache.
 *
 * Konva's filter pipeline needs a `cache()` call per node and re-runs whenever
 * a node changes, which is far too slow on a phone with 25 pieces on screen.
 * Instead each (sprite, colour, strength) combination is composited once into
 * an offscreen canvas and reused by every instance, on the phone and the host.
 */
export type TintSource = HTMLImageElement | HTMLCanvasElement

/**
 * Colours are mixed by hand now, so every spray could produce a slightly
 * different one. Quantising the cache key keeps a long game from accumulating
 * hundreds of near-identical canvases nobody can tell apart.
 */
const COLOR_STEPS = 24
const AMOUNT_STEPS = 12

/** Well above what one scene can use, but bounded so memory can't run away. */
const MAX_ENTRIES = 240

/** Insertion-ordered, so the oldest key is the first one Map yields. */
const cache = new Map<string, HTMLCanvasElement>()

export function tinted(pieceId: string, image: TintSource, tint: Tint | undefined): TintSource {
  if (!tint || tint.amount <= 0) return image

  const [r, g, b] = quantizeColor(tint.color)
  const amount = Math.round(tint.amount * AMOUNT_STEPS) / AMOUNT_STEPS
  if (amount <= 0) return image

  const key = `${pieceId}:${r},${g},${b}:${amount}`
  const hit = cache.get(key)
  if (hit) {
    // Refresh recency so a colour still in use is not the first evicted.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  const built = build(image, `rgb(${r},${g},${b})`, amount)
  // A zero-sized source (image not decoded yet) would poison the cache.
  if (!built) return image

  cache.set(key, built)
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return built
}

function build(image: TintSource, color: string, amount: number): HTMLCanvasElement | null {
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

  // 2. Multiply the colour through it, at the strength it was sprayed.
  //    Multiply (rather than a flat fill) preserves the sprite's shading
  //    instead of flattening it to a silhouette, and the alpha is what makes a
  //    light spray a tint rather than a repaint.
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = amount
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)

  // 3. Multiply also painted the transparent regions, so mask back to the
  //    sprite's original alpha.
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(image, 0, 0)

  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

function quantizeColor(hex: string): [number, number, number] {
  const value = parseHex(hex)
  const step = 255 / COLOR_STEPS
  return [
    Math.round(Math.round(value[0] / step) * step),
    Math.round(Math.round(value[1] / step) * step),
    Math.round(Math.round(value[2] / step) * step),
  ]
}

export function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ]
}

export function toHex(r: number, g: number, b: number): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Test seam and a way to reclaim memory between games. */
export function clearTintCache(): void {
  cache.clear()
}

export function tintCacheSize(): number {
  return cache.size
}
