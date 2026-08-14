import { Link } from 'react-router-dom'
import { Fragment } from 'react'
import { COLORS } from '../../theme'
import type { Mention } from './mentions'

/** Escapa lo que va dentro de una expresión regular. Sin esto, una etiqueta como `8QDB…gtm6`
 *  (la wallet abreviada de quien no tiene alias) trataría el punto como comodín. */
function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * El texto de un mensaje de chat, con sus menciones resaltadas y enlazadas al perfil.
 *
 * Las menciones vienen por separado, no dentro del texto: el mensaje conserva lo que se escribió
 * entonces y el enlace apunta a quien era, aunque esa persona se cambie el nombre después. Aquí
 * solo se buscan las apariciones de cada etiqueta.
 *
 * Sin `mentions` devuelve el texto tal cual, que es el caso de todos los mensajes anteriores a
 * esta funcionalidad.
 */
export function MessageText({ text, mentions }: { text: string; mentions?: Mention[] }) {
  if (!mentions?.length) return <>{text}</>

  // Una sola pasada con todas las etiquetas: partir el texto etiqueta a etiqueta obligaría a
  // recorrer los trozos ya partidos y a no volver a tocar los enlaces creados.
  const porEtiqueta = new Map(mentions.map((m) => [m.label, m.wallet]))
  const re = new RegExp(`@(${mentions.map((m) => escapar(m.label)).join('|')})`, 'g')
  const trozos: (string | Mention)[] = []
  let ultimo = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > ultimo) trozos.push(text.slice(ultimo, i))
    trozos.push({ label: m[1], wallet: porEtiqueta.get(m[1]) as string })
    ultimo = i + m[0].length
  }
  if (ultimo < text.length) trozos.push(text.slice(ultimo))

  return (
    <>
      {trozos.map((t, i) =>
        typeof t === 'string' ? (
          <Fragment key={i}>{t}</Fragment>
        ) : (
          <Link
            key={i}
            to={`/profile/${encodeURIComponent(t.wallet)}`}
            style={{
              color: COLORS.green, background: `${COLORS.green}1a`, borderRadius: 4,
              padding: '0 3px', textDecoration: 'none', fontWeight: 600,
            }}
          >
            @{t.label}
          </Link>
        ),
      )}
    </>
  )
}
