import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PROMPTS } from './piece-prompts.mjs'

/**
 * Writes art-review/index.html: every generated piece on a checkerboard, in
 * prompt order, so the whole set can be judged in one scroll. Open it straight
 * off disk — the images are referenced, not embedded.
 *
 * Run: npm run pieces:review
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REVIEW_DIR = join(ROOT, 'art-review')

const present = new Set(readdirSync(REVIEW_DIR).filter((file) => file.endsWith('.png')))
const families = [...new Set(PROMPTS.map((piece) => piece.family))]

const sections = families
  .map((family) => {
    const cards = PROMPTS.filter((piece) => piece.family === family)
      .map((piece) => {
        if (!present.has(`${piece.id}.png`)) {
          return `<figure class="missing"><div class="slot">not generated</div><figcaption>${piece.id}</figcaption></figure>`
        }
        return `<figure><div class="slot"><img src="${piece.id}.png" alt="${piece.id}" loading="lazy"></div><figcaption>${piece.id}</figcaption></figure>`
      })
      .join('\n')
    return `<h2>${family}</h2>\n<div class="grid">\n${cards}\n</div>`
  })
  .join('\n')

const html = `<!doctype html>
<meta charset="utf-8">
<title>ArtSlicer piece review</title>
<style>
  body { margin: 0; padding: 24px; font: 14px system-ui, sans-serif; background: #14161a; color: #e7e9ee; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.count { margin: 0 0 24px; color: #9aa1ad; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #9aa1ad; margin: 32px 0 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; }
  figure { margin: 0; }
  .slot {
    display: grid; place-items: center; height: 190px; padding: 8px; border-radius: 8px;
    background-image: linear-gradient(45deg, #2a2e36 25%, transparent 25%, transparent 75%, #2a2e36 75%),
                      linear-gradient(45deg, #2a2e36 25%, #1c1f25 25%, #1c1f25 75%, #2a2e36 75%);
    background-size: 16px 16px; background-position: 0 0, 8px 8px;
  }
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
  figcaption { margin-top: 6px; color: #9aa1ad; font-size: 12px; text-align: center; }
  .missing .slot { color: #6b7280; background: #1c1f25; }
</style>
<h1>ArtSlicer piece review</h1>
<p class="count">${present.size ? [...present].filter((f) => !f.includes('-checker')).length : 0} of ${PROMPTS.length} generated — checkerboard is transparency</p>
${sections}
`

writeFileSync(join(REVIEW_DIR, 'index.html'), html)
console.log('Wrote art-review/index.html')
