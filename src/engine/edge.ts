import type { MatchConfig } from './types'

/**
 * Bonus de energía por ronda para el de MAYOR valor.
 * Devuelve siempre {high, low}; `low` es 0 (el de menor valor no recibe bonus en Fase 0).
 * Llamar con (valorMayor, valorMenor).
 */
export function computeEdge(
  valueHigh: number,
  valueLow: number,
  config: MatchConfig,
): { high: number; low: number } {
  if (!config.edgeEnabled) return { high: 0, low: 0 }
  if (valueHigh <= valueLow) return { high: 0, low: 0 }
  const raw = config.K * Math.log2(valueHigh / valueLow)
  const bonus = Math.min(config.maxEdge, Math.round(raw))
  return { high: bonus, low: 0 }
}
