export function PassDeviceScreen({ nextPlayer, onReady }: { nextPlayer: string; onReady: () => void }) {
  return (
    <div className="max-w-md mx-auto p-6 text-center min-h-[60vh] flex flex-col justify-center">
      <h2 className="text-xl font-bold mb-4">📲 Pasa el dispositivo a {nextPlayer}</h2>
      <p className="opacity-70 mb-6">Que el otro jugador no vea la pantalla anterior.</p>
      <button className="bg-blue-600 text-white rounded p-3 font-semibold" onClick={onReady}>Listo</button>
    </div>
  )
}
