import { Link } from 'react-router-dom'
import { COLORS, FONTS, GRADIENT } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { HELP_MODES, HELP_FEATURES } from './helpContent'

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
)

export function HelpPage() {
  // The anchor TOC only makes sense in the two-column desktop layout; below this
  // width we drop it and let the article take the full width (single column).
  const wide = useIsWide('(min-width: 860px)')
  return (
    <div style={{ padding: '20px clamp(16px,3vw,44px) 60px', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26, flexWrap: 'wrap' }}>
        <Link to="/home" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: 12, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', fontSize: 14, fontWeight: 600 }}>‹ Back to Home</Link>
        <span style={{ fontFamily: FONTS.display, fontSize: 17, fontWeight: 700 }}>Help & Guides</span>
      </div>

      <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', gap: wide ? 34 : 0, alignItems: 'flex-start' }}>
        {wide && (
          <aside style={{ position: 'sticky', top: 12, flex: 'none', width: 210, display: 'flex', flexDirection: 'column', gap: 2 }} className="hp-toc">
            <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.2em', color: '#5c6675', padding: '0 12px 10px' }}>ON THIS PAGE</div>
            <a href="#modes" style={tocLink}>Game modes</a>
            {HELP_MODES.map((m) => <a key={m.id} href={`#${m.id}`} style={{ ...tocLink, paddingLeft: 24, fontSize: 13 }}>{m.name}</a>)}
            <a href="#features" style={{ ...tocLink, marginTop: 6 }}>Features & fairness</a>
          </aside>
        )}

        <article style={{ flex: 1, minWidth: 0, width: '100%', alignSelf: 'stretch' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, letterSpacing: '.26em', color: COLORS.green, marginBottom: 14 }}>HELP CENTER</div>
          <h1 style={{ margin: '0 0 14px', fontFamily: FONTS.display, fontSize: 'clamp(30px,4.4vw,46px)', fontWeight: 700, lineHeight: 1.02, letterSpacing: '-.03em' }}>How Collector Arena works</h1>
          <p style={{ margin: '0 0 34px', maxWidth: 620, fontSize: 16.5, lineHeight: 1.62, color: '#9aa4b2' }}>Every game uses your graded Collector Crypt NFTs as the playing piece. Card value can give an edge, but skill and luck decide the winner, and settlement is trustless on Solana.</p>

          <h2 id="modes" style={{ ...h2, scrollMarginTop: 90 }}>Game modes</h2>
          <div style={hr} />
          {HELP_MODES.map((m) => (
            <section key={m.id} id={m.id} style={{ scrollMarginTop: 90, marginBottom: 34, padding: wide ? 26 : 18, borderRadius: 20, background: `linear-gradient(180deg,${m.accent}0d,rgba(255,255,255,.008))`, border: `1px solid ${COLORS.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <span style={{ flex: 'none', width: 50, height: 50, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${m.accent}22`, border: `1px solid ${m.accent}59`, color: m.accent }}><Icon d={m.iconPaths} size={24} /></span>
                <div>
                  <h3 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 21, fontWeight: 700 }}>{m.name}</h3>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.08em', color: m.accent, marginTop: 4 }}>{m.tag}</div>
                </div>
              </div>
              <p style={{ margin: '0 0 20px', maxWidth: 640, fontSize: 15, lineHeight: 1.62, color: '#b8c0cb' }}>{m.desc}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                {m.steps.map((s, i) => (
                  <div key={i} style={{ padding: '14px 16px', borderRadius: 13, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}` }}>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: m.accent, marginBottom: 6 }}>STEP {i + 1}</div>
                    <div style={{ fontSize: 13.5, color: '#d4dae2' }}>{s}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <h2 id="features" style={{ ...h2, scrollMarginTop: 90 }}>Features & fairness</h2>
          <div style={hr} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            {HELP_FEATURES.map((f) => (
              <div key={f.title} style={{ padding: 22, borderRadius: 18, background: 'rgba(255,255,255,.022)', border: `1px solid ${COLORS.border}` }}>
                <span style={{ display: 'flex', width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', background: `${f.accent}1a`, border: `1px solid ${f.accent}4d`, color: f.accent, marginBottom: 14 }}><Icon d={f.iconPaths} size={20} /></span>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: '#8b95a3' }}>{f.body}</p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 44, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '24px 26px', borderRadius: 20, background: 'linear-gradient(135deg,rgba(255,46,151,.14),rgba(13,17,22,.5) 48%,rgba(0,255,196,.1))', border: `1px solid ${COLORS.border}` }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4 }}>Ready to play?</div>
              <div style={{ fontSize: 14, color: '#9aa4b2' }}>Pick a mode and jump into a live lobby.</div>
            </div>
            <Link to="/home" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 26px', borderRadius: 13, fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT }}>Back to Home →</Link>
          </div>
        </article>
      </div>
    </div>
  )
}

const h2: React.CSSProperties = { margin: '0 0 8px', fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }
const hr: React.CSSProperties = { height: 1, background: COLORS.border, marginBottom: 30 }
const tocLink: React.CSSProperties = { padding: '9px 12px', borderRadius: 9, fontSize: 13.5, color: '#9aa4b2', textDecoration: 'none' }
