import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the base path must match
// the repository name. Kept identical in dev so that BASE_URL-derived join URLs
// behave the same locally as they do in production.
export default defineConfig({
  base: '/ArtSlicer/',
  plugins: [react()],
  server: {
    host: true, // expose on the LAN so a real phone can hit the dev server
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
