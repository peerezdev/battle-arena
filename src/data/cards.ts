import type { Card } from '../engine'

// Cartas mock para Fase 0. Valores y grades representativos de distintos tiers.
export const MOCK_CARDS: Card[] = [
  { id: 'c1', name: 'Charizard Base', valueUsd: 1200, gradeCompany: 'PSA', grade: 8 },
  { id: 'c2', name: 'Blastoise Base', valueUsd: 950, gradeCompany: 'PSA', grade: 7 },
  { id: 'c3', name: 'Pikachu Illustrator', valueUsd: 100000, gradeCompany: 'PSA', grade: 9 },
  { id: 'c4', name: 'Common Holo', valueUsd: 400, gradeCompany: 'CGC', grade: 9 },
  { id: 'c5', name: 'Venusaur Base', valueUsd: 2000, gradeCompany: 'BGS', grade: 9 },
  { id: 'c6', name: 'Mewtwo Promo', valueUsd: 1000, gradeCompany: 'PSA', grade: 10 },
]
