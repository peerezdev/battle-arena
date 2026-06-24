import { useEffect, useState } from 'react'
import { COLORS, FONTS } from './theme'

export type ToastKind = 'error' | 'info' | 'success'
interface ToastItem { id: number; msg: string; kind: ToastKind }

let listeners: Array<(t: ToastItem) => void> = []
let nextId = 1

/** Fire a transient toast from anywhere (no provider needed). */
export function showToast(msg: string, kind: ToastKind = 'error') {
  const t = { id: nextId++, msg, kind }
  listeners.forEach((l) => l(t))
}

const ACCENT: Record<ToastKind, string> = { error: COLORS.red, info: COLORS.muted, success: COLORS.green }

/** Mount once near the app root. Renders stacked, auto-dismissing toasts. */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  useEffect(() => {
    const l = (t: ToastItem) => {
      setToasts((ts) => [...ts, t])
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 5000)
    }
    listeners.push(l)
    return () => { listeners = listeners.filter((x) => x !== l) }
  }, [])

  return (
    <div style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: '#0c1019', border: `1px solid ${ACCENT[t.kind]}`, color: COLORS.text,
          borderRadius: 10, padding: '10px 16px', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600,
          maxWidth: 'min(92vw, 460px)', boxShadow: '0 8px 28px #000a', textAlign: 'center',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}
