import { useState } from 'react'
import { MOCK_CARDS } from '../../data/cards'
import type { Mode } from '../../engine'
import type { Difficulty } from '../../bot/bot'
import { COLORS, formatUsd, FONTS } from '../theme'
import { solidez } from '../../engine'

export interface Setup {
  opponent: 'vs-bot' | 'hotseat'
  cardAId: string
  cardBId: string
  mode: Mode
  edgeEnabled: boolean
  difficulty: Difficulty
  /** Seconds per round (allocate phase). 0 = no limit. */
  timerSeconds: number
}

const S = {
  label: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '.05em',
    color: COLORS.muted,
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
  },
  select: {
    width: '100%',
    background: COLORS.panel,
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    padding: '10px 12px',
    fontSize: '14px',
    marginBottom: '14px',
    outline: 'none',
    appearance: 'auto' as const,
  },
}

function CardPreview({ cardId, playerKey }: { cardId: string; playerKey: 'a' | 'b' }) {
  const card = MOCK_CARDS.find((c) => c.id === cardId)
  if (!card) return null
  const color = playerKey === 'a' ? COLORS.green : COLORS.violet
  const label = playerKey === 'a' ? '🟢' : '🟣'
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${color}44`,
        borderRadius: '6px',
        padding: '8px 10px',
        marginBottom: '14px',
        fontSize: '12px',
      }}
    >
      <span style={{ color, fontWeight: 700 }}>{label} {card.name}</span>
      <span style={{ color: COLORS.muted, marginLeft: '8px' }}>
        {formatUsd(card.valueUsd)} · {card.gradeCompany}{card.grade} · Sol {solidez(card)}
      </span>
    </div>
  )
}

export function SetupScreen({ onStart, error }: { onStart: (s: Setup) => void; error?: string }) {
  const [s, setS] = useState<Setup>({
    opponent: 'vs-bot', cardAId: MOCK_CARDS[0].id, cardBId: MOCK_CARDS[1].id,
    mode: 'ranked', edgeEnabled: true, difficulty: 'medium', timerSeconds: 45,
  })
  const upd = (p: Partial<Setup>) => setS({ ...s, ...p })

  const sameCard = s.cardAId === s.cardBId

  return (
    <div
      style={{
        minHeight: '100%',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 32px',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '32px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px', color: COLORS.green, fontFamily: FONTS.display }}>
            ⚡ TCG Battle Arena
          </div>
          <div style={{ fontSize: '12px', color: COLORS.muted, marginTop: '4px', fontFamily: FONTS.mono }}>Phase 0 · Dark Arena</div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: '#300a0f',
              border: `1px solid ${COLORS.red}`,
              color: COLORS.red,
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        {/* Panel */}
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <label style={S.label}>Opponent</label>
          <select style={S.select} value={s.opponent} onChange={(e) => upd({ opponent: e.target.value as Setup['opponent'] })}>
            <option value="vs-bot">vs Bot</option>
            <option value="hotseat">Hotseat (2 players)</option>
          </select>

          <label style={S.label}>Card A (🟢 Green)</label>
          <select style={S.select} value={s.cardAId} onChange={(e) => upd({ cardAId: e.target.value })}>
            {MOCK_CARDS.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({formatUsd(c.valueUsd)} · {c.gradeCompany}{c.grade})</option>
            ))}
          </select>
          <CardPreview cardId={s.cardAId} playerKey="a" />

          <label style={S.label}>Card B (🟣 Violet)</label>
          <select style={S.select} value={s.cardBId} onChange={(e) => upd({ cardBId: e.target.value })}>
            {MOCK_CARDS.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({formatUsd(c.valueUsd)} · {c.gradeCompany}{c.grade})</option>
            ))}
          </select>
          <CardPreview cardId={s.cardBId} playerKey="b" />

          <label style={S.label}>Mode</label>
          <select style={S.select} value={s.mode} onChange={(e) => upd({ mode: e.target.value as Mode })}>
            <option value="ranked">Ranked (cap 4x)</option>
            <option value="challenge">Challenge (no cap)</option>
          </select>

          {/* Edge toggle */}
          <label
            onClick={() => upd({ edgeEnabled: !s.edgeEnabled })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
              marginBottom: '16px',
              fontSize: '13px',
              color: COLORS.text,
            }}
          >
            <div
              style={{
                width: '40px',
                height: '22px',
                borderRadius: '11px',
                background: s.edgeEnabled ? COLORS.green : COLORS.border,
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s',
                flexShrink: 0,
                boxShadow: s.edgeEnabled ? '0 0 8px #2fe28a66' : 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '3px',
                  left: s.edgeEnabled ? '21px' : '3px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                }}
              />
            </div>
            <span>Card edge enabled</span>
            <span style={{ color: COLORS.muted, fontSize: '11px' }}>(edge by value)</span>
          </label>

          {s.opponent === 'vs-bot' && (
            <>
              <label style={S.label}>Bot difficulty</label>
              <select style={S.select} value={s.difficulty} onChange={(e) => upd({ difficulty: e.target.value as Difficulty })}>
                <option value="easy">Easy</option>
                <option value="medium">Normal</option>
                <option value="hard">Hard</option>
              </select>
            </>
          )}

          {/* Round timer */}
          <label style={S.label}>Round timer</label>
          <select
            style={S.select}
            value={s.timerSeconds}
            onChange={(e) => upd({ timerSeconds: Number(e.target.value) })}
            aria-label="Round timer"
          >
            <option value={0}>No limit</option>
            <option value={30}>30 s</option>
            <option value={45}>45 s (recommended)</option>
            <option value={60}>60 s</option>
          </select>

          {sameCard && (
            <div style={{ color: COLORS.red, fontSize: '12px', marginBottom: '12px' }}>
              Both cards must be different.
            </div>
          )}

          <button
            disabled={sameCard}
            onClick={() => onStart(s)}
            style={{
              width: '100%',
              background: sameCard ? COLORS.border : COLORS.green,
              color: sameCard ? COLORS.muted : '#04130c',
              border: 'none',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '15px',
              fontWeight: 800,
              cursor: sameCard ? 'not-allowed' : 'pointer',
              letterSpacing: '.03em',
              boxShadow: sameCard ? 'none' : '0 0 12px #2fe28a55',
              transition: 'box-shadow 0.2s',
            }}
          >
            ⚡ START GAME
          </button>
        </div>
      </div>
    </div>
  )
}
