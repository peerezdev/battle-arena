import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import { NAV_ROUTES } from '../../layouts/navRoutes'
import { config } from '../../../onchain/config'
import { NAV_ITEMS, type HubNav } from './hubMockData'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative' }}>
      {children}
    </svg>
  )
}

export const NAV_ICONS: Record<HubNav, ReactNode> = {
  lobby: <Svg><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></Svg>,
  pack: <Svg><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /><line x1="7" x2="4" y1="17" y2="20" /><line x1="3" x2="5" y1="19" y2="21" /></Svg>,
  royale: <Svg><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></Svg>,
  gacha: <Svg><rect x="3" y="3" width="12" height="17" rx="1.2" /><path d="M3 9h12M3 15h12M7 9v6M11 9v6" /><path d="M5.5 5.5h7M5.5 7h7" /><path d="M15 11h2v3h-2" /><circle cx="19.5" cy="6" r="2" /><path d="M19.5 8v3" /></Svg>,
  mana: <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Svg>,
  tracker: <Svg><path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z" /></Svg>,
  winners: <Svg><path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z" /></Svg>,
  ranks: <Svg><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></Svg>,
  help: <Svg><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></Svg>,
}

// La lista vive en `hubMockData` y la comparten el rail y la barra de móvil: cuando estaban
// duplicadas se desincronizaron.
const ITEMS = NAV_ITEMS

export function LeftRail({ active }: { active: HubNav }) {
  const [hovered, setHovered] = useState<HubNav | null>(null)
  return (
    <nav
      style={{
        background: 'linear-gradient(180deg,rgba(255,255,255,.02),transparent)',
        borderRight: `1px solid ${COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '18px 0 14px',
        gap: 6,
        height: '100vh',
      }}
    >
      {/* Brand emblem (transparent, loose on the rail) */}
      <img
        src="/logo-rail.png"
        alt="Collector Arena"
        width={46}
        height={46}
        style={{ marginBottom: 16, flexShrink: 0, objectFit: 'contain', display: 'block' }}
      />

      {/* Nav items */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
        {ITEMS.map((item) => {
          const isActive = item.id === active
          const isHover = !isActive && hovered === item.id
          return (
            <Link
              key={item.id}
              to={NAV_ROUTES[item.id]}
              title={item.label}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered((h) => (h === item.id ? null : h))}
              style={{
                position: 'relative',
                width: 62,
                padding: '11px 0',
                borderRadius: 14,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                color: isActive || isHover ? COLORS.text : COLORS.muted,
                background: isHover ? '#ffffff0a' : 'transparent',
                border: 'none',
                textDecoration: 'none',
                transition: 'color .12s, background .12s',
                fontFamily: FONTS.body,
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 14,
                    background: 'linear-gradient(180deg,rgba(0,255,196,.18),rgba(0,255,196,.05))',
                    border: '1px solid rgba(0,255,196,.45)',
                    boxShadow: '0 0 22px -6px rgba(0,255,196,.7)',
                  }}
                />
              )}
              {NAV_ICONS[item.id]}
              {/* Each word on its own line, so two-word labels (Pack Battle, Battle Royale) wrap. */}
              <span style={{ position: 'relative', fontSize: 11, fontWeight: 500, letterSpacing: '.02em', textAlign: 'center', lineHeight: 1.15 }}>
                {item.label.split(' ').map((word, i) => (
                  <span key={i} style={{ display: 'block' }}>{word}</span>
                ))}
              </span>
            </Link>
          )
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <SocialLinks />
    </nav>
  )
}


/**
 * Discord y X, abajo del todo del rail.
 *
 * Las marcas van RELLENAS (`fill`), no de trazo como el resto de iconos del rail: son logotipos
 * ajenos y dibujarlos en contorno los deja irreconocibles. Por eso no reutilizan `Svg`.
 *
 * Cada icono aparece solo si su URL está configurada. Un enlace social que no lleva a ninguna
 * parte transmite que el proyecto está abandonado, que es peor que no ofrecerlo.
 */
function Marca({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: hover ? COLORS.text : COLORS.muted,
        background: hover ? '#ffffff0a' : 'transparent', transition: 'color .12s, background .12s',
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </a>
  )
}

export function SocialLinks() {
  const { discordUrl, xUrl } = config
  if (!discordUrl && !xUrl) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 10 }}>
      {discordUrl && (
        <Marca href={discordUrl} label="Discord">
          <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </Marca>
      )}
      {xUrl && (
        <Marca href={xUrl} label="X">
          <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z" />
        </Marca>
      )}
    </div>
  )
}
