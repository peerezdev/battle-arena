import type { Allocation, FrontKey, FrontWinner } from '../../engine'

interface Props {
  allocA: Allocation
  allocB: Allocation
  frontWinners: Record<FrontKey, FrontWinner>
  roundWinner: FrontWinner
  nameA: string
  nameB: string
  onContinue: () => void
}

const FRONTS: { key: FrontKey; label: string; icon: string }[] = [
  { key: 'apertura', label: 'Apertura', icon: '⚔️' },
  { key: 'choque', label: 'Choque', icon: '💥' },
  { key: 'remate', label: 'Remate', icon: '🎯' },
]

export function RevealScreen({ allocA, allocB, frontWinners, roundWinner, nameA, nameB, onContinue }: Props) {
  const tag = (w: FrontWinner) => w === 'a' ? `🟢 ${nameA}` : w === 'b' ? `🔴 ${nameB}` : '⚪ Disputado'
  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-lg font-bold mb-4">Reveal</h2>
      {FRONTS.map((f) => (
        <div key={f.key} className="flex justify-between border-b py-2">
          <span>{f.icon} {f.label}</span>
          <span>{allocA[f.key]} vs {allocB[f.key]}</span>
          <span className="font-semibold">{tag(frontWinners[f.key])}</span>
        </div>
      ))}
      <p className="text-center text-xl font-bold my-4">
        {roundWinner === 'disputed' ? 'Ronda nula (rejugar)' : `Gana la ronda: ${tag(roundWinner)}`}
      </p>
      <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold" onClick={onContinue}>Continuar</button>
    </div>
  )
}
