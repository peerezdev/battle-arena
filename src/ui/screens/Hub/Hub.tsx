import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import type { HubNav } from './hubMockData'
import { STAKE_OPTIONS } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles } from './LiveBattles'

export function Hub() {
  const navigate = useNavigate()
  const [stake, setStake] = useState<number>(STAKE_OPTIONS[1])

  /** Route navigation for game modes, fallback to local sub-view (ranks etc.) */
  function go(id: HubNav) {
    if (id === 'mana')   return navigate('/play/mana')
    if (id === 'royale') return navigate('/play/royale')
    if (id === 'pack')   return navigate('/play/arena')
    if (id === 'gacha')  return navigate('/play/gacha')
    // local sub-views (lobby, ranks) — no-op until sub-view tabs are wired
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '16px 26px',
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: '-0.01em',
              color: COLORS.text,
            }}
          >
            Lobby
          </span>
          <span
            style={{
              color: COLORS.muted,
              fontWeight: 500,
              fontSize: 13,
              marginLeft: 10,
            }}
          >
            · 18 players online
          </span>
        </div>
      </div>
      <div style={{ padding: '24px 26px 40px' }}>
        <QuickMatch
          selectedStake={stake}
          onStake={setStake}
          onFindMatch={() => navigate('/play/arena')}
          onCreate={() => navigate('/play/arena')}
        />
        <LiveBattles onSelectMode={go} onBattleAction={() => navigate('/play/arena')} />
      </div>
    </div>
  )
}
