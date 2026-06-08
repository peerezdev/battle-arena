import type { Card } from '../../engine'
import { player as playerTheme } from '../theme'
import { CardSlab } from './CardSlab'

interface Props {
  card: Card
  playerKey: 'a' | 'b'
  /** Forward an optional imageUrl to CardSlab. */
  imageUrl?: string
  sheen?: boolean
}

export function PlayerCard({ card, playerKey, imageUrl, sheen = true }: Props) {
  const t = playerTheme[playerKey]

  return (
    <CardSlab
      name={card.name}
      gradeCompany={card.gradeCompany}
      grade={card.grade}
      cert={card.id}
      accentColor={t.color}
      imageUrl={imageUrl}
      variant="compact"
      sheen={sheen}
    />
  )
}
