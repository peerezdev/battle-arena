import { COLORS, FONTS, formatUsd } from '../../theme'
import { useMachines } from '../../useMachines'
import { useAliases } from '../../useAliases'
import { shortWallet } from '../battle/RoyaleReveal'
import { DelegationPanel } from './DelegationPanel'
import type { UserStats } from '../../../hooks/useUserStats'

const RAR: Record<string, { tint: string; border: string; rc: string }> = {
  common: { tint: '#3a4250', border: 'rgba(255,255,255,.14)', rc: '#8b95a3' },
  uncommon: { tint: '#2f6b4a', border: 'rgba(47,226,138,.5)', rc: '#2fe28a' },
  rare: { tint: '#2a5a8f', border: 'rgba(78,168,255,.5)', rc: '#7fc0ff' },
  epic: { tint: '#5a3a9f', border: 'rgba(169,139,255,.55)', rc: '#bda6ff' },
  legendary: { tint: '#8a6a1f', border: 'rgba(245,197,66,.6)', rc: '#f5c542' },
}
const rarOf = (r: string | null | undefined) => RAR[(r ?? '').toLowerCase()] ?? RAR.common

function Eyebrow({ color, icon, children }: { color: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color }}>
      {icon}{children}
    </div>
  )
}

export function OverviewTab({ wallet, stats }: { wallet?: string; stats: UserStats | null }) {
  const isSelf = !wallet
  const machines = useMachines()
  const bh = stats?.bestHit
  const bv = stats?.bestVictory
  const aliases = useAliases(bv?.opponents ?? [])

  const machineName = bv ? machines[bv.machineCode]?.name ?? bv.machineCode : ''
  const oppText = bv
    ? bv.opponents.length === 1
      ? `vs ${aliases[bv.opponents[0]] ?? shortWallet(bv.opponents[0])}`
      : bv.opponents.length === 0 ? '' : `vs ${bv.opponents.length} players`
    : ''
  const bhRar = rarOf(bh?.rarity)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>

        {/* BEST HIT */}
        <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, padding: 22, background: 'linear-gradient(135deg,rgba(245,197,66,.10),rgba(13,17,22,.5) 55%)', border: '1px solid rgba(245,197,66,.28)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Eyebrow color="#f5c542" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 9.2 8.6 2 9.2l5.5 4.7L5.8 21 12 17l6.2 4-1.7-7.1L22 9.2l-7.2-.6z" /></svg>}>BEST HIT</Eyebrow>
            {bh?.grade != null && <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>PSA {bh.grade}</div>}
          </div>
          {bh ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 'none', width: 104, height: 132, borderRadius: 12, overflow: 'hidden', background: `linear-gradient(160deg,${bhRar.tint},rgba(8,10,14,.6))`, border: `1px solid ${bhRar.border}`, boxShadow: `0 0 30px -8px ${bhRar.rc}66` }}>
                {bh.grade != null && (
                  <div style={{ margin: '8px 8px 0', height: 15, borderRadius: 3, background: 'rgba(238,242,246,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 6.5, fontWeight: 700, letterSpacing: '.06em', color: '#16202c' }}>PSA {bh.grade}</span>
                  </div>
                )}
                <span style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(125deg,rgba(255,255,255,.07) 0 1px,transparent 1px 7px)' }} />
                <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)', animation: 'ba-sweep 3.6s infinite' }} />
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{bh.name ?? 'Card'}</div>
                {bh.year && <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 12 }}>{bh.year}</div>}
                <div style={{ fontFamily: FONTS.display, fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1, background: 'linear-gradient(120deg,#ffd96b,#e8a020)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(bh.valueUsd ?? 0)}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.14em', color: COLORS.muted, marginTop: 3 }}>CARD VALUE</div>
              </div>
            </div>
          ) : (
            <div style={{ color: COLORS.muted, fontSize: 13, padding: '14px 0' }}>No cards pulled yet — open a pack to set your best hit.</div>
          )}
        </section>

        {/* BEST VICTORY */}
        <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, padding: 22, background: 'linear-gradient(135deg,rgba(47,226,138,.10),rgba(13,17,22,.5) 55%)', border: '1px solid rgba(47,226,138,.28)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Eyebrow color={COLORS.green} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>}>BEST VICTORY</Eyebrow>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>LIFETIME</div>
          </div>
          {bv ? (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 'none', width: 104, height: 132, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,rgba(47,226,138,.18),rgba(8,10,14,.5))', border: '1px solid rgba(47,226,138,.4)', boxShadow: '0 0 30px -8px rgba(47,226,138,.6)' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,#3df0a0,#13c98a)', boxShadow: '0 6px 20px -6px rgba(47,226,138,.8)' }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#06170f" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
                </span>
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', marginBottom: 3 }}>{machineName}</div>
                <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 12 }}>{bv.mode === 'royale' ? 'Battle Royale' : 'Pack Battle'}{oppText ? ` · ${oppText}` : ''}</div>
                <div style={{ fontFamily: FONTS.display, fontSize: 28, fontWeight: 800, color: COLORS.green, letterSpacing: '-.02em', lineHeight: 1 }}>+{formatUsd(bv.amountUsd)}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.14em', color: COLORS.muted, marginTop: 3 }}>LOOT WON IN ONE BATTLE</div>
              </div>
            </div>
          ) : (
            <div style={{ color: COLORS.muted, fontSize: 13, padding: '14px 0' }}>No wins yet — your biggest haul will show up here.</div>
          )}
        </section>
      </div>

      {isSelf && <DelegationPanel />}
    </div>
  )
}
