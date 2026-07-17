import { useRef, useEffect, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import { useIsWide } from '../../useIsWide'

/** #rrggbb → "r,g,b" (falls back to the pink accent's channels on a bad value). */
function rgbChannels(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '255,46,126'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export interface BannerProps {
  kicker: string
  titlePlain: string
  titleAccent?: string
  body: string
  cta: string
  to: string                 // route the CTA links to
  badge?: string
  accent?: string            // default pink
  ctaTextColor?: string      // ink on the accent CTA (contrast)
  // 'side'   → media in a right panel, floating (the hero mockup).
  // 'stacked' → media fills a band ON TOP, copy BELOW (portrait cards).
  layout?: 'side' | 'stacked'
  // Media: a looping muted video with an INDEPENDENT poster image (any image, even unrelated to
  // the video). Poster-only (no video) renders just the image. Both optional.
  poster?: string
  videoWebm?: string
  videoMov?: string          // optional extra source (e.g. Safari/HEVC)
  // 'side' floating-media placement (matches the mockup knobs). Ignored when stacked.
  mediaX?: number
  mediaY?: number
  mediaWidth?: number
  mediaRotate?: number
  mediaHeight?: number       // 'stacked' top-band height (cover-filled)
}

export function Banner({
  kicker, titlePlain, titleAccent, body, cta, to, badge,
  accent = '#ff2e7e', ctaTextColor = '#fff', layout = 'side',
  poster, videoWebm, videoMov,
  mediaX = 30, mediaY = 26, mediaWidth = 640, mediaRotate = -3, mediaHeight = 200,
}: BannerProps) {
  const wide = useIsWide('(min-width: 760px)')
  const videoRef = useRef<HTMLVideoElement>(null)
  const rgb = rgbChannels(accent)
  const stacked = layout === 'stacked'

  // React doesn't reliably reflect the muted attribute to the property, and muted is required
  // for autoplay — set it imperatively (same as AlphaVideo).
  useEffect(() => { if (videoRef.current) videoRef.current.muted = true }, [videoWebm, videoMov])

  // Stacked → the media covers the top band; side → it floats, rotated, oversized.
  const mediaStyle: CSSProperties = stacked
    ? { width: '100%', height: mediaHeight, objectFit: 'cover', display: 'block' }
    : {
        position: 'absolute', top: mediaY, left: mediaX, width: mediaWidth, maxWidth: 'none',
        borderRadius: 12, objectFit: 'cover',
        border: `1px solid rgba(${rgb},.4)`,
        boxShadow: `0 20px 60px rgba(0,0,0,.6), 0 0 40px rgba(${rgb},.18)`,
        transform: `rotate(${mediaRotate}deg)`,
      }

  const media = videoWebm ? (
    <video ref={videoRef} autoPlay loop muted playsInline poster={poster} style={mediaStyle}>
      {videoMov && <source src={videoMov} type="video/quicktime" />}
      <source src={videoWebm} type="video/webm" />
    </video>
  ) : poster ? (
    <img src={poster} alt="" style={mediaStyle} />
  ) : null

  const mediaPanel = (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: `radial-gradient(500px 300px at 80% 20%, rgba(${rgb},.14), transparent), #0a0d13`,
      ...(stacked
        ? { minHeight: mediaHeight, borderBottom: '1px solid rgba(255,255,255,.08)' }
        : { minHeight: wide ? 280 : 190, borderLeft: wide ? '1px solid rgba(255,255,255,.08)' : undefined, borderTop: wide ? undefined : '1px solid rgba(255,255,255,.08)' }),
    }}>
      {media}
      {badge && (
        <span style={{
          position: 'absolute', left: 16, bottom: 14, fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700,
          letterSpacing: '.12em', color: accent, background: 'rgba(6,8,11,.85)', border: `1px solid rgba(${rgb},.4)`,
          borderRadius: 999, padding: '5px 12px', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        }}>{badge}</span>
      )}
    </div>
  )

  const copyPanel = (
    <div style={{ padding: stacked ? '22px 24px 26px' : wide ? '36px 38px' : '26px 22px' }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: accent }}>{kicker}</span>
      <h2 style={{ margin: '10px 0 14px', fontFamily: FONTS.display, fontSize: stacked ? 22 : wide ? 26 : 22, fontWeight: 700, lineHeight: 1.25, color: COLORS.text }}>
        {titlePlain} {titleAccent && <span style={{ color: accent }}>{titleAccent}</span>}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: stacked ? 14 : 15, lineHeight: 1.6, color: '#aab3bf', maxWidth: 520 }}>{body}</p>
      <Link to={to} style={{
        display: 'inline-flex', alignItems: 'center', padding: '12px 22px', borderRadius: 12,
        background: accent, color: ctaTextColor, fontFamily: FONTS.display, fontSize: 14, fontWeight: 700,
      }}>{cta}</Link>
    </div>
  )

  const shell: CSSProperties = { borderRadius: 18, background: '#0c0f15', border: `1px solid ${COLORS.border}`, overflow: 'hidden' }

  if (stacked) {
    return <section style={{ ...shell, display: 'flex', flexDirection: 'column' }}>{mediaPanel}{copyPanel}</section>
  }
  return (
    <section style={{ ...shell, display: 'grid', gridTemplateColumns: wide ? '1.15fr .85fr' : '1fr' }}>
      {copyPanel}{mediaPanel}
    </section>
  )
}
