import { Fragment, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import { StagedCardReveal } from './StagedCardReveal'
import { CardBack } from './CardBack'
import { PotGain } from './PotGain'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import { tintFor, shortWallet, pullTitle, POT_GOLD } from './royaleShared'
import { revealOrderWallets, totalRounds, type RoyaleRevealState } from './useRoyaleReveal'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

// Phone-sized card. 5:7 like every other card in the app; 220 still clears the padding on a
// 320px-wide screen, the narrowest phone we support.
const CARD_W = 220, CARD_H = 308

type Tab = 'battle' | 'standings'

/**
 * Battle Royale reveal, phone layout. The desktop version puts the battle bar, the stage and the
 * standings side by side; on a phone that stacks into a column far taller than the screen, so the
 * reveal scrolls out of view exactly when it matters. Here the two live in tabs and each one owns
 * the whole viewport.
 *
 * The Battle tab stays MOUNTED (hidden, not unmounted) while Standings is on top: the card
 * ceremony advances on setTimeout and calls onCardShown to move the reveal along, so unmounting it
 * would freeze the whole battle for as long as the player reads the table.
 */
export function RoyaleRevealMobile({ vm, proj, rv, name, reducedMotion }: {
  vm: RevealVM
  proj: RevealVM                       // projection: only what has been revealed so far
  rv: RoyaleRevealState
  name: (p: RevealPlayerVM) => string
  reducedMotion: boolean
}) {
  const [tab, setTab] = useState<Tab>('battle')
  const onBattle = tab === 'battle'

  const activeWallet = rv.stagingWallet ?? rv.openingWallet
  const activePlayer = activeWallet ? proj.players.find((p) => p.wallet === activeWallet) ?? null : null
  const isOpening = !!rv.openingWallet && !rv.stagingWallet

  // Who opens after the current player — the reveal walks the round's order in seat order.
  const order = revealOrderWallets(vm, rv.revealRound)
  const idx = activeWallet ? order.indexOf(activeWallet) : -1
  const upNextWallet = idx >= 0 && idx + 1 < order.length ? order[idx + 1] : null

  const nameOfWallet = (w: string) => {
    const p = vm.players.find((x) => x.wallet === w)
    return p ? name(p) : shortWallet(w)
  }

  const alive = proj.players.filter((p) => p.eliminatedRound == null).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 14 }}>
      <Tabs tab={tab} onTab={setTab} alertStandings={onBattle && !!rv.justEliminated} />

      {/* Kept mounted while hidden — see the note above. */}
      <div style={{ display: onBattle ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, gap: 14 }}>
        <StatHeader round={Math.min(rv.revealRound, totalRounds(vm))} rounds={totalRounds(vm)}
          alive={alive} total={vm.players.length} pot={proj.potValue} />
        <Stage activePlayer={activePlayer} activeName={activePlayer ? name(activePlayer) : null}
          isOpening={isOpening} stagingCard={rv.stagingCard} revealKey={rv.stagingKey}
          reducedMotion={reducedMotion} onCardShown={rv.onCardShown} onFaceUp={rv.onCardFaceUp}
          upNextName={upNextWallet ? nameOfWallet(upNextWallet) : null} />
        <ChipStrip players={proj.players} name={name} activeWallet={activeWallet}
          justEliminated={rv.justEliminated} reducedMotion={reducedMotion} anchored={onBattle} />
      </div>

      <div style={{ display: onBattle ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 12 }}>
        <StandingsHeader round={Math.min(rv.revealRound, totalRounds(vm))} rounds={totalRounds(vm)} pot={proj.potValue} />
        <StandingsList players={proj.players} name={name} activeWallet={activeWallet}
          revealRound={rv.revealRound} anchored={!onBattle} />
      </div>
    </div>
  )
}

// ─────────────────────────── TABS ───────────────────────────
function Tabs({ tab, onTab, alertStandings }: { tab: Tab; onTab: (t: Tab) => void; alertStandings: boolean }) {
  const btn = (t: Tab): React.CSSProperties => ({
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: 9, borderRadius: 9, cursor: 'pointer',
    fontFamily: FONTS.body, fontSize: 13, fontWeight: 700,
    background: tab === t ? 'rgba(0,255,196,.12)' : 'transparent',
    border: `1px solid ${tab === t ? 'rgba(0,255,196,.35)' : 'transparent'}`,
    color: tab === t ? COLORS.green : COLORS.muted,
  })
  return (
    <div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 12, background: 'rgba(255,255,255,.04)', border: `1px solid ${COLORS.border}` }}>
      <button type="button" onClick={() => onTab('battle')} style={btn('battle')}>Battle</button>
      <button type="button" onClick={() => onTab('standings')} style={btn('standings')}>
        Standings
        {/* Only lights up on a real change to read: someone just went out. */}
        {alertStandings && <span aria-label="someone was just eliminated"
          style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.green, display: 'inline-block' }} />}
      </button>
    </div>
  )
}

