import { describe, it, expect } from 'vitest'
import { computeEdge } from './edge'
import { DEFAULT_CONFIG } from './types'

const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, ...over })

describe('computeEdge', () => {
  it('2k vs 1k -> +1 para el de mayor valor', () => {
    // log2(2)=1, K=0.5 -> 0.5 -> round=1
    expect(computeEdge(2000, 1000, cfg())).toEqual({ high: 1, low: 0 })
  })
  it('100k vs 1k -> +3 (no llega al cap)', () => {
    // log2(100)=6.64, *0.5=3.32 -> round=3
    expect(computeEdge(100000, 1000, cfg())).toEqual({ high: 3, low: 0 })
  })
  it('capa al maxEdge', () => {
    // ratio enorme: 0.5*log2(1e7)=~11.6 -> capado a 4
    expect(computeEdge(10000000, 1, cfg())).toEqual({ high: 4, low: 0 })
  })
  it('valor igual -> 0', () => {
    expect(computeEdge(1000, 1000, cfg())).toEqual({ high: 0, low: 0 })
  })
  it('edgeEnabled=false -> 0', () => {
    expect(computeEdge(100000, 1000, cfg({ edgeEnabled: false }))).toEqual({ high: 0, low: 0 })
  })

  // FIX J: non-power-of-2 ratios must use integer thresholds (no log2 FP drift)
  it('ratio 3 (3k vs 1k) -> +1 (>=2 but <8)', () => {
    expect(computeEdge(3000, 1000, cfg())).toEqual({ high: 1, low: 0 })
  })
  it('ratio 40 (40k vs 1k) -> +3 (>=32 but <128)', () => {
    expect(computeEdge(40000, 1000, cfg())).toEqual({ high: 3, low: 0 })
  })
  it('ratio 130 (130k vs 1k) -> +4 (>=128, capped at maxEdge=4)', () => {
    expect(computeEdge(130000, 1000, cfg())).toEqual({ high: 4, low: 0 })
  })
  it('v_low == 0 -> 0', () => {
    expect(computeEdge(1000, 0, cfg())).toEqual({ high: 0, low: 0 })
  })
})
