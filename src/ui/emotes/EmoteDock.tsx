import { EmoteBar } from './EmoteBar'

// Emote bar pinned to the bottom of a battle reveal (Pack + Royale). Sticky at the bottom of
// the reveal's scroll area (stays visible while it scrolls) and pushed down via margin-top:auto
// when the reveal is short, so it always sits at the very bottom. The reveal root must be a
// flex column with minHeight:100% for the push-down to have room.
export function EmoteDock({ meWallet, battleId }: { meWallet: string; battleId?: string }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, marginTop: 'auto', zIndex: 20,
      display: 'flex', justifyContent: 'center',
      padding: '12px 0 10px',
      background: 'linear-gradient(180deg, transparent, rgba(6,8,11,.92) 55%)',
    }}>
      <EmoteBar meWallet={meWallet} battleId={battleId} />
    </div>
  )
}
