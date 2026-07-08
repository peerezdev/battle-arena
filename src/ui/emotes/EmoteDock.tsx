import { EmoteBar } from './EmoteBar'
import { COLORS } from '../theme'

// Must match the horizontal padding of the reveal roots (PackReveal / RoyaleReveal) so the
// bar can bleed edge-to-edge with negative margins while its content lines up with theirs.
const H_PAD = 'clamp(14px,2.4vw,28px)'

// Emote bar pinned flush to the bottom of a battle reveal (Pack + Royale). Full-width bar in
// the app's chrome style (dark blur + top border); emotes align to the left. Sticky at the
// bottom of the scroll area and pushed down (margin-top:auto) when the reveal is short — the
// reveal root must be a flex column with minHeight:100% and no bottom padding.
export function EmoteDock({ meWallet, battleId }: { meWallet: string; battleId?: string }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, marginTop: 'auto', zIndex: 20,
      marginLeft: `calc(${H_PAD} * -1)`, marginRight: `calc(${H_PAD} * -1)`,
      display: 'flex', justifyContent: 'flex-start', alignItems: 'center',
      padding: `10px ${H_PAD}`,
      background: 'rgba(8,10,14,.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderTop: `1px solid ${COLORS.border}`,
    }}>
      <EmoteBar meWallet={meWallet} battleId={battleId} />
    </div>
  )
}