// ─────────────────────────── BATTLE: header ───────────────────────────
function StatHeader({ round, rounds, alive, total, pot }: {
  round: number; rounds: number; alive: number; total: number; pot: number
}) {
  const label = (t: string) => (
    <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.1em', color: '#7a8492' }}>{t}</div>
  )
  const sub = { fontSize: 11, color: '#7a8492' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ lineHeight: 1.2 }}>
        {label('ROUND')}
        <div style={{ fontSize: 15, fontWeight: 700 }}>{round}<span style={sub}>/{rounds}</span></div>
      </div>
      <div style={{ lineHeight: 1.2, textAlign: 'center' }}>
        {label('ALIVE')}
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.green }}>{alive}<span style={sub}>/{total}</span></div>
      </div>
      <div style={{ lineHeight: 1.2, textAlign: 'right' }}>
        {label('POT')}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: POT_GOLD }}>{formatUsd(pot)}</span>
          <PotGain pot={pot} />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── BATTLE: stage ───────────────────────────
function Stage({ activePlayer, activeName, isOpening, stagingCard, revealKey, reducedMotion, onCardShown, onFaceUp, upNextName }: {
  activePlayer: RevealPlayerVM | null; activeName: string | null; isOpening: boolean
  stagingCard: RevealVM['rounds'][number]['cards'][number] | null
  revealKey: string | null; reducedMotion: boolean; onCardShown: () => void; onFaceUp: () => void; upNextName: string | null
}) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      // Recorta la franja de rareza, que se pasa de largo para llegar a los dos bordes.
      position: 'relative', overflow: 'hidden',
      gap: 14, padding: '14px 10px', borderRadius: 16, border: `1px solid ${COLORS.border}`,
      background: 'radial-gradient(80% 60% at 50% 40%,rgba(0,255,196,.08),transparent 70%)',
    }}>
      {/* who is opening */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
        <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', background: activePlayer ? tintFor(activePlayer.wallet) : '#2a3340' }} />
        <span style={{ fontSize: 16, fontWeight: 700, color: activePlayer?.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {activeName ?? '—'}
        </span>
        <span style={{ flex: 'none', fontFamily: FONTS.mono, fontSize: 9, color: COLORS.green, background: 'rgba(0,255,196,.1)', border: '1px solid rgba(0,255,196,.3)', padding: '2px 7px', borderRadius: 5 }}>
          {activeName ? (isOpening ? 'OPENING' : 'REVEALING') : 'WAITING'}
        </span>
      </div>

      {stagingCard
        ? <StagedCardReveal key={revealKey ?? stagingCard.nftAddress} year={stagingCard.year} grade={stagingCard.grade}
            rarity={stagingCard.rarity} reduced={reducedMotion} width={CARD_W} height={CARD_H}
            stacked
            preloadSrc={stagingCard.nftAddress ? ccCardImageUrl(stagingCard.nftAddress) : undefined}
            onCardShown={onCardShown} onFaceUp={onFaceUp}>
            <RevealCard reducedMotion={reducedMotion} card={stagingCard} w={CARD_W} h={CARD_H} valueColor={COLORS.text} />
          </StagedCardReveal>
        : <CardBack width={CARD_W} height={CARD_H} accent={COLORS.muted} label={activeName ? 'opening…' : ''} />}

      <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: '#7a8492', minHeight: 13, textAlign: 'center' }}>
        {upNextName && <>UP NEXT · <span style={{ color: '#cdd4dd' }}>{upNextName}</span></>}
      </div>
    </div>
  )
}

// ─────────────────────────── BATTLE: chip strip ───────────────────────────
// One compact chip per player. `anchored` gates data-player-anchor so thrown emotes only target
// the visible tab — the hidden one measures 0×0 and would drop every bubble in the corner.
function ChipStrip({ players, name, activeWallet, justEliminated, reducedMotion, anchored }: {
  players: RevealPlayerVM[]; name: (p: RevealPlayerVM) => string; activeWallet: string | null
  justEliminated: string | null; reducedMotion: boolean; anchored: boolean
}) {
  return (
    <div className="hidescroll" style={{ display: 'flex', gap: 7, overflowX: 'auto', flex: 'none' }}>
      {players.map((p) => {
        const cur = p.wallet === activeWallet
        const out = p.eliminatedRound != null
        const beat = !reducedMotion && p.wallet === justEliminated
        const latest = p.cards[p.cards.length - 1] ?? null
        const hasPull = !!latest && !cur
        return (
          <div key={p.wallet} {...(anchored ? { 'data-player-anchor': p.wallet } : {})} style={{
            flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 9,
            opacity: out ? 0.55 : 1, transition: 'box-shadow .3s, border-color .3s',
            background: cur ? 'rgba(0,255,196,.08)' : 'rgba(255,255,255,.025)',
            border: `1px solid ${beat ? 'rgba(255,94,122,.6)' : cur ? 'rgba(0,255,196,.45)' : out ? 'rgba(255,46,126,.25)' : COLORS.border}`,
            boxShadow: beat ? '0 0 30px -12px rgba(255,94,122,.8)' : 'none',
          }}>
            <span style={{ flex: 'none', width: 14, height: 14, borderRadius: '50%', background: tintFor(p.wallet) }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: p.isMe ? COLORS.green : '#cdd4dd', whiteSpace: 'nowrap' }}>{name(p)}</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, color: cur || hasPull ? COLORS.green : '#4a525e' }}>
              {cur ? '···' : hasPull ? formatUsd(latest!.insuredValue ?? 0) : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────── STANDINGS ───────────────────────────
function StandingsHeader({ round, rounds, pot }: { round: number; rounds: number; pot: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: '#ff6ba4', background: 'rgba(255,46,126,.1)', border: '1px solid rgba(255,46,126,.3)', padding: '3px 8px', borderRadius: 6 }}>
        R{round}/{rounds}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>Battle Royale</span>
      <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: POT_GOLD }}>{formatUsd(pot)}</span>
    </div>
  )
}

