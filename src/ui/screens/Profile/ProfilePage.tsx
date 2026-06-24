import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { OverviewTab } from './OverviewTab'
import { InventoryTab } from './InventoryTab'
import { SettingsTab } from './SettingsTab'

type Tab = 'overview' | 'inventory' | 'settings'

function shortWallet(w: string): string {
  return w.length > 9 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

export function ProfilePage() {
  const { wallet } = useParams<{ wallet?: string }>()
  const own = useEmbeddedSolanaAddress()
  const isSelf = !wallet || wallet === own
  const target = isSelf ? undefined : wallet

  const tabs: { key: Tab; label: string }[] = isSelf
    ? [{ key: 'overview', label: 'Overview' }, { key: 'inventory', label: 'Inventory' }, { key: 'settings', label: 'Settings' }]
    : [{ key: 'overview', label: 'Overview' }, { key: 'inventory', label: 'Inventory' }]

  const [tab, setTab] = useState<Tab>('overview')

  return (
    <div style={{ maxWidth: 880, width: '100%', margin: '0 auto', padding: '28px 22px' }}>
      <h1 style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 26, margin: '0 0 4px' }}>
        {isSelf ? 'Profile' : shortWallet(wallet!)}
      </h1>
      {!isSelf && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, margin: '0 0 16px' }}>
          Perfil de jugador
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 22, marginTop: isSelf ? 18 : 0 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? `2px solid ${COLORS.green}` : '2px solid transparent',
              color: tab === t.key ? COLORS.text : COLORS.muted,
              fontFamily: FONTS.body,
              fontWeight: 700,
              fontSize: 14,
              padding: '10px 14px',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab wallet={target} />}
      {tab === 'inventory' && <InventoryTab wallet={target} />}
      {tab === 'settings' && isSelf && <SettingsTab />}
    </div>
  )
}
