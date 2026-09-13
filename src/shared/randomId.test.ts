import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from './randomId'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** An insecure context: `getRandomValues` survives, `randomUUID` does not. */
function withoutRandomUUID(): void {
  const real = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomUUID', () => {
  it('still produces a v4 UUID when crypto.randomUUID is missing', () => {
    withoutRandomUUID()
    expect(randomUUID()).toMatch(V4)
  })

  it('does not repeat itself on the fallback path', () => {
    withoutRandomUUID()
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i += 1) seen.add(randomUUID())
    expect(seen.size).toBe(1000)
  })

  it('uses the native implementation when one is available', () => {
    expect(randomUUID()).toMatch(V4)
  })
})
