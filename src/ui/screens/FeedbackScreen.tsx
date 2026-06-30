import { useState } from 'react'
import { exportJson } from '../../instrumentation/playtest'
import { COLORS } from '../theme'

export function FeedbackScreen({ onSubmit, onPlayAgain }: { onSubmit: (rating: number, comment: string) => void; onPlayAgain: () => void }) {
  const [rating, setRating] = useState(3)
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)

  const download = () => {
    if (!done) {
      onSubmit(rating, comment)
      setDone(true)
    }
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'playtest.json'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      style={{
        minHeight: '100%',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
      }}
    >
      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '12px',
          padding: '28px 24px',
          maxWidth: '380px',
          width: '100%',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '20px', color: COLORS.text }}>
          Was it fun?
        </div>

        {/* Star rating */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '20px' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: rating >= n ? '#f59e0b' : COLORS.border,
                border: 'none',
                color: rating >= n ? '#0a0e1a' : COLORS.muted,
                fontWeight: 800,
                fontSize: '16px',
                cursor: 'pointer',
                boxShadow: rating >= n ? '0 0 8px #f59e0b66' : 'none',
                transition: 'background 0.15s, box-shadow 0.15s',
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Comment */}
        <textarea
          style={{
            background: COLORS.bg,
            color: COLORS.text,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '6px',
            width: '100%',
            padding: '10px',
            fontSize: '13px',
            marginBottom: '16px',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          rows={3}
          placeholder="Comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        {!done ? (
          <button
            onClick={() => { onSubmit(rating, comment); setDone(true) }}
            style={{
              width: '100%',
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '6px',
              padding: '13px',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 0 12px #00ffc455',
              marginBottom: '12px',
            }}
          >
            Submit
          </button>
        ) : (
          <div
            style={{
              color: COLORS.green,
              fontSize: '14px',
              marginBottom: '12px',
              fontWeight: 600,
            }}
          >
            ✓ Thanks! Recorded.
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={download}
            style={{
              flex: 1,
              background: COLORS.border,
              color: COLORS.text,
              border: 'none',
              borderRadius: '6px',
              padding: '11px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Export JSON
          </button>
          <button
            onClick={onPlayAgain}
            style={{
              flex: 1,
              background: COLORS.border,
              color: COLORS.text,
              border: 'none',
              borderRadius: '6px',
              padding: '11px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Play again
          </button>
        </div>
      </div>
    </div>
  )
}
