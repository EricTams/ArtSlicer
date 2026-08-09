import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readPngSize } from './png.mjs'

/**
 * Builds src/assets/pieces.json from whatever PNGs are in public/pieces.
 *
 * Layout is public/pieces/<category>/<id>.png — the directory names the
 * category, so adding real art means dropping files in and re-running this.
 * Baking dimensions into the manifest lets the editor lay out the piece tray
 * before any image has finished decoding.
 *
 * Run: npm run pieces
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PIECES_DIR = join(ROOT, 'public', 'pieces')
const OUT_FILE = join(ROOT, 'src', 'assets', 'pieces.json')

const pieces = []

for (const category of readdirSync(PIECES_DIR).sort()) {
  const categoryDir = join(PIECES_DIR, category)
  if (!statSync(categoryDir).isDirectory()) continue

  for (const file of readdirSync(categoryDir).sort()) {
    if (!file.endsWith('.png')) continue
    const id = file.slice(0, -4)
    const { width, height } = readPngSize(readFileSync(join(categoryDir, file)))
    pieces.push({ id, category, src: `pieces/${category}/${file}`, width, height })
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
