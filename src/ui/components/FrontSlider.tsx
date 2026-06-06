import { useEffect, useRef } from 'react'
import { COLORS } from '../theme'

interface Props {
  label: string
  icon: string
  value: number
  max: number
  onChange: (v: number) => void
  /** Player accent color for the slider fill and value display */
  accentColor: string
  sliderClass: string
}

export function FrontSlider({ label, icon, value, max, onChange, accentColor, sliderClass }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Update the CSS custom property for the filled portion
  useEffect(() => {
    if (!inputRef.current) return
    const pct = max > 0 ? (value / max) * 100 : 0
    inputRef.current.style.setProperty('--slider-pct', `${pct}%`)
    inputRef.current.style.setProperty('--slider-color', accentColor)
  }, [value, max, accentColor])

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
        <span style={{ color: COLORS.text }}>{icon} {label}</span>
        <span style={{ color: accentColor, fontWeight: 800 }}>{value}</span>
      </div>
      <input
        ref={inputRef}
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={sliderClass}
        style={{ '--slider-color': accentColor } as React.CSSProperties}
      />
    </div>
  )
}
