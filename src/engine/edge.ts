import type { MatchConfig } from './types'

/**
 * Bonus de energía por ronda para el de MAYOR valor.
 * Devuelve siempre {high, low}; `low` es 0 (el de menor valor no recibe bonus en Fase 0).
 * Llamar con (valorMayor, valorMenor).
 *
 * FIX J (engine #3): Uses integer-threshold logic matching the Rust on-chain program exactly
 * (no Math.log2 which risks FP divergence at non-power-of-2 ratios).
 *
 * Rust compute_edge thresholds:
 *   edge = 0
 *   +1 if v_high >= v_low * 2    (ratio ≥ 2)
 *   +2 if v_high >= v_low * 8    (ratio ≥ 8)
 *   +3 if v_high >= v_low * 32   (ratio ≥ 32)
 *   +4 if v_high >= v_low * 128  (ratio ≥ 128)
 *   capped at maxEdge; 0 if disabled/equal/v_low==0
 */
export function computeEdge(
  valueHigh: number,
  valueLow: number,
  config: MatchConfig,
): { high: number; low: number } {
  if (!config.edgeEnabled) return { high: 0, low: 0 }
  if (valueHigh <= valueLow) return { high: 0, low: 0 }
  if (valueLow === 0) return { high: 0, low: 0 }

  let bonus = 0
  if (valueHigh >= valueLow * 128) bonus = 4
  else if (valueHigh >= valueLow * 32) bonus = 3
  else if (valueHigh >= valueLow * 8) bonus = 2
  else if (valueHigh >= valueLow * 2) bonus = 1

  return { high: Math.min(bonus, config.maxEdge), low: 0 }
}
