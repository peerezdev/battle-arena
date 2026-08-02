import { COLORS, FONTS } from '../../theme'
import { PnlCard } from './PnlCard'
import { xIntentUrl } from './shareOnX'
import type { Pnl } from './pnl'

/**
 * La tarjeta del ganador con su botón de compartir.
 *
 * El botón vive AQUÍ y no dentro de `PnlCard` a propósito: la tarjeta tiene que poder pintarse
 * limpia —para una captura o una exportación— sin un botón encima.
 */
export function WinnerShare({ pnl, winnerName }: { pnl: Pnl; winnerName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <PnlCard pnl={pnl} winnerName={winnerName} />
      <a
        href={xIntentUrl(pnl)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '11px 18px', borderRadius: 12,
          border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.05)',
          color: COLORS.text, fontFamily: FONTS.display, fontSize: 13.5, fontWeight: 700,
        }}
      >
        <XGlyph /> Share on X
      </a>
    </div>
  )
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.3-8.3L2.3 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.3 3.8H5.5L17.8 20Z" />
    </svg>
  )
}
