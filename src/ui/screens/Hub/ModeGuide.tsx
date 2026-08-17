import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'

const KEY = 'ba.lobbyGuideOpen'

interface Mode { id: string; name: string; tag: string; accent: string; desc: string; icon: ReactNode }
const S = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
const MODES: Mode[] = [
  // 2–4 y no "1V1": `PLAYER_COUNTS_BY_MODE` en CreateBattleModal permite 2, 3 o 4. El texto venía
  // de cuando pack era solo un duelo, y la descripción arrastraba el mismo error hablando de "las
  // dos cartas" — con cuatro jugadores hay cuatro.
  { id: 'pack', name: 'Pack Battle', tag: '2–4 PLAYERS · WINNER TAKES ALL', accent: COLORS.green, desc: 'Everyone opens a pack at the same time. The highest pull takes every card on the table.', icon: S('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>') },
  { id: 'royale', name: 'Battle Royale', tag: '2–10 PLAYERS', accent: '#ff6bb5', desc: 'Up to 10 players open packs in rounds. The lowest value drops each round — last one standing takes the pot.', icon: S('<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>') },
  { id: 'gacha', name: 'Gacha', tag: 'PULL → PLAY', accent: '#a98bff', desc: 'Open Collector Crypt packs solo and jump straight into a battle with whatever card you pull.', icon: S('<rect x="3" y="3" width="12" height="17" rx="1.2"/><path d="M3 9h12M3 15h12M7 9v6M11 9v6"/><path d="M5.5 5.5h7M5.5 7h7"/><path d="M15 11h2v3h-2"/><circle cx="19.5" cy="6" r="2"/><path d="M19.5 8v3"/>') },
]

/**
 * Los tres modos explicados, plegable y con memoria.
 *
 * Vive en el Lobby, que es donde aterriza quien entra con sesión. No en Home: allí ya están los
 * tres banners contando lo mismo, y dos explicaciones de los tres modos en la misma sesión es una
 * de más. La clave de almacenamiento (`ba.lobbyGuideOpen`) ya decía dónde iba.
 *
 * PLEGADA NO DESAPARECE: queda una barra de una línea con "Show". Es la diferencia con el aviso de
 * la demo, que es permanente porque hay un vídeo que se querrá repasar; esto es texto, y quien ya
 * lo leyó no necesita releerlo, pero sí poder volver a él.
 *
 * El margen exterior lo pone quien lo coloca, no este componente: el Lobby ya separa sus bloques
 * con `gap`, y un `marginBottom` propio se sumaba al hueco.
 */
export function ModeGuide() {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } })
  const set = (v: boolean) => { setOpen(v); try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ } }

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '12px 18px', borderRadius: 14, background: 'rgba(255,255,255,.022)', border: `1px solid ${COLORS.border}` }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#cdd4dd' }}>How each mode works</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => set(true)} style={pillBtn}>Show</button>
          <Link to="/help" style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', color: COLORS.green, borderColor: '#00ffc455', background: '#00ffc414' }}>Help →</Link>
        </div>
      </div>
    )
  }

  return (
    <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 'clamp(20px,2.4vw,28px)', background: 'linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.008))', border: `1px solid ${COLORS.border}` }}>
      {/* Solo el rótulo y los botones. Se fueron el titular y el párrafo: las tres tarjetas de
          abajo ya explican los modos, y repetirlo arriba en prosa era decir dos veces lo mismo
          antes de que se leyera una. Los botones suben a la esquina, alineados con el rótulo. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <h3 style={{
          margin: 0, flex: '1 1 auto', minWidth: 0,
          fontFamily: FONTS.mono, fontSize: 11, fontWeight: 400, letterSpacing: '.26em',
          color: COLORS.green,
        }}>
          How each mode works
        </h3>
        <div style={{ flex: 'none', display: 'flex', gap: 10, marginLeft: 'auto' }}>
          <Link to="/help" style={{ ...pillBtn, display: 'inline-flex', alignItems: 'center', color: COLORS.green, borderColor: '#00ffc466', background: '#00ffc41a' }}>Open Help guide →</Link>
          <button onClick={() => set(false)} style={pillBtn}>Got it ✓</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
        {MODES.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 18, border: `1px solid ${m.accent}44`, background: `linear-gradient(180deg,${m.accent}12,rgba(255,255,255,.01))` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${m.accent}22`, border: `1px solid ${m.accent}59`, color: m.accent }}>{m.icon}</span>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: COLORS.text }}>{m.name}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.06em', color: m.accent, marginTop: 3 }}>{m.tag}</div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#9aa4b2' }}>{m.desc}</p>
            <Link to={`/help#${m.id}`} style={{ marginTop: 'auto', paddingTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: m.accent }}>Explain more →</Link>
          </div>
        ))}
      </div>
    </section>
  )
}

const pillBtn: React.CSSProperties = { padding: '8px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600, textDecoration: 'none' }