function StandingsList({ players, name, activeWallet, revealRound, anchored }: {
  players: RevealPlayerVM[]; name: (p: RevealPlayerVM) => string
  activeWallet: string | null; revealRound: number; anchored: boolean
}) {
  // Same ordering as the desktop table: alive on top by value, eliminated sink to the bottom
  // (most recent first) so a living player never ranks below an out one.
  const sorted = [...players].sort((a, b) =>
    ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.total - a.total) || a.wallet.localeCompare(b.wallet))
  const aliveCount = players.filter((p) => p.eliminatedRound == null).length
  // Last alive by value — the one who drops if the round ended now. Kept from the desktop view:
  // it's the single most useful thing the table can tell you mid-round.
  const atRiskWallet = aliveCount > 1 ? [...sorted].reverse().find((p) => p.eliminatedRound == null)?.wallet ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {sorted.map((p, i) => {
        const cur = p.wallet === activeWallet
        const out = p.eliminatedRound != null
        const atRisk = p.wallet === atRiskWallet
        const leader = i === 0
        const latest = p.cards[p.cards.length - 1] ?? null
        // Each alive player pulls once per round, so "has a card for this round" = already opened.
        const pulled = p.cards.length >= revealRound
        const status = cur ? 'OPENING' : out ? `OUT·R${p.eliminatedRound}` : pulled ? 'DONE' : 'WAIT'
        // Primera fila eliminada: la lista ya los ordena abajo, pero sin corte la frontera entre
        // "sigo vivo" y "fuera" hay que deducirla leyendo estado por estado.
        const firstOut = out && i > 0 && sorted[i - 1].eliminatedRound == null
        return (
          <Fragment key={p.wallet}>
          {firstOut && (
            <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
              <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.08)' }} />
              <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: '.18em', color: '#5d6674' }}>ELIMINATED</span>
              <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.08)' }} />
            </div>
          )}
          <div {...(anchored ? { 'data-player-anchor': p.wallet } : {})} style={{
            flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', minHeight: 52, borderRadius: 11,
            background: atRisk ? 'rgba(255,94,122,.07)' : leader ? 'rgba(245,197,66,.09)' : cur ? 'rgba(0,255,196,.07)' : '#0c0f15',
            border: `1px solid ${leader ? 'rgba(245,197,66,.4)' : atRisk ? 'rgba(255,94,122,.45)' : cur ? 'rgba(0,255,196,.45)' : COLORS.border}`,
          }}>
            <span style={{ width: 16, fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, color: leader ? '#f5c542' : atRisk ? '#ff5e7a' : '#7a8492' }}>{i + 1}</span>
            <span style={{ flex: 'none', width: 18, height: 18, borderRadius: '50%', background: tintFor(p.wallet), opacity: out ? 0.5 : 1 }} />
            <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: cur ? COLORS.green : out ? '#5d6674' : '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: out ? 'line-through' : 'none' }}>{name(p)}</span>
                {p.isMe && <span style={{ flex: 'none', padding: '1px 5px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, color: COLORS.green }}>YOU</span>}
              </div>
              {/* The card name truncates; the amount never does — it's the part worth reading. */}
              <div style={{ display: 'flex', gap: 4, fontSize: 10, color: '#7a8492', minWidth: 0 }}>
                {latest ? (
                  <>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pullTitle(latest)}</span>
                    <span style={{ flex: 'none' }}>· {formatUsd(latest.insuredValue ?? 0)}</span>
                  </>
                ) : 'no pulls yet'}
              </div>
            </div>
            <span style={{ flex: 'none', fontFamily: FONTS.mono, fontSize: 8.5, color: cur ? COLORS.green : out ? '#ff6ba4' : '#5d6674' }}>{status}</span>
            <span style={{ flex: 'none', width: 52, textAlign: 'right', fontFamily: FONTS.mono, fontSize: 12.5, fontWeight: 700, color: p.total > 0 ? COLORS.text : '#7a8492' }}>
              {formatUsd(p.total)}
            </span>
          </div>
          </Fragment>
        )
      })}
    </div>
  )
}
