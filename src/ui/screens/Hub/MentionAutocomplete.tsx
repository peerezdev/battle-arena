import { useEffect, useRef, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import type { OnlineUser } from './mentions'

/** Wallet corta para la segunda línea. Dos jugadores pueden tener nombres parecidos, y quien no
 *  tiene alias se llama justo como su wallet: sin esto no habría forma de distinguirlos. */
function corta(w: string): string {
  return w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

/**
 * Un elemento de la lista.
 *
 * Las menciones siguen pasando `OnlineUser` tal cual, así que no cambian: los dos campos nuevos
 * son opcionales y quien no los manda ve exactamente lo de antes. Los usa el autocompletado de
 * comandos (`detalle` = la descripción del comando, que no es una wallet) y la búsqueda de
 * jugadores de `/tip` (`online` = está conectado ahora, que en las menciones lo están TODOS y por
 * eso allí no se pinta).
 */
export interface CandidatoLista extends OnlineUser {
  online?: boolean
  detalle?: string
}

/**
 * La lista que se abre al escribir `@` en el chat (y la de comandos al escribir `/`).
 *
 * Se apodera de cuatro teclas mientras está abierta (flechas, Enter y Escape) y les hace
 * `preventDefault`. Sin eso, Enter enviaría el mensaje a medio escribir en lugar de elegir a quien
 * está resaltado, y las flechas moverían el cursor del campo de texto por debajo.
 *
 * Los candidatos los filtra quien la usa: aquí solo se pintan y se navegan.
 */
export function MentionAutocomplete({
  candidatos,
  onElegir,
  onCerrar,
}: {
  candidatos: CandidatoLista[]
  onElegir: (u: CandidatoLista) => void
  onCerrar: () => void
}) {
  const [i, setI] = useState(0)
  // El resaltado se lee dentro del manejador de teclado, que no debe recrearse en cada pulsación.
  const iRef = useRef(0)
  useEffect(() => { iRef.current = i }, [i])

  // El resaltado se ACOTA al pintar en vez de reiniciarse con un efecto: llamar a setState dentro
  // de un efecto encadena renders (y el linter lo prohíbe). Al filtrar, quien usa el componente lo
  // remonta con `key`, así que empezar por el primero sale gratis; esto solo protege de que una
  // lista que encoge deje resaltada una posición que ya no existe.
  const sel = Math.min(i, candidatos.length - 1)

  useEffect(() => {
    if (candidatos.length === 0) return
    function alPulsar(e: KeyboardEvent) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const paso = e.key === 'ArrowDown' ? 1 : -1
        // Da la vuelta en los extremos: con listas de 2 o 3, toparse contra el borde se nota.
        setI((n) => (n + paso + candidatos.length) % candidatos.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onElegir(candidatos[Math.min(iRef.current, candidatos.length - 1)])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCerrar()
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [candidatos, onElegir, onCerrar])

  if (candidatos.length === 0) return null

  return (
    <div
      role="listbox"
      style={{
        position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6,
        background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10,
        overflow: 'hidden', boxShadow: '0 8px 24px #000a', zIndex: 5,
      }}
    >
      {candidatos.map((u, n) => (
        <div
          key={u.wallet}
          role="option"
          aria-selected={n === sel}
          onMouseEnter={() => setI(n)}
          onClick={() => onElegir(u)}
          style={{
            padding: '6px 10px', cursor: 'pointer',
            background: n === sel ? '#ffffff10' : 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Punto de conectado. Lleva `role="img"` con etiqueta en vez de ser decorativo
                porque no repite nada de lo que ya diga la fila: quien no ve el color se
                quedaría sin el dato. */}
            {u.online && (
              <span
                role="img"
                aria-label="Online now"
                title="Online now"
                style={{
                  width: 6, height: 6, borderRadius: '50%', background: COLORS.green,
                  boxShadow: `0 0 6px ${COLORS.green}`, flexShrink: 0,
                }}
              />
            )}
            <div style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.text }}>{u.name}</div>
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>
            {u.detalle ?? corta(u.wallet)}
          </div>
        </div>
      ))}
    </div>
  )
}
