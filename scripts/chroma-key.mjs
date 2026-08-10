/**
 * Turns a flat-chroma render into a trimmed, transparent piece sprite.
 *
 * The image model will not emit alpha, so pieces are generated against a flat
 * pure-green field and keyed here. Keying on colour distance rather than a
 * border flood fill is deliberate: plenty of these shapes have enclosed holes
 * (fishnet mesh, a ring, bunting gaps) that a flood fill from the edge would
 * leave filled in.
 */

/**
 * Green is the default backdrop. Magenta exists for the pieces that are
 * themselves green — a cactus, a watermelon — where the spill and contamination
 * rules below would otherwise chew into the subject.
 *
 * `dominates` decides whether a pixel is still contaminated field once the fill
 * has left the perfectly flat area; `despill` pulls the backdrop's cast back out
 * of a blended edge pixel and reports how much it had to remove.
 */
export const CHROMAS = {
  green: {
    rgb: [0, 255, 0],
    dominates: (r, g, b) => g > r && g > b && b < 120 && g > 110,
    despill: (r, g, b) => ({ colour: [r, Math.max(r, b), b], removed: g - Math.max(r, b) }),
  },
  magenta: {
    rgb: [255, 0, 255],
    dominates: (r, g, b) => r > g && b > g && g < 120 && (r + b) / 2 > 110,
    despill: (r, g, b) => {
      const level = Math.min(r, b)
      const cap = Math.max(g, level - (level - g) / 2)
      return { colour: [Math.min(r, cap + (r - level)), g, Math.min(b, cap + (b - level))], removed: level - cap }
    },
  },
}

// Wide enough to swallow the compression noise around a flat synthetic field,
// tight enough that a natural green (cactus, watermelon rind) is never close.
const KEY_DISTANCE = 60

// Enough to walk into the narrow gaps in a fringe or a mesh without eating far
// into a genuinely green subject.
const EDGE_PASSES = 4

function distanceToChroma(rgba, index, chroma) {
  const dr = rgba[index] - chroma.rgb[0]
  const dg = rgba[index + 1] - chroma.rgb[1]
  const db = rgba[index + 2] - chroma.rgb[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * Drops the chroma field to alpha 0 and pulls the green cast out of the
 * anti-aliased pixels that survive around the edge.
 */
function key(width, height, rgba, chroma) {
  const out = new Uint8ClampedArray(rgba)
  const isBackground = new Uint8Array(width * height)

  const queue = []
  for (let i = 0; i < width * height; i++) {
    if (distanceToChroma(rgba, i * 4, chroma) < KEY_DISTANCE) {
      isBackground[i] = 1
      out[i * 4 + 3] = 0
      queue.push(i)
    }
  }

  // The render is not perfectly flat where a narrow gap sits against a warm
  // colour: the model bleeds the subject into the field, so the gaps between a
  // fringe's tassels come back lime rather than chroma. Grow the keyed region
  // into whatever the backdrop still dominates. The fill is connected, so it
  // only reaches contamination that opens onto the backdrop — which is why a
  // green subject has to be shot on magenta rather than relying on this.
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]
    const x = i % width
    const y = (i / width) | 0

    for (const next of [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ]) {
      if (next < 0 || isBackground[next]) continue

      if (!chroma.dominates(rgba[next * 4], rgba[next * 4 + 1], rgba[next * 4 + 2])) continue

      isBackground[next] = 1
      out[next * 4 + 3] = 0
      queue.push(next)
    }
  }

  // Edge pixels are a blend of subject and backdrop, so they carry its cast.
  // Only pixels touching the keyed field are treated this way, which leaves a
  // subject that happens to share the backdrop's hue alone in the middle.
  //
  // The pass runs a few times, each round treating what it just made
  // transparent as more background. A single round leaves chroma stranded in
  // any gap narrower than the blend either side of it — the slots between a
  // lampshade's fringe tassels being the case that found this.
  for (let pass = 0; pass < EDGE_PASSES; pass++) {
    const reached = []

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (isBackground[i]) continue

        const touchesBackground =
          (x > 0 && isBackground[i - 1]) ||
          (x < width - 1 && isBackground[i + 1]) ||
          (y > 0 && isBackground[i - width]) ||
          (y < height - 1 && isBackground[i + width])
        if (!touchesBackground) continue

        const { colour, removed } = chroma.despill(out[i * 4], out[i * 4 + 1], out[i * 4 + 2])
        if (removed <= 0) continue

        // Whatever cast had to be pulled out of the pixel is the share of it
        // that was backdrop, so it becomes transparency.
        out[i * 4] = colour[0]
        out[i * 4 + 1] = colour[1]
        out[i * 4 + 2] = colour[2]
        out[i * 4 + 3] = Math.round(255 * (1 - Math.min(1, removed / 255)))
        if (out[i * 4 + 3] < 128) reached.push(i)
      }
    }

    if (!reached.length) break
    for (const i of reached) isBackground[i] = 1
  }

  return out
}

