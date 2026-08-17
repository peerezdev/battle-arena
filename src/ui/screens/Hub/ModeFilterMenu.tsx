import { useEffect, useRef, useState } from 'react'
import { COLORS } from '../../theme'
import { MODOS, alternar, etiquetaModos, type Modo } from './lobbyFilter'

/**
 * El desplegable de modos de Live games.
 *
 * Ocupa el sitio donde había un "All games ▾" que era un `span` decorativo: tenía la flecha y el
 * cursor de mano, y ningún manejador. Prometía un menú que no existía.
 *
 * Las casillas se pueden desmarcar las DOS. Es a propósito: bloquear la última es de esas
 * defensas que dejan al usuario peleándose con un control que no le obedece. Lo que hay que hacer
 * es que la lista vacía se explique y ofrezca volver, no impedir llegar a ella.
 */
export function ModeFilterMenu({ modos, onChange }: {
  modos: Set<Modo>
  onChange: (m: Set<Modo>) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!abierto) return
    // Cerrar al pulsar fuera y con Escape. Sin lo segundo, quien navega con teclado se queda
    // dentro del menú sin salida.
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  return (
    <div ref={caja} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-expanded={abierto}
        aria-haspopup="true"
        onClick={() => setAbierto((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 34,
          fontSize: 11, color: modos.size === MODOS.length ? COLORS.muted : COLORS.text,
          border: `1px solid ${abierto ? '#ffffff2b' : COLORS.border}`,
          borderRadius: 9, padding: '7px 12px', cursor: 'pointer',
          background: abierto ? '#ffffff0a' : 'transparent',
          fontFamily: 'inherit',
        }}
      >
        {etiquetaModos(modos)}
        <span aria-hidden style={{ fontSize: 9, opacity: .7 }}>▾</span>
      </button>

      {abierto && (
        <div
          role="group"
          aria-label="Game mode"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30,
            minWidth: 208, padding: 6, borderRadius: 12,
            background: COLORS.panel2, border: `1px solid ${COLORS.border}`,
            boxShadow: '0 18px 44px -14px rgba(0,0,0,.85)',
          }}
        >
          {MODOS.map((m) => {
            const marcado = modos.has(m.id)
            return (
              <label
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  padding: '9px 10px', borderRadius: 8, minHeight: 40,
                  color: marcado ? COLORS.text : COLORS.muted, fontSize: 12.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => onChange(alternar(modos, m.id))}
                  style={{ width: 15, height: 15, accentColor: COLORS.green, cursor: 'pointer' }}
                />
                <span style={{ flex: 1 }}>{m.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
