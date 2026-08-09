import { describe, expect, it } from 'vitest'

import {
  PEER_ID_PREFIX,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
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
