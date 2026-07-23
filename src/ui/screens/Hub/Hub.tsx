import { useEffect } from 'react'
import { Banner } from './Banner'
import { NAV_ROUTES } from '../../layouts/navRoutes'
import { loadMachineList } from '../../useMachines'

/**
 * Home — the overview landing. Quick Match + Live games live on the mode-specific pages
 * (Pack Battle / Battle Royale); Home is a hero Banner (video + independent poster) plus the
 * stacked Pack Battle / Gacha banners below it.
 * NewsCarousel / BestHitCard / ModeSections / ModeGuide are kept for possible reuse but no longer rendered here.
 */
export function Hub() {
  // Warm the machine catalogue so the Pack/Royale pages open with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  // flexShrink 0 matters: <main> is a flex column with a fixed height and a bottom padding that
  // reserves room for the mobile nav + radio bar. As a shrinkable flex item this page collapsed to
  // that padded height and spilled its content OUT of the padding box, so the last banner's CTA
  // ended up underneath the bottom nav. Laying out at natural height keeps it inside.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Ticker hidden for now — re-add <BigPullTicker meWallet={useEmbeddedSolanaAddress()} /> to bring it back. */}
      <div style={{ padding: '24px clamp(16px,3vw,32px) 0', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <Banner
          kicker="01 · BATTLE ROYALE"
          titlePlain="10 players in."
          titleAccent="1 walks out with everything."
          body="9 rounds of graded-card warfare. The pot grows every round — 54 cards by the end — and the last one standing takes it ALL. One game per day. Don't miss your spot."
          cta="Enter the Royale →"
          to={NAV_ROUTES.royale}
          badge="● LIVE ROYALE"
          accent="#ff2e7e"
          poster="/logo2.png"
          videoWebm="/stickers/scizor-card.webm"
          videoMov="/stickers/scizor-card.mov"
          mediaX={70}
          mediaY={30}
          mediaWidth={300}
        />

        {/* Pack Battle + Gacha — stacked banners (image on top, text below), side by side. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 26 }}>
          <Banner
            layout="stacked"
            kicker="02 · PACK BATTLE"
            titlePlain="Open a pack."
            titleAccent="Take theirs."
            body="1v1, same tier, winner takes both cards. Decided by value or by a skill duel — you pick."
            cta="Enter Pack Battle →"
            to={NAV_ROUTES.pack}
            badge="1V1 · WINNER TAKES ALL"
            accent="#3ce8a8"
            ctaTextColor="#06221a"
            poster="/logo2.png"
            mediaHeight={180}
          />
          <Banner
            layout="stacked"
            kicker="03 · GACHA"
            titlePlain="One pull."
            titleAccent="Straight into battle."
            body="Open Collector Crypt packs solo and jump into a game with whatever card you pull."
            cta="Open a pack →"
            to={NAV_ROUTES.gacha}
            badge="PULL → PLAY"
            accent="#a98bff"
            ctaTextColor="#fff"
            poster="/logo.png"
            mediaHeight={180}
          />
        </div>
      </div>
    </div>
  )
}
