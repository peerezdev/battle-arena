interface Props {
  available: number
  unassigned: number
  winsA: number
  winsB: number
}

export function EnergyHeader({ available, unassigned, winsA, winsB }: Props) {
  const box = 'flex-1 text-center bg-slate-100 rounded p-2'
  return (
    <div className="flex gap-3 mb-4">
      <div className={box}><div className="text-xs uppercase opacity-70">Disponible</div><div className="text-2xl font-bold">{available}</div></div>
      <div className={box}><div className="text-xs uppercase opacity-70">Sin asignar</div><div className="text-2xl font-bold">{unassigned}</div></div>
      <div className={box}><div className="text-xs uppercase opacity-70">Rondas</div><div className="text-2xl font-bold">{winsA} – {winsB}</div></div>
    </div>
  )
}
