// src/ui/components/VsIntro.tsx
// VS intro splash: player slabs slide in from opposite sides,
// "clash" in the center with a flash, then auto-dismiss after ~1.5s.
// Includes a skip button and tap-anywhere dismiss.
// Reduced-motion: shows a static VS frame briefly (400ms), then dismisses.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Card } from '../../engine'
import { CardSlab } from './CardSlab'
import { COLORS, FONTS } from '../theme'

interface Props {
  cardA: Card
  cardB: Card
  reducedMotion: boolean
  onDone: () => void
}

const AUTO_DISMISS_MS = 1500
const REDUCED_DISMISS_MS = 400

export function VsIntro({ cardA, cardB, reducedMotion, onDone }: Props) {
  const [visible, setVisible] = useState(true)
  const [flash, setFlash] = useState(false)

  function dismiss() {
    setVisible(false)
    // Give AnimatePresence exit a tiny window, then fire onDone
    setTimeout(onDone, reducedMotion ? 0 : 300)
  }

  useEffect(() => {
    // Flash appears at ~600ms for full animation; instant for reduced.
    const flashTimer = reducedMotion ? null : setTimeout(() => setFlash(true), 600)
    const dismissTimer = setTimeout(dismiss, reducedMotion ? REDUCED_DISMISS_MS : AUTO_DISMISS_MS)
    return () => {
      if (flashTimer) clearTimeout(flashTimer)
      clearTimeout(dismissTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="vs-intro"
          initial={{ opacity: reducedMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.25 }}
          onClick={dismiss}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#0a0e1aee',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: '24px 16px',
          }}
        >
          {/* Flash overlay */}
          <AnimatePresence>
            {flash && (
              <motion.div
                key="flash"
                initial={{ opacity: 0.85 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'white',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
            )}
          </AnimatePresence>

          {/* Slab row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0',
              width: '100%',
              maxWidth: '380px',
              position: 'relative',
              zIndex: 2,
            }}
          >
            {/* Player A slab slides in from left */}
            <motion.div
              style={{ flex: 1 }}
              initial={reducedMotion ? false : { x: -80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 22, delay: 0.05 }}
            >
              <CardSlab
                name={cardA.name}
                gradeCompany={cardA.gradeCompany}
                grade={cardA.grade}
                cert={cardA.id}
                accentColor={COLORS.green}
                variant="compact"
                sheen={!reducedMotion}
              />
            </motion.div>

            {/* VS badge */}
            <motion.div
              initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 18, delay: 0.35 }}
              style={{
                fontFamily: FONTS.orbitron,
                fontWeight: 900,
                fontSize: '26px',
                color: COLORS.text,
                textShadow: '0 0 16px #ffffff88',
                padding: '0 12px',
                flexShrink: 0,
                letterSpacing: '.05em',
              }}
            >
              VS
            </motion.div>

            {/* Player B slab slides in from right */}
            <motion.div
              style={{ flex: 1 }}
              initial={reducedMotion ? false : { x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 22, delay: 0.05 }}
            >
              <CardSlab
                name={cardB.name}
                gradeCompany={cardB.gradeCompany}
                grade={cardB.grade}
                cert={cardB.id}
                accentColor={COLORS.red}
                variant="compact"
                sheen={!reducedMotion}
              />
            </motion.div>
          </div>

          {/* Skip hint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.55 }}
            transition={{ delay: reducedMotion ? 0 : 0.6, duration: 0.3 }}
            style={{
              marginTop: '32px',
              fontSize: '12px',
              fontFamily: FONTS.mono,
              color: COLORS.muted,
              letterSpacing: '.05em',
              zIndex: 2,
              position: 'relative',
            }}
          >
            Toca para continuar
          </motion.div>

          {/* Explicit skip button (also accessible via tap-anywhere above) */}
          <motion.button
            onClick={(e) => { e.stopPropagation(); dismiss() }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ delay: reducedMotion ? 0 : 0.5, duration: 0.3 }}
            style={{
              position: 'absolute',
              top: 'max(12px, env(safe-area-inset-top))',
              right: 'max(12px, env(safe-area-inset-right))',
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              padding: '8px 14px',
              color: COLORS.muted,
              fontSize: '12px',
              fontFamily: FONTS.mono,
              cursor: 'pointer',
              letterSpacing: '.04em',
              zIndex: 3,
              minHeight: '44px',
            }}
            whileTap={{ scale: 0.95 }}
          >
            SKIP
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
