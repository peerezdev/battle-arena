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
      // Translucent + heavy blur so the app's ambient gradient tints it through (matches the
      // theme chrome) instead of reading as a flat black slab.
      background: 'linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.008))',
      backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
      borderTop: `1px solid ${COLORS.border}`,
    }}>
      <EmoteBar meWallet={meWallet} battleId={battleId} />
    </div>
  )
}
