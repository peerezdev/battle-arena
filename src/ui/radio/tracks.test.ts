import { describe, it, expect } from 'vitest'
import { TRACKS } from './tracks'

describe('TRACKS', () => {
  it('every track has id/title/artist/url', () => {
    expect(TRACKS.length).toBeGreaterThan(0)
    for (const t of TRACKS) {
      expect(typeof t.id).toBe('string')
      expect(t.id.length).toBeGreaterThan(0)
      expect(typeof t.title).toBe('string')
      expect(typeof t.artist).toBe('string')
      expect(typeof t.url).toBe('string')
      expect(t.url.length).toBeGreaterThan(0)
    }
  })

  it('track ids are unique', () => {
    const ids = TRACKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
