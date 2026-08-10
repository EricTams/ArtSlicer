import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { keyAndTrim } from './chroma-key.mjs'
import { decodePng, encodePng } from './png.mjs'
import { PROMPTS, STYLE } from './piece-prompts.mjs'

/**
 * Generates the prop pieces with the OpenAI image API and cuts them out.
 *
 * Output goes to art-review/ rather than straight into public/pieces, because
 * every render is a coin flip worth looking at before it lands in the game.
 * Each piece writes three files: the untouched render, the cut out sprite, and
 * the sprite over a checkerboard so a bad edge is obvious at a glance.
 *
 * Renders are cached, so a re-run only pays for pieces that have no raw file
 * yet — delete a raw png to re-roll just that one.
 *
 * Run: npm run pieces:generate -- [--only id,id] [--force] [--size 512]
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REVIEW_DIR = join(ROOT, 'art-review')
const RAW_DIR = join(REVIEW_DIR, 'raw')

const MODEL = 'gpt-image-2'
const CONCURRENCY = 4

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? true)
}

const only = flag('only')
const force = process.argv.includes('--force')
const size = Number(flag('size', 512))

const wanted = only ? String(only).split(',').map((id) => id.trim()) : null
const queue = wanted ? PROMPTS.filter((p) => wanted.includes(p.id)) : PROMPTS

if (wanted) {
  const unknown = wanted.filter((id) => !PROMPTS.some((p) => p.id === id))
  if (unknown.length) {
    console.error(`No such piece: ${unknown.join(', ')}`)
    process.exit(1)
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set')
  process.exit(1)
}

mkdirSync(RAW_DIR, { recursive: true })

async function render(item) {
  const rawFile = join(RAW_DIR, `${item.id}.png`)
  if (existsSync(rawFile) && !force) return { raw: readFileSync(rawFile), cached: true }

  const backdrop =
    item.chroma === 'magenta'
      ? STYLE.replace('pure green (#00FF00)', 'pure magenta (#FF00FF)')
      : STYLE

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${backdrop} The subject is ${item.subject}.`,
      size: '1024x1024',
      output_format: 'png',
      n: 1,
    }),
  })

  const json = await response.json()
  if (json.error) throw new Error(json.error.message)

  const raw = Buffer.from(json.data[0].b64_json, 'base64')
  writeFileSync(rawFile, raw)
  return { raw, cached: false }
}

/** The sprite over a checkerboard, so a green fringe or a hole reads instantly. */
function checkerboard({ width, height, rgba }) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const tile = ((x >> 4) + (y >> 4)) % 2 ? 200 : 255
      const alpha = rgba[i + 3] / 255
      for (let channel = 0; channel < 3; channel++) {
        out[i + channel] = rgba[i + channel] * alpha + tile * (1 - alpha)
      }
      out[i + 3] = 255
    }
  }
  return { width, height, rgba: out }
}

async function build(item) {
  const { raw, cached } = await render(item)
  const sprite = keyAndTrim(decodePng(raw), size, { chroma: item.chroma ?? 'green' })

  writeFileSync(join(REVIEW_DIR, `${item.id}.png`), encodePng(sprite.width, sprite.height, sprite.rgba))
  const preview = checkerboard(sprite)
  writeFileSync(join(REVIEW_DIR, `${item.id}-checker.png`), encodePng(preview.width, preview.height, preview.rgba))

  const notes = []
  if (cached) notes.push('cached render')
  if (sprite.clipped) notes.push('SUBJECT CLIPPED — re-roll')
  if (sprite.coverage > 0.9) notes.push('barely cut out — check the backdrop keyed')
  return `${item.id.padEnd(16)} ${String(sprite.width).padStart(4)}x${String(sprite.height).padEnd(4)} ${notes.join(', ')}`
}

const results = []
let next = 0

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (next < queue.length) {
      const item = queue[next++]
      try {
        const line = await build(item)
        console.log(line)
        results.push({ id: item.id, ok: true })
      } catch (error) {
        console.error(`${item.id.padEnd(16)} FAILED: ${error.message}`)
        results.push({ id: item.id, ok: false })
      }
    }
  }),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} pieces written to art-review/`)
if (failed.length) console.log(`Failed: ${failed.map((r) => r.id).join(', ')}`)
