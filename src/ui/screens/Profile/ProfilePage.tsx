import { useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { OverviewTab } from './OverviewTab'
import { InventoryTab } from './InventoryTab'
import { SettingsTab } from './SettingsTab'

type Tab = 'overview' | 'inventory' | 'settings'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'settings', label: 'Settings' },
]

export function ProfilePage() {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <div style={{ maxWidth: 880, width: '100%', margin: '0 auto', padding: '28px 22px' }}>
      <h1 style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 26, margin: '0 0 18px' }}>Profile</h1>

      <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 22 }}>
        {TABS.map((t) => (
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

      {tab === 'overview' && <OverviewTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