/** Bounding box of everything that is not fully transparent. */
function contentBounds(width, height, rgba) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 8) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) throw new Error('Keyed image is fully transparent')
  return { minX, minY, maxX, maxY }
}

/**
 * Box-filter resample. Averaging happens with premultiplied alpha so the
 * transparent side of an edge cannot drag colour into the visible pixels.
 */
function resample(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4)

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor((y * sourceHeight) / targetHeight)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sourceHeight) / targetHeight))

    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor((x * sourceWidth) / targetWidth)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sourceWidth) / targetWidth))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sourceWidth + sx) * 4
          const alpha = source[i + 3] / 255
          r += source[i] * alpha
          g += source[i + 1] * alpha
          b += source[i + 2] * alpha
          a += source[i + 3]
          count++
        }
      }

      const i = (y * targetWidth + x) * 4
      const alpha = a / count
      out[i] = alpha > 0 ? (r / count) * (255 / alpha) : 0
      out[i + 1] = alpha > 0 ? (g / count) * (255 / alpha) : 0
      out[i + 2] = alpha > 0 ? (b / count) * (255 / alpha) : 0
      out[i + 3] = alpha
    }
  }

  return out
}

/**
 * Keys, trims and scales a decoded render so its longest side is `maxSize`.
 * Returns the sprite plus a little QA detail for the caller to report on.
 */
export function keyAndTrim({ width, height, rgba }, maxSize, { padding = 8, chroma = 'green' } = {}) {
  const keyed = key(width, height, rgba, CHROMAS[chroma])
  const bounds = contentBounds(width, height, keyed)

  // The subject running off the edge means the model cropped it, which no
  // amount of keying can recover — the caller reports it for a re-roll.
  const clipped =
    bounds.minX === 0 || bounds.minY === 0 || bounds.maxX === width - 1 || bounds.maxY === height - 1

  const minX = Math.max(0, bounds.minX - padding)
  const minY = Math.max(0, bounds.minY - padding)
  const maxX = Math.min(width - 1, bounds.maxX + padding)
  const maxY = Math.min(height - 1, bounds.maxY + padding)
  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1

  const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4)
  for (let y = 0; y < cropHeight; y++) {
    const from = ((minY + y) * width + minX) * 4
    cropped.set(keyed.subarray(from, from + cropWidth * 4), y * cropWidth * 4)
  }

  const scale = Math.min(1, maxSize / Math.max(cropWidth, cropHeight))
  const targetWidth = Math.max(1, Math.round(cropWidth * scale))
  const targetHeight = Math.max(1, Math.round(cropHeight * scale))
  const resized = resample(cropped, cropWidth, cropHeight, targetWidth, targetHeight)

  let opaque = 0
  for (let i = 0; i < targetWidth * targetHeight; i++) {
    if (resized[i * 4 + 3] > 200) opaque++
  }

  return {
    width: targetWidth,
    height: targetHeight,
    rgba: resized,
    coverage: opaque / (targetWidth * targetHeight),
    clipped,
  }
}
