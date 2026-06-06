export function ResultScreen({ winnerLabel, onFeedback }: { winnerLabel: string; onFeedback: () => void }) {
  return (
    <div className="max-w-md mx-auto p-6 text-center min-h-[60vh] flex flex-col justify-center">
      <h1 className="text-3xl font-bold mb-4">🏆 {winnerLabel}</h1>
      <button className="bg-blue-600 text-white rounded p-3 font-semibold" onClick={onFeedback}>Valorar la partida</button>
    </div>
  )
}
