// Variants de transición de página (slide+fade), respetando reduced-motion.
export function pageVariants(reduced: boolean) {
  return reduced
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 },
      }
}
export const pageTransition = (reduced: boolean) => ({ duration: reduced ? 0 : 0.28, ease: 'easeInOut' as const })
