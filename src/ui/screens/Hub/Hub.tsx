import { useEffect } from 'react'
import { Banner } from './Banner'
import { NAV_ROUTES } from '../../layouts/navRoutes'
import { hrefFiltro } from './lobbyFilter'
import { loadMachineList } from '../../useMachines'

/**
 * La PORTADA, para quien todavía no ha entrado.
 *
 * Dejó de ser la parada del jugador que vuelve: eran tres banners, cero estado y ninguna acción
 * propia, o sea un menú de pósters encima de la barra lateral, que ya es un menú. Con sesión se
 * entra directo al Lobby (ver `Entrada` en App); esto es lo que ve quien llega de fuera y todavía
 * no sabe qué es cada modo, que es justo para lo que sirve.
 *
 * Original: Home — the overview landing. Quick Match + Live games live on the mode-specific pages
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
          titlePlain="The first-ever NFT Battle Royale"
          titleAccent=" powered by real graded cards is here..."
          body="If you've only been into TCGs for two days, this isn't for you."
          tail="This is gacha for the big boys."
          cta="See how it works →"
          to={hrefFiltro('royale')}
          badge="● LIVE ROYALE"
          accent="#ff2e7e"
          poster="/01-hub.png"
          // videoWebm="/stickers/scizor-card.webm"
          // videoMov="/stickers/scizor-card.mov"
          mediaX={-10}
          mediaY={-40}
          mediaWidth={600}
        />

        {/* Pack Battle + Gacha — stacked banners (image on top, text below), side by side. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 26 }}>
          <Banner
            layout="stacked"
            kicker="02 · PACK BATTLE"
            titlePlain="Open a pack."
            titleAccent="Take theirs."
            body="Anyone who's played a Pack Battle knows the feeling is completely different from opening packs alone. More pressure. More adrenaline. More at stake."
            tail="Think you can handle it?"
            cta="Enter the lobby →"
            to={hrefFiltro('pack')}
            badge="WINNER TAKES ALL"
            accent="#3ce8a8"
            ctaTextColor="#06221a"
            poster="/02-hub.png"
            mediaHeight={180}
            mediaWidth={600}
          />
          <Banner
            layout="stacked"
            kicker="03 · GACHA"
            titlePlain="One pull."
            titleAccent="Straight into battle."
            body="A grail could be waiting in the next pull."
            tail="Get there before someone else does."
            cta="Rip a pack →"
            to={NAV_ROUTES.gacha}
            badge="PULL"
            accent="#a98bff"
            ctaTextColor="#fff"
            poster="/03-hub.png"
            mediaHeight={180}
          />
        </div>
      </div>
    </div>
  )
}
