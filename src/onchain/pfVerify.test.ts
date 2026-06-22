import { describe, it, expect } from 'vitest'
import { seedHashHex, verifyCommit } from './pfVerify'

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('pfVerify', () => {
  it('seedHashHex matches the known SHA-256 vector', async () => {
    expect(await seedHashHex('abc')).toBe(ABC)
  })

  it('verifyCommit is true when the seed hashes to the committed hash', async () => {
    expect(await verifyCommit('abc', ABC)).toBe(true)
  })

  it('verifyCommit is false for a mismatched hash', async () => {
    expect(await verifyCommit('abc', 'deadbeef')).toBe(false)
  })
})
