import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { motion } from 'framer-motion'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { useReducedMotion } from '../../useReducedMotion'
import { ccAssetUrl, type MachineCard } from '../../../onchain/gachaClient'
import { HoloCard } from '../../components/HoloCard'
import { rarityColor } from '../battle/RevealCard'

function abbreviate(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : mint
}

const EASE_OUT = [0.32, 0.72, 0, 1] as const
const COLLAPSE_MS = 300
/** Lo que ocupa el modal por encima y por debajo del cuerpo: padding (26 + 38) + cabecera
 *  (botón de 34 + 24 de margen). Se resta del 92vh para saber cuánto alto queda para la
 *  columna de info. Si cambias esos valores en el JSX, actualiza esto. */
const MODAL_CHROME = 122

type Row = [string, string]

/**
 * El contenido SIEMPRE está montado (no `open && …`): su alto natural es lo que el modal mide
 * para reservar un área fija, y sólo se puede medir un nodo que existe. Cerrado = alto animado
 * a 0 con overflow hidden; el div interior conserva su alto real, que es el que se mide.
 */
function Accordion({ title, rows, open, onToggle, contentRef, reduced }: {
  title: string
  rows: Row[]
  open: boolean
  onToggle: () => void
  contentRef: RefObject<HTMLDivElement | null>
  reduced: boolean
}) {
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current) }, [])

  if (rows.length === 0) return null

  function handleToggle() {
    const willOpen = !open
    onToggle()
    // Al abrir con otras secciones ya abiertas, el contenido nuevo puede caer bajo el borde
    // del área con scroll y parecer que no ha pasado nada. Se acerca cuando la animación
    // termina (antes, `nearest` mediría un alto a medio expandir).
    if (!willOpen) return
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
    }, reduced ? 0 : COLLAPSE_MS)
  }

  return (
    <div ref={sectionRef}>
      <button
        onClick={handleToggle}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 2px', border: 0, borderBottom: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 600 }}
      >
        {title}
        {/* +/− como dos barras: la vertical se pliega. Cambiar el glifo '+' por '−' daría un
            salto seco justo cuando el resto de la transición es suave. */}
        <span aria-hidden style={{ position: 'relative', flex: 'none', width: 14, height: 14 }}>
          <span style={{ position: 'absolute', top: 6, left: 0, width: 14, height: 2, borderRadius: 2, background: COLORS.muted }} />
          <motion.span
            initial={false}
            animate={{ scaleY: open ? 0 : 1, opacity: open ? 0 : 1 }}
            transition={{ duration: reduced ? 0 : COLLAPSE_MS / 1000, ease: EASE_OUT }}
            style={{ position: 'absolute', top: 0, left: 6, width: 2, height: 14, borderRadius: 2, background: COLORS.muted, transformOrigin: 'center' }}
          />
        </span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : {
          height: { duration: COLLAPSE_MS / 1000, ease: EASE_OUT },
          opacity: { duration: open ? 0.22 : 0.14, delay: open ? 0.06 : 0 },
        }}
        style={{ overflow: 'hidden' }}
      >
        <div ref={contentRef} style={{ padding: '14px 2px 6px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, fontSize: 13.5 }}>
              <span style={{ color: COLORS.muted }}>{k}</span>
              <span style={{ fontWeight: 600, color: COLORS.text, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

export function CardDetailsModal({ card, onClose }: { card: MachineCard; onClose: () => void }) {
  const gallery = card.images.length > 0 ? card.images : card.image ? [card.image] : []
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState({ grading: true, vault: false, contract: false })
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const wide = useIsWide('(min-width: 760px)')
  const reduced = useReducedMotion()
  const mint = card.nft_address
  const big = gallery[active] ?? null
  const accent = rarityColor(card.rarity)

  // --- Altura fija de la columna de info ---------------------------------------------
  // El modal no puede crecer ni encoger al abrir/cerrar secciones. Se bloquea el alto de la
  // columna derecha en `alto con todo cerrado + TODAS las secciones abiertas`: caben las tres
  // a la vez, así que no hay scroll interno en ningún estado. El único tope es la pantalla:
  // si eso no cabe en el modal (92vh), se recorta y entonces sí scrollea el área de
  // acordeones — antes que hacer crecer el modal más allá del viewport.
  const colRef = useRef<HTMLDivElement | null>(null)
  const gradingContent = useRef<HTMLDivElement | null>(null)
  const vaultContent = useRef<HTMLDivElement | null>(null)
  const contractContent = useRef<HTMLDivElement | null>(null)
  const [lockedH, setLockedH] = useState<number | null>(null)
  // `measure` es estable (no debe recrearse en cada toggle: remedir a mitad de animación daría
  // un alto a medias), pero necesita leer el estado ACTUAL de las secciones. De ahí el ref.
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  const measure = useCallback(() => {
    const col = colRef.current
    if (!col) return
    const heights = {
      grading: gradingContent.current?.offsetHeight ?? 0,
      vault: vaultContent.current?.offsetHeight ?? 0,
      contract: contractContent.current?.offsetHeight ?? 0,
    }
    // Se mide con el alto liberado; si no, se leería el candado anterior en vez del natural.
    // Es un layout effect: ocurre antes del pintado, así que no parpadea.
    const prev = col.style.height
    col.style.height = 'auto'
    const natural = col.offsetHeight
    col.style.height = prev
    // Restar lo que esté abierto AHORA hace que el resultado no dependa del estado en el que
    // se mida (montaje, resize o cambio de fuente dan el mismo número).
    const openNow = (Object.keys(heights) as (keyof typeof heights)[])
      .reduce((sum, k) => sum + (openRef.current[k] ? heights[k] : 0), 0)
    const everything = Object.values(heights).reduce((a, b) => a + b, 0)
    let next = Math.round(natural - openNow + everything)
    // Tope en pantallas bajas. Sólo en layout ancho: en móvil la columna va DEBAJO de la
    // carta y el modal entero scrollea, que es lo natural ahí.
    if (wide) next = Math.min(next, Math.round(window.innerHeight * 0.92) - MODAL_CHROME)
    // offsetHeight es 0 en jsdom (y en cualquier layout degenerado): mejor no bloquear nada
    // que bloquear a 0 y esconder el contenido.
    setLockedH(next > 0 ? next : null)
  }, [wide])

  function copyMint() {
    if (!mint || !navigator.clipboard) return
    void navigator.clipboard.writeText(mint).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  const grading: Row[] = []
  if (card.grading_company) grading.push(['Grading company', card.grading_company])
  if (card.grading_id) grading.push(['Grading ID', card.grading_id])
  if (card.the_grade) grading.push(['Grade', card.the_grade])
  if (card.generic_grade) grading.push(['Generic grade', card.generic_grade])
  if (card.year) grading.push(['Year', card.year])
  if (card.authenticated != null) grading.push(['Authenticated', card.authenticated ? 'Yes' : 'No'])

  const vault: Row[] = [['Custodian', 'CollectorCrypt'], ['Status', 'Vaulted']]
  const contract: Row[] = [['Chain', 'Solana'], ['Standard', 'Metaplex NFT']]
  if (mint) contract.push(['Mint', abbreviate(mint)])

  // Remide al cambiar de layout (móvil ⇄ ancho) o de carta: cambian los saltos de línea del
  // título y el número de filas de Grading.
  useLayoutEffect(measure, [measure, wide, mint, grading.length])

  // Las fuentes web cargan después del primer layout y cambian el alto del título.
  useEffect(() => {
    if (!document.fonts?.ready) return
    let alive = true
    void document.fonts.ready.then(() => { if (alive) measure() })
    return () => { alive = false }
  }, [measure])

  // El tope depende de la altura del viewport: al redimensionar hay que recalcularlo.
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(14px,2.5vw,32px)', background: 'rgba(4,6,9,.74)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 980, maxHeight: '92vh', overflowY: 'auto', borderRadius: 24, background: 'linear-gradient(180deg,#0e1118,#0a0c12)', border: `1px solid ${COLORS.border}`, boxShadow: '0 50px 130px -40px #000', padding: '26px clamp(22px,3vw,40px) 38px' }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 17, fontWeight: 700, color: COLORS.text }}>Card details</span>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* body */}
        <div style={{ display: 'flex', gap: 'clamp(22px,3vw,42px)', alignItems: 'flex-start', flexDirection: wide ? 'row' : 'column' }}>
          {/* left — thumbs + big card */}
          <div style={{ flex: '1 1 auto', display: 'flex', gap: 14, justifyContent: 'center', minWidth: 0, alignSelf: wide ? 'flex-start' : 'center', width: wide ? undefined : '100%' }}>
            {gallery.length > 1 && (
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gallery.map((src, i) => (
                  <button key={src + i} onClick={() => setActive(i)}
                    style={{ width: 56, aspectRatio: '0.72', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: 0, background: '#0c1019', border: `1.5px solid ${i === active ? accent : COLORS.border}` }}>
                    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: '0 1 320px', maxWidth: 340, width: '100%' }}>
              {big ? (
                <HoloCard src={big} alt={card.name ?? 'Card'} rarity={card.rarity} accent={accent} radius={16} imgStyle={{ aspectRatio: '0.72', objectFit: 'contain' }} />
              ) : (
                <div style={{ aspectRatio: '0.72', borderRadius: 16, background: '#0c1019', border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>🃏</div>
              )}
            </div>
          </div>

          {/* right — info */}
          {/* Alto bloqueado + flex column: el área de acordeones absorbe el espacio sobrante,
              así el modal no cambia de tamaño y el botón de abajo no se mueve nunca. */}
          <div
            ref={colRef}
            style={{ flex: '1 1 340px', maxWidth: wide ? 380 : undefined, minWidth: 0, width: wide ? undefined : '100%', height: lockedH ?? undefined, display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: COLORS.green, marginBottom: 12 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
              Guaranteed authenticity
            </div>
            <h2 style={{ margin: '0 0 22px', fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,27px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.12 }}>{card.name ?? 'Card'}</h2>

            {/* insured value */}
            <div style={{ borderRadius: 16, padding: '17px 19px', background: 'linear-gradient(135deg,#7c4dff,#9d5cff)', boxShadow: '0 18px 50px -24px rgba(124,77,255,.9)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: 'rgba(255,255,255,.72)' }}>INSURED VALUE</div>
                  <div style={{ fontFamily: FONTS.display, fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', color: '#fff', marginTop: 3 }}>{card.insured_value != null ? formatUsd(card.insured_value) : '—'}</div>
                </div>
                {/* Etiqueta corta a propósito: al lado de un importe de 30px, "View on
                    CollectorCrypt" no cabe en la columna de 380px y parte la caja. */}
                {mint && (
                  <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer"
                    style={{ flex: 'none', whiteSpace: 'nowrap', padding: '10px 15px', borderRadius: 11, border: 0, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13.5, fontWeight: 700, color: '#3a1d8a', background: '#fff', textDecoration: 'none' }}>
                    View card ↗
                  </a>
                )}
              </div>
              {mint && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontFamily: FONTS.mono, fontSize: 11, color: 'rgba(255,255,255,.78)' }}>
                  Token ID: {abbreviate(mint)}
                  <button onClick={copyMint} aria-label="Copy token ID" style={{ background: '#ffffff22', border: 'none', color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>{copied ? 'Copied ✓' : 'Copy'}</button>
                </div>
              )}
            </div>

            {/* accordions — el único bloque que puede crecer, y lo hace hacia dentro */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', marginTop: 10, scrollbarWidth: 'thin', scrollbarColor: `${COLORS.border} transparent` }}>
              <Accordion title="Grading" rows={grading} open={open.grading} contentRef={gradingContent} reduced={reduced}
                onToggle={() => setOpen((o) => ({ ...o, grading: !o.grading }))} />
              <Accordion title="Vault" rows={vault} open={open.vault} contentRef={vaultContent} reduced={reduced}
                onToggle={() => setOpen((o) => ({ ...o, vault: !o.vault }))} />
              <Accordion title="Contract" rows={contract} open={open.contract} contentRef={contractContent} reduced={reduced}
                onToggle={() => setOpen((o) => ({ ...o, contract: !o.contract }))} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
