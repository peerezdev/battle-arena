import { useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { MOCK_DROPS, type DropItem } from './hubMockData'
import { useChat } from '../../../hooks/useChat'

// Palette for coloring usernames deterministically
const USER_COLORS = ['#b78cff', '#14F195', '#5ad1ff', '#ff6b6b', '#ffd166', '#f7c59f']
function userColor(user: string): string {
  let hash = 0
  for (let i = 0; i < user.length; i++) hash = (hash * 31 + user.charCodeAt(i)) | 0
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

function formatTs(ts: number): string {
  // El backend emite ts en segundos (epoch); Date espera milisegundos.
  const d = new Date(ts * 1000)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${hh}:${mm}`
}

export function ChatDock({ drops = MOCK_DROPS }: { drops?: DropItem[] }) {
  const { messages, send, canPost } = useChat()
  const [draft, setDraft] = useState('')

  function handleSend() {
    if (!draft.trim()) return
    send(draft)
    setDraft('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSend()
  }

  return (
    <aside
      style={{
        background: '#0c1019',
        borderLeft: `1px solid ${COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      {/* ── LIVE DROPS ── */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10.5,
              letterSpacing: '0.16em',
              color: COLORS.muted,
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
            LIVE DROPS
          </div>
          <span style={{ fontSize: 10, color: COLORS.muted, cursor: 'pointer' }}>view all</span>
        </div>

        {/* Drop items */}
        {drops.map((drop) => (
          <div
            key={drop.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 0',
            }}
          >
            {/* Card image / emoji */}
            <div
              style={{
                width: 28,
                height: 38,
                borderRadius: 6,
                background: `radial-gradient(circle at 40% 30%,${drop.accent}33,#10141c)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {drop.emoji}
            </div>

            {/* Name + set */}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
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
              </div>
              <div style={{ fontSize: 9, color: COLORS.muted }}>{drop.set}</div>
            </div>

            {/* Value */}
            <div
              style={{
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 12,
                color: COLORS.green,
                marginLeft: 'auto',
                flexShrink: 0,
              }}
            >
              {formatUsd(drop.valueUsd)}
            </div>
          </div>
        ))}
      </div>

      {/* ── CHAT HEADING ── */}
      <div
        style={{
          padding: '12px 16px 0',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: COLORS.text,
            padding: '7px 12px',
            borderRadius: '8px 8px 0 0',
            background: '#11161f',
            fontFamily: FONTS.body,
            display: 'inline-block',
          }}
        >
          Chat
        </div>
      </div>

      {/* Online count */}
      <div
        style={{
          padding: '6px 16px',
          fontSize: 10.5,
          color: COLORS.muted,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
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
          }}
        />
        18 online
      </div>

      {/* ── MESSAGES ── */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          padding: '6px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ fontSize: 11, color: COLORS.muted, fontFamily: FONTS.body, marginTop: 8 }}>
            Sé el primero en escribir…
          </div>
        ) : (
          messages.map((msg, idx) => (
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
                    background: 'linear-gradient(135deg,#9945FF,#14F195)',
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
                <span style={{ fontSize: 9, color: '#5d6781', marginLeft: 'auto' }}>
                  {formatTs(msg.ts)}
                </span>
              </div>
              {/* Bubble text */}
              <div
                style={{
                  fontSize: 12,
                  color: '#cdd5e6',
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
          placeholder={canPost ? 'Escribe un mensaje…' : 'Inicia sesión para chatear'}
          value={draft}
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
            background: 'linear-gradient(135deg,#9945FF,#14F195)',
            color: '#06120c',
            cursor: canPost ? 'pointer' : 'not-allowed',
            opacity: canPost ? 1 : 0.5,
            fontSize: 14,
          }}
        >
          ➤
        </button>
      </div>
    </aside>
  )
}
