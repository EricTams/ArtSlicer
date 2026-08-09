import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { encodePng } from './png.mjs'

/**
 * Generates the placeholder "junk" pieces.
 *
 * These follow the art spec the renderer depends on: tinting is a multiply
 * blend, which can only darken, so every sprite is drawn LIGHT — near-white
 * with soft grey shading from a top-left light. Real art must match this or
 * tinted pieces will read as muddy silhouettes.
 *
 * Run: node scripts/make-placeholder-pieces.mjs
 */

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pieces')
const SIZE = 256
/** Samples per axis; 3x3 is enough to hide the stair-stepping at this size. */
const SS = 3

// --- signed distance helpers: negative inside, positive outside -------------

const circle = (r) => (x, y) => Math.hypot(x, y) - r

const box =
  (w, h, radius = 0) =>
  (x, y) => {
    const dx = Math.abs(x) - (w - radius)
    const dy = Math.abs(y) - (h - radius)
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
    return outside + Math.min(Math.max(dx, dy), 0) - radius
  }

const ring = (outer, thickness) => (x, y) => Math.abs(Math.hypot(x, y) - outer) - thickness

/** Regular polygon via the max of its half-plane distances. */
const polygon = (r, sides, rotate = -Math.PI / 2) => (x, y) => {
  let d = -Infinity
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i * 2 * Math.PI) / sides
    d = Math.max(d, x * Math.cos(a) + y * Math.sin(a) - r)
  }
  return d
}

const star =
  (outer, inner, points) =>
  (x, y) => {
    const angle = Math.atan2(y, x)
    const step = Math.PI / points
    const phase = ((angle % (2 * step)) + 2 * step) % (2 * step)
    // Interpolate the radius between spike and valley.
    const t = Math.abs(phase - step) / step
    return Math.hypot(x, y) - (inner + (outer - inner) * t)
  }

const capsule = (length, r) => (x, y) => Math.hypot(Math.max(Math.abs(x) - length, 0), y) - r

/** Subtracts `b` from `a`. */
const subtract = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y))
const union = (a, b) => (x, y) => Math.min(a(x, y), b(x, y))

const translate = (fn, tx, ty) => (x, y) => fn(x - tx, y - ty)

const gear = (r, teeth) => (x, y) => {
  const angle = Math.atan2(y, x)
  const wobble = Math.cos(angle * teeth) * 0.09 * r
  return Math.hypot(x, y) - (r + wobble)
}

const PIECES = [
  { id: 'bar', category: 'block', sdf: box(96, 30, 12) },
  { id: 'plank', category: 'block', sdf: box(110, 14, 6) },
  { id: 'disc', category: 'round', sdf: circle(96) },
  { id: 'ring', category: 'round', sdf: ring(80, 20) },
  { id: 'capsule', category: 'round', sdf: capsule(55, 42) },
  { id: 'triangle', category: 'angular', sdf: polygon(100, 3) },
  { id: 'diamond', category: 'angular', sdf: polygon(96, 4, 0) },
  { id: 'hexagon', category: 'angular', sdf: polygon(94, 6, 0) },
  { id: 'star', category: 'angular', sdf: star(104, 46, 5) },
  { id: 'gear', category: 'mech', sdf: subtract(gear(94, 9), circle(30)) },
  { id: 'crescent', category: 'round', sdf: subtract(circle(96), translate(circle(82), 44, -18)) },
  { id: 'blob', category: 'organic', sdf: union(translate(circle(62), -28, 10), translate(circle(74), 32, -8)) },
]

/**
 * Shades a pixel: light from the top-left, plus a subtle rim so edges stay
 * readable against a light background.
 */
function shade(nx, ny, edge) {
  const light = (-nx - ny) / Math.SQRT2 // -1 (away) .. 1 (toward the light)
  const lambert = 0.5 + 0.5 * light
  const base = 214 + 40 * lambert // 214..254: light, as the multiply tint needs
  const rim = 1 - Math.min(1, edge / 14) // darken close to the outline
  return Math.max(120, Math.round(base - 46 * rim * rim))
}

function render(sdf) {
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4)
  const half = SIZE / 2
  const epsilon = 0.75

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let coverage = 0
      let sumDistance = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px - half + (sx + 0.5) / SS
          const y = py - half + (sy + 0.5) / SS
          const d = sdf(x, y)
          if (d <= 0) coverage++
          sumDistance += d
        }
      }

      const index = (py * SIZE + px) * 4
      if (coverage === 0) continue

      const x = px - half + 0.5
      const y = py - half + 0.5
      const d = sumDistance / (SS * SS)

      // Gradient of the distance field is the surface normal.
      const nx = (sdf(x + epsilon, y) - sdf(x - epsilon, y)) / (2 * epsilon)
      const ny = (sdf(x, y + epsilon) - sdf(x, y - epsilon)) / (2 * epsilon)
      const length = Math.hypot(nx, ny) || 1

      const value = shade(nx / length, ny / length, -d)
      rgba[index] = value
      rgba[index + 1] = value
      rgba[index + 2] = value
      rgba[index + 3] = Math.round((coverage / (SS * SS)) * 255)
    }
  }

  return rgba
}

// Category lives in the directory name, so the manifest builder can derive it
// without a sidecar file and real art can be dropped in the same way.
for (const piece of PIECES) {
  const dir = join(OUT_DIR, piece.category)
  mkdirSync(dir, { recursive: true })
  const png = encodePng(SIZE, SIZE, render(piece.sdf))
  writeFileSync(join(dir, `${piece.id}.png`), png)
  console.log(`${piece.category}/${piece.id}.png  ${(png.length / 1024).toFixed(1)} kB`)
}

console.log(`\n${PIECES.length} placeholder pieces written to public/pieces/`)
