import { useRef, useEffect, type CSSProperties } from 'react'

// Transparent-background looping video. Serves two alpha-capable formats and lets the
// browser pick: HEVC+alpha (.mov) for Safari, VP9+alpha (.webm) for the rest.
type Props = {
  webm: string
  mov?: string
  loop?: boolean
  muted?: boolean
  style?: CSSProperties
  className?: string
}

export function AlphaVideo({ webm, mov, loop = true, muted = true, style, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    // React doesn't reliably set the muted *property* from the attribute, and
    // muted is required for autoplay to be allowed by browsers.
    if (ref.current) ref.current.muted = muted
  }, [muted])

  return (
    <video
      ref={ref}
      autoPlay
      loop={loop}
      muted={muted}
      playsInline
      className={className}
      style={{ display: 'block', ...style }}
    >
      {/* Safari / iOS / macOS: HEVC with alpha */}
      {mov && <source src={mov} type="video/quicktime" />}
      {/* Chrome / Firefox / Edge / Android: VP9 with alpha */}
      <source src={webm} type="video/webm" />
    </video>
  )
}
