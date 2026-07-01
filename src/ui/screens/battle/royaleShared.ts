import { COLORS } from '../../theme'

export function shortWallet(w: string): string {
  return w.length > 9 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

const TINTS = [
  'linear-gradient(135deg,#ff6bb5,#d4127a)',
  'linear-gradient(135deg,#4ea8ff,#6a5bff)',
  'linear-gradient(135deg,#f5c542,#e8732c)',
  'linear-gradient(135deg,#00ffc4,#1aa0d8)',
  'linear-gradient(135deg,#ff6e8a,#d23a5e)',
]

export function tintFor(w: string): string {
  const h = Math.abs([...w].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0))
  return TINTS[h % TINTS.length]
}

export function medalColor(rank: number): string {
  return rank === 1 ? '#f5c542' : rank === 2 ? '#c8d0da' : rank === 3 ? '#e8964e' : COLORS.muted
}
