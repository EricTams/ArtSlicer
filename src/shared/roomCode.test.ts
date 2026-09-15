import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PEER_ID_PREFIX,
  generateRoomCode,
  isValidRoomCode,
  joinUrl,
  normalizeRoomCode,
  roomCodeFromScan,
  roomCodeToPeerId,
} from './roomCode'

describe('generateRoomCode', () => {
  it('produces 4 characters that survive validation', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(4)
      expect(isValidRoomCode(code)).toBe(true)
    }
  })

  it('avoids characters that are ambiguous when read aloud', () => {
    // Each ambiguous pair keeps exactly one member: 0/O and 1/I/L drop both,
    // 5/S keeps neither, 8/B keeps 8, 2/Z keeps 2.
    const excluded = /[01 5BILOSZ]/
    for (let i = 0; i < 200; i++) {
      expect(generateRoomCode()).not.toMatch(excluded)
    }
  })
})

describe('normalizeRoomCode', () => {
  it('accepts what a human actually types', () => {
    expect(normalizeRoomCode('ab-cd')).toBe('ABCD')
    expect(normalizeRoomCode(' a b c d ')).toBe('ABCD')
  })
})

describe('isValidRoomCode', () => {
  it('rejects wrong lengths and excluded characters', () => {
    expect(isValidRoomCode('ABC')).toBe(false)
    expect(isValidRoomCode('ABCDE')).toBe(false)
    expect(isValidRoomCode('')).toBe(false)
    // O and 0 are deliberately not in the alphabet.
    expect(isValidRoomCode('AB0D')).toBe(false)
    expect(isValidRoomCode('ABOD')).toBe(false)
  })

  it('accepts a valid code regardless of case', () => {
    expect(isValidRoomCode('acdf')).toBe(true)
    expect(isValidRoomCode('ACDF')).toBe(true)
  })
})

describe('roomCodeToPeerId', () => {
  it('namespaces the code against the shared public broker', () => {
    expect(roomCodeToPeerId('acdf')).toBe(`${PEER_ID_PREFIX}ACDF`)
  })
})

describe('roomCodeFromScan', () => {
  it('reads the code out of a join link, wherever that link points', () => {
    expect(roomCodeFromScan('https://example.com/ArtSlicer/#/join/ACDF')).toBe('ACDF')
    // A host serving on the LAN. The code still joins from a phone running the
    // deployed build, because the code is what finds the room.
    expect(roomCodeFromScan('http://192.168.1.4:5173/ArtSlicer/#/join/acdf')).toBe('ACDF')
  })

  it('reads a code that was scanned on its own', () => {
    expect(roomCodeFromScan('ACDF')).toBe('ACDF')
    expect(roomCodeFromScan(' acdf ')).toBe('ACDF')
  })

  it('refuses a QR that is not one of ours', () => {
    expect(roomCodeFromScan('https://example.com/')).toBeNull()
    expect(roomCodeFromScan('WIFI:S=cafe;T=WPA;P=hunter2;;')).toBeNull()
    expect(roomCodeFromScan('')).toBeNull()
  })

  it('refuses a join link carrying a code that could not be one', () => {
    expect(roomCodeFromScan('https://example.com/#/join/ABCDE')).toBeNull()
    // O and 0 are not in the alphabet, so this link was never ours.
    expect(roomCodeFromScan('https://example.com/#/join/AB0D')).toBeNull()
  })

  it('reads back the very link the host shows', () => {
    // The one test that needs a page: joinUrl reads the address it is served
    // from. Worth it, because the QR is written by one of these and read by
    // the other, and nothing else would notice if they drifted apart.
    vi.stubGlobal('window', { location: { origin: 'https://example.com' } })
    expect(roomCodeFromScan(joinUrl('acdf'))).toBe('ACDF')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })
})
