/**
 * Avatars are emoji for now: zero art dependencies, render identically on the
 * laptop and every phone, and stay legible at scoreboard size.
 */
export interface Avatar {
  id: string
  glyph: string
  /** Backing colour so avatars stay distinguishable at a glance across the room. */
  color: string
}

export const AVATARS: Avatar[] = [
  { id: 'fox', glyph: '🦊', color: '#ff8a3d' },
  { id: 'frog', glyph: '🐸', color: '#5ce68f' },
  { id: 'cat', glyph: '🐱', color: '#ffc44d' },
  { id: 'robot', glyph: '🤖', color: '#9aa7ff' },
  { id: 'ghost', glyph: '👻', color: '#d6d0ff' },
  { id: 'alien', glyph: '👽', color: '#4dd8ff' },
  { id: 'crab', glyph: '🦀', color: '#ff5a5a' },
  { id: 'unicorn', glyph: '🦄', color: '#ff7ad9' },
  { id: 'penguin', glyph: '🐧', color: '#7fd4ff' },
  { id: 'dino', glyph: '🦖', color: '#67d96b' },
  { id: 'owl', glyph: '🦉', color: '#c9a227' },
  { id: 'octopus', glyph: '🐙', color: '#c77dff' },
]

const FALLBACK: Avatar = { id: 'unknown', glyph: '❓', color: '#a49cbd' }

export function getAvatar(id: string): Avatar {
  return AVATARS.find((avatar) => avatar.id === id) ?? FALLBACK
}
