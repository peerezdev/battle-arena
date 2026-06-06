import type { Card } from './types'

// Fase 0: escalón de 10 por punto de nota; CGC/BGS mapean igual por nota.
export function solidez(card: Card): number {
  return card.grade * 10
}
