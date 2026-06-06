interface Props {
  label: string
  icon: string
  value: number
  max: number
  onChange: (v: number) => void
}

export function FrontSlider({ label, icon, value, max, onChange }: Props) {
  return (
    <div className="mb-4">
      <div className="flex justify-between font-semibold">
        <span>{icon} {label}</span>
        <span>{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}
