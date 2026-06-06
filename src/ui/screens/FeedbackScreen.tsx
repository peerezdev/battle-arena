import { useState } from 'react'
import { exportJson } from '../../instrumentation/playtest'

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
    <div className="max-w-md mx-auto p-6 text-center">
      <h2 className="text-xl font-bold mb-4">¿Fue divertida?</h2>
      <div className="flex justify-center gap-2 mb-4">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`w-10 h-10 rounded-full ${rating >= n ? 'bg-yellow-400' : 'bg-slate-200'}`} onClick={() => setRating(n)}>{n}</button>
        ))}
      </div>
      <textarea className="border rounded w-full p-2 mb-3" placeholder="Comentario (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {!done ? (
        <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold mb-2" onClick={() => { onSubmit(rating, comment); setDone(true) }}>Enviar</button>
      ) : (
        <p className="text-green-700 mb-2">¡Gracias! Registrado.</p>
      )}
      <div className="flex gap-2">
        <button className="flex-1 bg-slate-200 rounded p-2" onClick={download}>Exportar JSON</button>
        <button className="flex-1 bg-slate-200 rounded p-2" onClick={onPlayAgain}>Jugar otra</button>
      </div>
    </div>
  )
}
