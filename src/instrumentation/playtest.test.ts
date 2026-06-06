import { describe, it, expect, beforeEach } from 'vitest'
import { recordMatch, getRecords, exportJson, clearRecords, type PlaytestRecord } from './playtest'

const rec: PlaytestRecord = {
  ts: 1, winner: 'b', rounds: 3, edgeEnabled: true, valueRatio: 1.26,
  mode: 'ranked', difficulty: 'medium', funRating: 4, comment: 'reñido',
}

describe('playtest instrumentation', () => {
  beforeEach(() => clearRecords())

  it('guarda y recupera registros', () => {
    recordMatch(rec)
    expect(getRecords()).toHaveLength(1)
    expect(getRecords()[0].winner).toBe('b')
  })

  it('exporta JSON parseable', () => {
    recordMatch(rec)
    const parsed = JSON.parse(exportJson())
    expect(parsed[0].funRating).toBe(4)
  })
})
