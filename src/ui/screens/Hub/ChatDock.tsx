import { COLORS, FONTS, formatUsd } from '../../theme'
import { MOCK_DROPS, MOCK_CHAT, type DropItem, type ChatMsg } from './hubMockData'

export function ChatDock({ drops = MOCK_DROPS, messages = MOCK_CHAT }: { drops?: DropItem[]; messages?: ChatMsg[] }) {
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

      {/* ── CHAT TABS ── */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '12px 16px 0',
        }}
      >
        {(['Chat', 'Friends'] as const).map((tab) => {
          const isActive = tab === 'Chat'
          return (
            <button
              key={tab}
              style={{
                fontSize: 11,
                color: isActive ? COLORS.text : COLORS.muted,
                padding: '7px 12px',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                background: isActive ? '#11161f' : 'transparent',
                border: 'none',
                fontFamily: FONTS.body,
              }}
            >
              {tab}
            </button>
          )
        })}
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
        {messages.map((msg: ChatMsg) => (
          <div key={msg.id}>
            {/* Row: avatar + name + mod badge + timestamp */}
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
                  color: msg.color,
                  fontFamily: FONTS.body,
                }}
              >
                {msg.user}
              </span>
              {/* MOD badge */}
              {msg.mod && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    background: '#e8b341',
                    color: '#1a1206',
                    borderRadius: 3,
                    padding: '1px 4px',
                  }}
                >
                  MOD
                </span>
              )}
              {/* Timestamp */}
              <span style={{ fontSize: 9, color: '#5d6781', marginLeft: 'auto' }}>
                {msg.ts}
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
        ))}
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
          disabled
          placeholder="Chat coming soon…"
          title="Coming soon"
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
            cursor: 'not-allowed',
            opacity: 0.6,
          }}
        />
        <button
          disabled
          style={{
            width: 38,
            borderRadius: 10,
            border: 'none',
            background: 'linear-gradient(135deg,#9945FF,#14F195)',
            color: '#06120c',
            cursor: 'not-allowed',
            opacity: 0.5,
            fontSize: 14,
          }}
        >
          ➤
        </button>
      </div>
    </aside>
  )
}
