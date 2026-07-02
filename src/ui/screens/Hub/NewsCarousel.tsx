import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { LOBBY_NEWS } from './lobbyNews'

const INTERVAL_MS = 8000

export function NewsCarousel() {
  const reduced = useReducedMotion()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const n = LOBBY_NEWS.length
  const next = () => setI((x) => (x + 1) % n)
  const prev = () => setI((x) => (x - 1 + n) % n)

  useEffect(() => {
    if (reduced || paused) return
    const t = setInterval(next, INTERVAL_MS)
    return () => clearInterval(t)
  }, [reduced, paused])

  const cur = LOBBY_NEWS[i]

  return (
    <section onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.violet }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.violet, boxShadow: `0 0 8px ${COLORS.violet}` }} />WHAT'S NEW
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#5c6675' }}>{i + 1}/{n}</span>
          <button aria-label="Previous" onClick={prev} style={arrowBtn}>‹</button>
          <button aria-label="Next" onClick={next} style={arrowBtn}>›</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 380px', minWidth: 280, position: 'relative', overflow: 'hidden', borderRadius: 20, padding: 'clamp(20px,2.4vw,28px)', background: `linear-gradient(120deg,${cur.accent}22,rgba(13,17,22,.55) 55%,rgba(255,255,255,.02))`, border: `1px solid ${COLORS.border}` }}>
          <span style={{ display: 'inline-flex', padding: '5px 12px', borderRadius: 999, background: `${cur.accent}22`, border: `1px solid ${cur.accent}66`, fontFamily: FONTS.mono, fontSize: 11, color: cur.accent, marginBottom: 14 }}>{cur.tag}</span>
          <h2 style={{ margin: '0 0 9px', fontFamily: FONTS.display, fontSize: 'clamp(22px,2.6vw,30px)', fontWeight: 700, letterSpacing: '-.025em' }}>{cur.title}</h2>
          <p style={{ margin: '0 0 18px', maxWidth: 460, fontSize: 14.5, lineHeight: 1.55, color: '#b8c0cb' }}>{cur.sub}</p>
          <Link to={cur.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 12, fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, color: '#06170f', background: cur.accent }}>{cur.cta} →</Link>
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LOBBY_NEWS.map((nw, idx) => (
            <button key={nw.id} onClick={() => setI(idx)} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px 13px', borderRadius: 14, cursor: 'pointer', border: `1px solid ${idx === i ? `${nw.accent}66` : COLORS.border}`, background: idx === i ? `${nw.accent}1a` : 'rgba(255,255,255,.028)', flex: 1 }}>
              <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: nw.accent, boxShadow: `0 0 8px ${nw.accent}` }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.14em', color: nw.accent, marginBottom: 3 }}>{nw.tag}</span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e7ecf2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nw.title}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

const arrowBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', cursor: 'pointer', fontSize: 16, lineHeight: 1 }
