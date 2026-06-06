import { useState } from 'react'
import { MOCK_CARDS } from '../../data/cards'
import type { Mode } from '../../engine'
import type { Difficulty } from '../../bot/bot'

export interface Setup {
  opponent: 'vs-bot' | 'hotseat'
  cardAId: string
  cardBId: string
  mode: Mode
  edgeEnabled: boolean
  difficulty: Difficulty
}

export function SetupScreen({ onStart, error }: { onStart: (s: Setup) => void; error?: string }) {
  const [s, setS] = useState<Setup>({
    opponent: 'vs-bot', cardAId: MOCK_CARDS[0].id, cardBId: MOCK_CARDS[1].id,
    mode: 'ranked', edgeEnabled: true, difficulty: 'medium',
  })
  const upd = (p: Partial<Setup>) => setS({ ...s, ...p })
  const sel = 'border rounded p-2 w-full mb-3'
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">🃏 TCG Battle Arena — Fase 0</h1>
      {error && <p className="bg-red-100 text-red-700 p-2 rounded mb-3">{error}</p>}
      <label className="block text-sm font-semibold">Rival</label>
      <select className={sel} value={s.opponent} onChange={(e) => upd({ opponent: e.target.value as Setup['opponent'] })}>
        <option value="vs-bot">vs Bot</option>
        <option value="hotseat">Hotseat (2 jugadores)</option>
      </select>
      <label className="block text-sm font-semibold">Carta A</label>
      <select className={sel} value={s.cardAId} onChange={(e) => upd({ cardAId: e.target.value })}>
        {MOCK_CARDS.map((c) => <option key={c.id} value={c.id}>{c.name} (${c.valueUsd} · {c.gradeCompany}{c.grade})</option>)}
      </select>
      <label className="block text-sm font-semibold">Carta B</label>
      <select className={sel} value={s.cardBId} onChange={(e) => upd({ cardBId: e.target.value })}>
        {MOCK_CARDS.map((c) => <option key={c.id} value={c.id}>{c.name} (${c.valueUsd} · {c.gradeCompany}{c.grade})</option>)}
      </select>
      <label className="block text-sm font-semibold">Modo</label>
      <select className={sel} value={s.mode} onChange={(e) => upd({ mode: e.target.value as Mode })}>
        <option value="ranked">Ranked (cap 4x)</option>
        <option value="challenge">Challenge (sin cap)</option>
      </select>
      <label className="block mb-3"><input type="checkbox" checked={s.edgeEnabled} onChange={(e) => upd({ edgeEnabled: e.target.checked })} /> Edge de carta activado</label>
      {s.opponent === 'vs-bot' && (
        <>
          <label className="block text-sm font-semibold">Dificultad bot</label>
          <select className={sel} value={s.difficulty} onChange={(e) => upd({ difficulty: e.target.value as Difficulty })}>
            <option value="easy">Fácil</option><option value="medium">Medio</option><option value="hard">Difícil</option>
          </select>
        </>
      )}
      {s.cardAId === s.cardBId && (
        <p className="text-red-600 text-sm mb-2">Las dos cartas deben ser distintas.</p>
      )}
      <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed" disabled={s.cardAId === s.cardBId} onClick={() => onStart(s)}>Empezar</button>
    </div>
  )
}
