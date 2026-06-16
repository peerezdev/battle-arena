import { useState } from 'react'
import { isMuted, toggleMuted, playSfx } from '../sound'
import { COLORS } from '../theme'

/** Persistent corner mute toggle wired to sound.ts (state persisted to localStorage). */
export function MuteButton() {
  const [muted, setMutedState] = useState<boolean>(() => isMuted())

  function onClick() {
    const next = toggleMuted()
    setMutedState(next)
    // Play a tiny confirmation only when un-muting.
    if (!next) playSfx('tick')
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={muted ? 'Activar sonido' : 'Silenciar sonido'}
      aria-pressed={muted}
      style={{
        position: 'fixed',
        top: 'max(10px, env(safe-area-inset-top))',
        right: 'max(10px, env(safe-area-inset-right))',
        zIndex: 50,
        width: '44px',
        height: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        color: muted ? COLORS.muted : COLORS.green,
        fontSize: '18px',
        cursor: 'pointer',
        boxShadow: muted ? 'none' : '0 0 10px #14F19544',
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
