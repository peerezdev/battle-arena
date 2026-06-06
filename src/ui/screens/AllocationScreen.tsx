import { useState } from 'react'
import { FrontSlider } from '../components/FrontSlider'
import { EnergyHeader } from '../components/EnergyHeader'
import type { Allocation } from '../../engine'

interface Props {
  available: number
  winsA: number
  winsB: number
  round: number
  playerLabel: string
  onCommit: (a: Allocation) => void
}

export function AllocationScreen({ available, winsA, winsB, round, playerLabel, onCommit }: Props) {
  const [a, setA] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const total = a.apertura + a.choque + a.remate
  const remaining = available - total
  const maxFor = (k: keyof Allocation) => a[k] + remaining
  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-lg font-bold mb-1">Ronda {round + 1} · {playerLabel}</h2>
      <EnergyHeader available={available} unassigned={remaining} winsA={winsA} winsB={winsB} />
      <FrontSlider label="Apertura" icon="⚔️" value={a.apertura} max={maxFor('apertura')} onChange={(v) => setA({ ...a, apertura: v })} />
      <FrontSlider label="Choque" icon="💥" value={a.choque} max={maxFor('choque')} onChange={(v) => setA({ ...a, choque: v })} />
      <FrontSlider label="Remate" icon="🎯" value={a.remate} max={maxFor('remate')} onChange={(v) => setA({ ...a, remate: v })} />
      <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold" onClick={() => onCommit(a)}>🔒 Commit</button>
    </div>
  )
}
