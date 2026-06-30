import { COLORS, FONTS } from '../../theme'

const SWORDS = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /><line x1="7" x2="4" y1="17" y2="20" /><line x1="3" x2="5" y1="19" y2="21" /></svg>
const CROWN = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></svg>

function DemoCard({ icon, name, sub, accent, onClick }: { icon: React.ReactNode; name: string; sub: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', textAlign: 'left',
        padding: 18, borderRadius: 16, cursor: 'pointer', fontFamily: FONTS.body,
        background: `linear-gradient(180deg,${accent}14,rgba(255,255,255,.01))`, border: `1px solid ${COLORS.border}`,
        transition: 'border-color .12s, transform .12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = `${accent}66`; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-3px)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.border; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)' }}
    >
      <span style={{ width: 46, height: 46, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, background: `${accent}1f`, border: `1px solid ${accent}5c`, boxShadow: `0 0 22px -8px ${accent}` }}>{icon}</span>
      <div>
        <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 16, color: COLORS.text }}>{name}</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{sub}</div>
      </div>
    </button>
  )
}

export function DemoPicker({ onClose, onPick }: { onClose: () => void; onPick: (mode: 'pack' | 'royale') => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(4,6,9,.74)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(540px,100%)', borderRadius: 22, background: 'linear-gradient(180deg,#0e1118,#0a0c12)', border: `1px solid ${COLORS.border}`, boxShadow: '0 48px 120px -40px #000', padding: '22px clamp(18px,2.4vw,26px) 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: FONTS.display, fontWeight: 700, fontSize: 20, letterSpacing: '-.01em' }}>Play a demo</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: COLORS.muted, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 18 }}>Try a battle with simulated pulls — no funds spent.</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <DemoCard icon={SWORDS} name="Pack Battle" sub="1v1 · higher pull wins" accent={COLORS.green} onClick={() => onPick('pack')} />
          <DemoCard icon={CROWN} name="Battle Royale" sub="10 players · last one wins" accent={COLORS.violet} onClick={() => onPick('royale')} />
        </div>
      </div>
    </div>
  )
}
