import { useState, useRef, useReducer, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, GRADIENT, formatUsd, rarityGlow } from '../../theme'
import { useChat } from '../../../hooks/useChat'
import { useDrops } from '../../drops/useDrops'
import { useProfile } from '../../../hooks/useProfile'
import { useReducedMotion } from '../../useReducedMotion'
import { showToast } from '../../toastBus'
import { UsernameModal } from '../../components/UsernameModal'
import type { LiveDrop } from '../../drops/dropsStore'

// Opener label for a drop row: username if known, else a short wallet.
function dropOpener(drop: LiveDrop): string {
  if (drop.username) return drop.username
  const w = drop.wallet ?? ''
  return w.length > 8 ? `${w.slice(0, 4)}…${w.slice(-4)}` : (w || 'anon')
}

// Palette for coloring usernames deterministically
const USER_COLORS = ['#b78cff', '#00ffc4', '#5ad1ff', '#ff6b6b', '#ffd166', '#f7c59f']
function userColor(user: string | null | undefined): string {
  const s = user || 'anon'
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

// Normalize a timestamp to milliseconds. Backend emits epoch SECONDS; local/legacy
// drops are stored in ms. Anything below ~1e12 is seconds (pre-2001 in ms terms).
function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

function formatTs(ts: number): string {
  const d = new Date(toMs(ts))
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${hh}:${mm}`
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - toMs(ts)) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function ChatDock({
  collapsed = false,
  onToggle,
  chatOnly = false,
  onClose,
}: {
  collapsed?: boolean
  onToggle?: () => void
  /** Chat-only mode (mobile full-screen): hides the Recent Drops section. */
  chatOnly?: boolean
  /** When provided, shows a close (✕) button in the chat header (mobile drawer). */
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const drops = useDrops()
  const { messages, send, canPost, online } = useChat()
  const { username } = useProfile()
  const reducedMotion = useReducedMotion()
  const [draft, setDraft] = useState('')
  const [nameModal, setNameModal] = useState(false)
  const promptedName = useRef(false)

  // First time the user focuses the chat with no username set, nudge them to pick one.
  function onChatFocus() {
    if (canPost && !username && !promptedName.current) {
      promptedName.current = true
      showToast('Set a username so others recognize you in chat', 'info', {
        label: 'Choose username', onClick: () => setNameModal(true),
      })
    }
  }

  const [, forceTick] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    const id = setInterval(forceTick, 60_000)
    return () => clearInterval(id)
  }, [])

  // ── Resizable divider state ──
  const [dropsHeight, setDropsHeight] = useState(
    () => Math.max(120, Math.min(Math.round(window.innerHeight / 2), window.innerHeight - 260)),
  )
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  function handleResizerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startHeight: dropsHeight }
  }

  function handleResizerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const newHeight = dragRef.current.startHeight + (e.clientY - dragRef.current.startY)
    const clamped = Math.max(120, Math.min(newHeight, window.innerHeight - 260))
    setDropsHeight(clamped)
  }

  function handleResizerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }

  function handleSend() {
    if (!draft.trim()) return
    send(draft)
    setDraft('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSend()
  }

  if (collapsed) {
    return (
      <aside
        style={{
          background: '#0c1019',
          borderLeft: `1px solid ${COLORS.border}`,
          height: '100%',
          width: 36,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 14,
          gap: 10,
        }}
      >
        <button
          onClick={() => onToggle?.()}
          title="Expand chat"
          style={{
            background: 'transparent',
            border: `1px solid ${COLORS.border}`,
            color: COLORS.muted,
            borderRadius: 8,
            width: 26,
            height: 26,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ‹
        </button>
        <div
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: '0.16em',
            color: COLORS.muted,
            marginTop: 8,
          }}
        >
          CHAT
        </div>
      </aside>
    )
  }

  return (
    <aside
      style={{
        background: '#0c1019',
        borderLeft: chatOnly ? 'none' : `1px solid ${COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Recent Drops — hidden for now, kept for future reuse. Re-enable by changing
          `false &&` back to `!chatOnly &&`. */}
      {false && !chatOnly && (<>
      {/* ── RECENT DROPS ── */}
      <div
        style={{
          height: dropsHeight,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {/* Header — fixed (stays visible while the list scrolls) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px 10px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: COLORS.text,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
            }}
          >
            {/* Pulse dot */}
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: COLORS.green,
                boxShadow: `0 0 8px ${COLORS.green}`,
                display: 'inline-block',
              }}
            />
            RECENT DROPS
          </div>
          {onToggle && (
            <button
              onClick={onToggle}
              title="Collapse panel"
              style={{
                background: 'transparent',
                border: `1px solid ${COLORS.border}`,
                color: COLORS.muted,
                cursor: 'pointer',
                borderRadius: 7,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ›
            </button>
          )}
        </div>

        {/* Drop items — scrolls (header above stays fixed) */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 14px' }}>
        {drops.length === 0 ? (
          <div style={{ fontSize: 11, color: COLORS.muted }}>
            No drops yet — open a pack to see it here.
          </div>
        ) : (
          drops.map((drop) => {
            const glow = rarityGlow(drop.rarity)             // null for common → no box
            const accent = glow ?? COLORS.muted              // dot / image tint for common
            const isMine = !!username && !!drop.username && drop.username === username
            const isEpic = (drop.rarity ?? '').toLowerCase() === 'epic'
            return (
              <div
                key={drop.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  margin: '3px 0',
                  borderRadius: 12,
                  border: glow ? `1px solid ${glow}55` : '1px solid transparent',
                  background: glow ? `${glow}0d` : 'transparent',
                  boxShadow: glow ? `0 0 14px -6px ${glow}` : 'none',
                  animation: reducedMotion ? undefined : 'ba-dropin .32s ease-out both',
                }}
              >
                {/* Rarity-glow dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: accent,
                    boxShadow: `0 0 8px ${accent}`,
                    flexShrink: 0,
                  }}
                />

                {/* Card image / emoji */}
                <div
                  style={{
                    width: 28,
                    height: 38,
                    borderRadius: 6,
                    background: `radial-gradient(circle at 40% 30%,${accent}33,#10141c)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  {drop.image ? (
                    <img
                      src={drop.image}
                      alt={drop.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }}
                    />
                  ) : (
                    '🃏'
                  )}
                </div>

                {/* Name + username + rarity */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: COLORS.text,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {drop.name}
                    </span>
                    {isEpic && (
                      <span
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 8,
                          fontWeight: 800,
                          letterSpacing: '0.06em',
                          color: '#1a1305',
                          background: 'linear-gradient(135deg,#ffe28a,#f5c542)',
                          borderRadius: 5,
                          padding: '1.5px 5px',
                          flexShrink: 0,
                        }}
                      >
                        BIG PULL
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: isMine ? COLORS.green : userColor(drop.username ?? drop.wallet),
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {isMine ? 'you' : dropOpener(drop)}
                  </div>
                  <div style={{ fontSize: 9, color: COLORS.muted }}>{drop.rarity ?? ''}</div>
                </div>

                {/* Value + time */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    flexShrink: 0,
                    marginLeft: 'auto',
                  }}
                >
                  <div
                    style={{
                      fontFamily: FONTS.display,
                      fontWeight: 800,
                      fontSize: 12,
                      color: isEpic ? '#f5c542' : COLORS.green,
                    }}
                  >
                    {drop.valueUsd != null ? formatUsd(drop.valueUsd) : ''}
                  </div>
                  <div style={{ fontSize: 9, color: COLORS.muted }}>
                    {ago(drop.ts)}
                  </div>
                </div>
              </div>
            )
          })
        )}
        </div>
      </div>

      {/* ── RESIZER HANDLE ── */}
      <div
        onPointerDown={handleResizerPointerDown}
        onPointerMove={handleResizerPointerMove}
        onPointerUp={handleResizerPointerUp}
        style={{
          height: 6,
          cursor: 'row-resize',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0c1019',
          borderTop: `1px solid ${COLORS.border}`,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        {/* Grip dots */}
        <div
          style={{
            width: 24,
            height: 3,
            borderRadius: 2,
            background: COLORS.border,
          }}
        />
      </div>
      </>)}

      {/* ── CHAT REGION (flex: 1, scrolls internally) ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* CHAT heading — matches LIVE DROPS style */}
        <div
          style={{
            padding: '10px 16px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: COLORS.green,
              boxShadow: `0 0 8px ${COLORS.green}`,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: COLORS.text,
            }}
          >
            CHAT
          </span>
          <span
            style={{
              fontSize: 10,
              color: COLORS.muted,
              marginLeft: 4,
            }}
          >
            {online} online
          </span>
          {(onToggle || onClose) && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {onToggle && (
                <button
                  onClick={onToggle}
                  title="Collapse panel"
                  style={{
                    background: 'transparent', border: `1px solid ${COLORS.border}`,
                    color: COLORS.muted, borderRadius: 8, width: 26, height: 26, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1,
                  }}
                >
                  ›
                </button>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  title="Close chat"
                  style={{
                    background: 'transparent', border: `1px solid ${COLORS.border}`,
                    color: COLORS.muted, borderRadius: 8, width: 26, height: 26, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          )}
        </div>

        {/* ── MESSAGES ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 11,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ fontSize: 11, color: COLORS.muted, fontFamily: FONTS.body, marginTop: 8 }}>
              Be the first to write…
            </div>
          ) : (
            messages.map((msg, idx) => msg.kind === 'system' && (msg.event === 'created' || msg.event === 'hit' || msg.event === 'winner') ? (
              /* Structured system event — same inline look for all three:
                 icon/tag + "{who} {text}" + gold value (+ optional button).
                 created: "{creator} created a Pack Battle $50" [Join]
                 hit:     "[TCG PRIME] {who} pulled {card} $320"  (hits are always gacha pulls;
                          the chip shows the machine it came from, or "GACHA" if unknown)
                 winner:  "🏆 {who} won a Pack Battle $1.2k" [View] */
              <div key={`${msg.ts}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 2px' }}>
                {msg.event === 'created' ? (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill={COLORS.green} style={{ flexShrink: 0 }} aria-hidden="true">
                    <circle cx="8" cy="5" r="3" />
                    <path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6z" />
                  </svg>
                ) : msg.event === 'winner' ? (
                  <span style={{ flexShrink: 0, fontSize: 12, lineHeight: 1 }} aria-hidden="true">🏆</span>
                ) : (
                  /* hit — a gacha pull; the chip names the machine it came from */
                  <span style={{ flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '1px 7px', borderRadius: 6, background: 'rgba(169,139,255,.14)', border: '1px solid rgba(169,139,255,.4)', fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: '#a98bff' }}>
                    {(msg.machine ?? 'GACHA').toUpperCase()}
                  </span>
                )}
                <span style={{ flex: 1, fontSize: 12, fontFamily: FONTS.body, lineHeight: 1.35 }}>
                  <span style={{ color: userColor(msg.user), fontWeight: 700 }}>{msg.user}</span>
                  <span style={{ color: COLORS.muted }}> {msg.text} </span>
                  {msg.amountUsd != null && (
                    <span style={{ color: '#f5c542', fontWeight: 800 }}>{formatUsd(msg.amountUsd)}</span>
                  )}
                  {(msg.event === 'hit' || msg.event === 'winner') && msg.mult != null && msg.mult > 0 && (
                    <span style={{ color: COLORS.muted, fontWeight: 700 }}> (x{msg.mult % 1 === 0 ? msg.mult : msg.mult.toFixed(1)})</span>
                  )}
                </span>
                {msg.action && (
                  <button onClick={() => navigate(`/play/battle/${msg.action!.battleId}`)} style={{
                    flexShrink: 0, background: 'transparent', border: `1px solid ${COLORS.green}`, borderRadius: 7,
                    padding: '3px 10px', color: COLORS.green, fontFamily: FONTS.display, fontWeight: 800,
                    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>{msg.action.label}</button>
                )}
              </div>
            ) : msg.kind === 'system' ? (
              /* System announcement: big hit / winner */
              <div key={`${msg.ts}-${idx}`} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(0,255,196,0.06)', border: `1px solid ${COLORS.border}`,
                borderLeft: `3px solid ${COLORS.green}`, borderRadius: 8, padding: '7px 10px',
              }}>
                <span style={{ flex: 1, fontSize: 12, color: COLORS.text, fontFamily: FONTS.body, lineHeight: 1.3 }}>
                  {msg.text}
                </span>
                {msg.action && (
                  <button onClick={() => navigate(`/play/battle/${msg.action!.battleId}`)} style={{
                    flexShrink: 0, background: COLORS.green, border: 'none', borderRadius: 7,
                    padding: '5px 11px', color: '#06120c', fontFamily: FONTS.display, fontWeight: 800,
                    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>{msg.action.label}</button>
                )}
              </div>
            ) : (
              <div key={`${msg.ts}-${idx}`}>
                {/* Row: avatar + name + timestamp */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    marginBottom: 2,
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: 21,
                      height: 21,
                      borderRadius: '50%',
                      background: GRADIENT,
                      flexShrink: 0,
                    }}
                  />
                  {/* Username */}
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 11.5,
                      color: userColor(msg.user),
                      fontFamily: FONTS.body,
                    }}
                  >
                    {msg.user}
                  </span>
                  {/* Timestamp */}
                  <span style={{ fontSize: 9, color: COLORS.muted, marginLeft: 'auto' }}>
                    {formatTs(msg.ts)}
                  </span>
                </div>
                {/* Bubble text */}
                <div
                  style={{
                    fontSize: 12,
                    color: COLORS.text,
                    paddingLeft: 28,
                    lineHeight: 1.35,
                    fontFamily: FONTS.body,
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── CHAT INPUT ── */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${COLORS.border}`,
            display: 'flex',
            gap: 8,
          }}
        >
          <input
            disabled={!canPost}
            placeholder={canPost ? 'Type a message…' : 'Log in to chat'}
            value={draft}
            onFocus={onChatFocus}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: '#0a0e16',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              padding: '10px 12px',
              color: COLORS.text,
              fontSize: 12,
              outline: 'none',
              fontFamily: FONTS.body,
              cursor: canPost ? 'text' : 'not-allowed',
              opacity: canPost ? 1 : 0.6,
            }}
          />
          <button
            disabled={!canPost}
            onClick={handleSend}
            style={{
              width: 38,
              borderRadius: 10,
              border: 'none',
              background: GRADIENT,
              color: '#06120c',
              cursor: canPost ? 'pointer' : 'not-allowed',
              opacity: canPost ? 1 : 0.5,
              fontSize: 14,
            }}
          >
            ➤
          </button>
        </div>
      </div>
      {nameModal && <UsernameModal onClose={() => setNameModal(false)} />}
    </aside>
  )
}
