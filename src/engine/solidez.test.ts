import { describe, it, expect } from 'vitest'
import { solidez } from './solidez'

describe('solidez', () => {
  it('PSA10 -> 100', () => {
    expect(solidez({ id: '1', name: 'x', valueUsd: 1, gradeCompany: 'PSA', grade: 10 })).toBe(100)
  })
  it('PSA9 -> 90', () => {
    expect(solidez({ id: '1', name: 'x', valueUsd: 1, gradeCompany: 'PSA', grade: 9 })).toBe(90)
  })
  it('PSA7 -> 70', () => {
    expect(solidez({ id: '1', name: 'x', valueUsd: 1, gradeCompany: 'PSA', grade: 7 })).toBe(70)
  })
})
