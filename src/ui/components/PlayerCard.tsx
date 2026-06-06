import type { Card } from '../../engine'
import { solidez } from '../../engine'
import { player as playerTheme, formatUsd } from '../theme'

interface Props {
  card: Card
  playerKey: 'a' | 'b'
}

export function PlayerCard({ card, playerKey }: Props) {
  const t = playerTheme[playerKey]
  const sol = solidez(card)

  return (
    <div
      className="flex-1 rounded"
      style={{
        background: '#121a30',
        border: `1px solid ${t.borderColor}`,
        padding: '6px 8px',
      }}
    >
      <div className="text-xs font-bold" style={{ color: t.color }}>
        {t.label} {card.name}
      </div>
      <div className="text-xs mt-0.5" style={{ color: '#7c89a8' }}>
        {formatUsd(card.valueUsd)} · {card.gradeCompany}{card.grade} · Sol {sol}
      </div>
    </div>
  )
}
