import { useEffect, useState } from 'react'
import { COLORS, FONTS } from './theme'
import { useIsWide } from './useIsWide'
import { subscribeToasts, currentInset, type ToastItem, type ToastKind } from './toastBus'

const ACCENT: Record<ToastKind, string> = { error: COLORS.red, info: COLORS.muted, success: COLORS.green }

/** Mount once near the app root. Renders stacked, auto-dismissing toasts.
 *
 *  `bottomOffset` lo pasa quien monta el Toaster, porque es quien sabe qué hay apilado abajo
 *  (nav móvil, barra de radio…). Si el toast se anclara a un valor fijo acabaría detrás de esa
 *  pila justo en móvil, que es donde menos sitio hay. */
export function Toaster({ bottomOffset = 24 }: { bottomOffset?: number } = {}) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [extra, setExtra] = useState(currentInset)
  const wide = useIsWide('(min-width: 900px)')

  useEffect(() => subscribeToasts(
    (t) => {
      setToasts((ts) => [...ts, t])
      // Leave actionable toasts up longer so the user can reach the button.
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), t.action ? 9000 : 5000)
    },
    (id) => setToasts((ts) => ts.filter((x) => x.id !== id)),
    (n) => setExtra(n),
  ), [])

  const dismiss = (id: number) => setToasts((ts) => ts.filter((x) => x.id !== id))

  return (
    <div style={{
      // Anclado abajo: el toast aparece cerca de donde el usuario acaba de pulsar, no en la
      // otra punta de la pantalla. Al crecer hacia arriba, el más reciente queda siempre pegado
      // al borde y los anteriores se desplazan, que es el orden que el ojo espera.
      // `extra` lo declara la pantalla de turno: sin él el toast queda DEBAJO de su barra
      // pegajosa, justo en móvil, que es donde menos sitio hay.
      position: 'fixed', bottom: bottomOffset + extra, zIndex: 9999,
      // En móvil ocupa de lado a lado; en escritorio se queda centrado y estrecho.
      ...(wide ? { left: '50%', transform: 'translateX(-50%)' } : { left: 0, right: 0, padding: '0 8px' }),
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: '#0c1019', border: `1px solid ${ACCENT[t.kind]}`, color: COLORS.text,
          borderRadius: 10, padding: '10px 16px', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600,
          ...(wide ? { maxWidth: 460 } : { width: '100%' }), boxShadow: '0 8px 28px #000a', textAlign: 'center',
          pointerEvents: t.action ? 'auto' : 'none',
          display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center',
        }}>
          <span>{t.msg}</span>
          {t.action && (
            <button
              onClick={() => { t.action!.onClick(); dismiss(t.id) }}
              style={{
                flexShrink: 0, background: COLORS.green, border: 'none', borderRadius: 8,
                padding: '6px 12px', color: '#06120c', fontFamily: FONTS.display, fontWeight: 800,
                fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {t.action.label}
            </button>
          )}
          {t.action && (
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss"
              style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '6px 10px', color: COLORS.muted, fontFamily: FONTS.body, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
