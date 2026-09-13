import { execSync } from 'node:child_process'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * The commit this bundle was built from, stamped on the home screen so a
 * deploy can be told apart from a cached page without bumping anything by
 * hand. Falls back rather than failing the build: a checkout without git is
 * unusual but not a reason to have no bundle.
 */
/**
 * Commits made before the version stamp existed. Taking them off puts the
 * number where it was first set by hand, so it reads the same and every commit
 * after moves it by one.
 */
const COMMITS_BEFORE_VERSIONING = 32

/**
 * The version, counted rather than remembered.
 *
 * A number somebody has to bump is a number that stays put through the three
 * pushes where it mattered. Counting commits means a push always moves it, and
 * moves it by however much actually changed.
 *
 * Zero when the count is unavailable — a shallow clone or no git at all — so
 * `0.000` reads as "this build cannot say", rather than quietly claiming to be
 * the first version.
 */
function buildNumber(): number {
  try {
    const count = Number(
      execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim(),
    )
    if (!Number.isFinite(count)) return 0
    return Math.max(0, count - COMMITS_BEFORE_VERSIONING)
  } catch {
    return 0
  }
}

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
    __BUILD_NUMBER__: JSON.stringify(buildNumber()),
  },
  server: {
    host: true, // expose on the LAN so a real phone can hit the dev server
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
