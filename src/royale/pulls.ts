// Simulador de tiradas del Gacha (valores ilustrativos; en producción vendría de CC).
import type { PackTier, Rarity, RoyaleCard } from './types'

const RARITY_SEQUENCE: Rarity[] = ['common', 'uncommon', 'rare', 'epic']

export const TIERS: PackTier[] = [
  {
    code: 'pokemon_50',
    name: 'Pokémon · 50 USDC',
    price: 50,
    odds: { common: 60, uncommon: 30, rare: 9, epic: 1 },
    valueBands: {
      common: [5, 30],
      uncommon: [30, 150],
      rare: [150, 1000],
      epic: [1000, 10000],
    },
  },
  {
    code: 'pokemon_250',
    name: 'Pokémon · 250 USDC',
    price: 250,
    odds: { common: 45, uncommon: 35, rare: 17, epic: 3 },
    valueBands: {
      common: [30, 120],
      uncommon: [120, 600],
      rare: [600, 3000],
      epic: [3000, 40000],
    },
  },
]

const CARD_NAMES = [
  'Charizard',
  'Blastoise',
  'Venusaur',
  'Pikachu',
  'Mewtwo',
  'Gengar',
  'Snorlax',
  'Dragonite',
  'Gyarados',
  'Alakazam',
  'Machamp',
  'Lugia',
]

/** Elige rareza según odds: recorre la secuencia acumulando probabilidad. */
function pickRarity(tier: PackTier, r: number): Rarity {
  const roll = r * 100
  let acc = 0
  for (const rarity of RARITY_SEQUENCE) {
    acc += tier.odds[rarity]
    if (roll < acc) return rarity
  }
  return 'epic'
}

export function simulatePull(
  tier: PackTier,
  rng: () => number,
  idGen: () => string,
): RoyaleCard {
  const rarity = pickRarity(tier, rng())
  const [min, max] = tier.valueBands[rarity]
  const valueUsd = Math.round(min + rng() * (max - min))
  const grade = 6 + Math.floor(rng() * 5) // 6..10
  const name = CARD_NAMES[Math.floor(rng() * CARD_NAMES.length)]
  return { id: idGen(), name, rarity, valueUsd, grade }
}
