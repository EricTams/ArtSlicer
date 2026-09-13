import { execSync } from 'node:child_process'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * The commit this bundle was built from, stamped on the home screen so a
 * deploy can be told apart from a cached page without bumping anything by
 * hand. Falls back rather than failing the build: a checkout without git is
 * unusual but not a reason to have no bundle.
 */
function buildSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

// GitHub Pages serves project sites from /<repo>/, so the base path must match
// the repository name. Kept identical in dev so that BASE_URL-derived join URLs
// behave the same locally as they do in production.
export default defineConfig({
  base: '/ArtSlicer/',
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  server: {
    host: true, // expose on the LAN so a real phone can hit the dev server
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
