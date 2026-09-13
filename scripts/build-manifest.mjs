import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePng } from './png.mjs'

/**
 * Builds src/assets/pieces.json from whatever PNGs are in public/pieces.
 *
 * Layout is public/pieces/<category>/<id>.png — the directory names the
 * category, so adding real art means dropping files in and re-running this.
 * Baking dimensions into the manifest lets the editor lay out the piece tray
 * before any image has finished decoding.
 *
 * Two more things are measured off the alpha while the file is open, because
 * the shape of the art is not something the rectangle around it can answer:
 *
 * - Where its weight actually is, so a combo turns about the middle of what
 *   you can see rather than the middle of the box. A windsock is a cone and a
 *   lot of streamers, and those are 28 per cent of its height apart.
 * - A coarse grid of where there is anything at all, so a slice can tell
 *   whether it has divided the art or merely passed by it. The pieces this
 *   matters for are the ones full of gaps, which is exactly where a convex
 *   outline would have bridged the gaps and said yes to everything.
 *
 * Run: npm run pieces
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PIECES_DIR = join(ROOT, 'public', 'pieces')
const OUT_FILE = join(ROOT, 'src', 'assets', 'pieces.json')

/** Anything this faint is a cutout's soft edge rather than art. */
const OPAQUE = 16

/**
 * How wide the occupancy grid is. Sixteen puts a cell at about 16px on a
 * 256px piece — fine enough to see the gaps in a string of bunting, coarse
 * enough that the whole grid is 32 bytes.
 */
const GRID = 16

function measure(width, height, rgba) {
  const cells = new Uint8Array(GRID * GRID)
  let ink = 0
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] <= OPAQUE) continue
      ink += 1
      sumX += x
      sumY += y
      const cellX = Math.min(GRID - 1, Math.floor((x / width) * GRID))
      const cellY = Math.min(GRID - 1, Math.floor((y / height) * GRID))
      cells[cellY * GRID + cellX] = 1
    }
  }

  // A sprite with no opaque pixel at all has nothing to say; the middle of its
  // box is as good an answer as any, and the grid stays empty.
  const cx = ink ? sumX / ink : width / 2
  const cy = ink ? sumY / ink : height / 2

  const bytes = Buffer.alloc((GRID * GRID) / 8)
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) bytes[i >> 3] |= 1 << (i & 7)
  }

  return {
    // In the same frame everything else uses: the middle of the sprite is 0,0.
    centroid: {
      x: Math.round((cx - width / 2) * 100) / 100,
      y: Math.round((cy - height / 2) * 100) / 100,
    },
    mask: bytes.toString('base64'),
  }
}

const pieces = []

for (const category of readdirSync(PIECES_DIR).sort()) {
  const categoryDir = join(PIECES_DIR, category)
  if (!statSync(categoryDir).isDirectory()) continue

  for (const file of readdirSync(categoryDir).sort()) {
    if (!file.endsWith('.png')) continue
    const id = file.slice(0, -4)
    const { width, height, rgba } = decodePng(readFileSync(join(categoryDir, file)))
    const { centroid, mask } = measure(width, height, rgba)
    pieces.push({ id, category, src: `pieces/${category}/${file}`, width, height, centroid, mask })
  }
}

const duplicates = pieces
  .map((piece) => piece.id)
  .filter((id, index, all) => all.indexOf(id) !== index)

// Piece ids are the wire format's reference into this manifest, so a collision
// across categories would silently render the wrong sprite on the host.
if (duplicates.length) {
  console.error(`Duplicate piece ids across categories: ${[...new Set(duplicates)].join(', ')}`)
  process.exit(1)
}

writeFileSync(OUT_FILE, `${JSON.stringify(pieces, null, 2)}\n`)
console.log(`Wrote ${pieces.length} pieces to src/assets/pieces.json`)
