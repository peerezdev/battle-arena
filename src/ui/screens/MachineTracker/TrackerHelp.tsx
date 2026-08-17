import { useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { ACENTO } from './evAcento'

/**
 * Cómo se lee una tarjeta del tracker.
 *
 * El texto sale de las preguntas que la pantalla provocó de verdad —qué es este número, y el
 * modelo, por qué dice UNCLEAR, qué son P/VALUE/GROSS— y no de una lista de campos. Un glosario
 * explica la interfaz; esto explica la decisión que el jugador está intentando tomar.
 *
 * VA CERRADO. Es una pantalla a la que se vuelve, así que el explicador tiene que estar disponible
 * sin estorbar: abierto empujaría la rejilla hacia abajo cada vez, y el trabajo aquí es comparar
 * máquinas, no leer.
 *
 * Y usa LAS MISMAS PALABRAS que la tarjeta —measured, model, GAP, UNCLEAR— porque un explicador con
 * su propio vocabulario obliga a traducir dos veces.
 */
export function TrackerHelp() {
  const [abierto, setAbierto] = useState(false)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: abierto ? 12 : 0 }}>
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        style={{
          alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8,
          minHeight: 34, padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
          border: `1px solid ${COLORS.border}`, background: 'transparent',
          fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted,
        }}
      >
        How to read a card
        <span aria-hidden style={{ fontSize: 9, opacity: .7 }}>{abierto ? '▴' : '▾'}</span>
      </button>

      {abierto && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12,
        }}>
          <Bloque titulo="The big number" acento={ACENTO.bueno}>
            How much the machine pays back <b>per dollar</b>, measured on every pull from the public
            Collector Crypt feed over the last 48 hours. <Mono>0.94</Mono> means 94 cents back for
            every dollar spent.
          </Bloque>

          <Bloque titulo="Measured vs model" acento="#ffffffdd">
            The needle is what the machine is <b>actually</b> paying. The white dot on the arc is
            what it <b>should</b> pay, worked out from the cards still inside it and the odds
            Collector Crypt publishes. The distance between them is the whole point.
          </Bloque>

          <Bloque titulo="Why a card says UNCLEAR" acento={ACENTO.dudoso}>
            Every measurement has a margin of error, and with few pulls it is wide. When that margin
            still includes both winning and losing, we say so instead of picking a side. The card
            tells you roughly how many more pulls would settle it.
          </Bloque>

          <Bloque titulo="The table" acento={COLORS.violet}>
            <Mono>P</Mono> is how often that rarity drops. <Mono>VALUE</Mono> is what its cards are
            worth on average. <Mono>GROSS</Mono> is what it contributes to the pack —
            <Mono>P × VALUE</Mono> — and the four add up to the model.
          </Bloque>

          <Bloque titulo="GAP is not a countdown" acento={ACENTO.malo}>
            <Mono>GAP</Mono> is how many pulls since that rarity last appeared, and <Mono>AVG</Mono>{' '}
            how long it usually takes. A long gap does <b>not</b> make it more likely: the draw uses
            VRF and every pull is independent. It only tells you the machine has been running cold.
          </Bloque>

          <Bloque titulo="Sell back or keep" acento={ACENTO.sinDatos}>
            A card is worth its full value if you keep it, or the buyback percentage if you sell it
            straight back. Both are true, so the switch above lets you pick which one every number
            on this page is showing.
          </Bloque>
        </div>
      )}
    </section>
  )
}

function Bloque({ titulo, acento, children }: {
  titulo: string; acento: string; children: React.ReactNode
}) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 13,
      background: `linear-gradient(180deg,${acento}0d,transparent 60%),${COLORS.panel}`,
      border: `1px solid ${COLORS.border}`,
    }}>
      <h3 style={{
        margin: '0 0 7px', fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.14em',
        fontWeight: 400, color: acento, textTransform: 'uppercase',
      }}>
        {titulo}
      </h3>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: '#b8c0cb' }}>{children}</p>
    </div>
  )
}

/** Un término que aparece LITERAL en la tarjeta. Va en monoespaciada para que se reconozca de un
 *  salto de vista, sin tener que buscarlo. */
const Mono = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.text }}>{children}</span>
)
