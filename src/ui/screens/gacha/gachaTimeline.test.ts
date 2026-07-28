import { describe, it, expect } from 'vitest'
import { PHASE, SPIN_MS, buildGachaTimeline } from './gachaTiming'

const full = (rarity: 'common' | 'uncommon' | 'rare' | 'epic') =>
  buildGachaTimeline({ hasYear: true, hasGrade: true, rarity })

describe('guion de la ceremonia del gacha', () => {
  // A propósito NO se fijan números: PHASE está para tocarlo. Lo que no puede cambiar es el
  // encadenado, que es lo que hace que mover una fase desplace sola a las de después.
  const filas = PHASE.year + PHASE.grade

  it('las filas y la ruleta se encadenan; la rareza se sabe cuando la ruleta para', () => {
    const e = full('epic')
    expect(e.yearAt).toBe(0)
    expect(e.gradeAt).toBe(PHASE.year)
    expect(e.reelAt).toBe(filas)
    expect(e.reelMs).toBe(SPIN_MS.epic)
    expect(e.rarityAt).toBe(filas + SPIN_MS.epic)
  })

  it('Epic: franja al parar la ruleta, espera, giro largo', () => {
    const e = full('epic')
    expect(e.bandAt).toBe(e.rarityAt)
    expect(e.turnAt).toBe(e.rarityAt + PHASE.band + PHASE.epicWait)
    expect(e.turnMs).toBe(PHASE.epicTurn)
    expect(e.faceUpAt).toBe(e.turnAt + PHASE.epicTurn)
  })

  it('Rare: misma franja, pero voltea sin esperar y más corto', () => {
    const r = full('rare')
    expect(r.bandAt).toBe(r.rarityAt)
    expect(r.turnAt).toBe(r.rarityAt + PHASE.band)   // sin epicWait
    expect(r.turnMs).toBe(PHASE.rareTurn)
  })

  it('Common y Uncommon no llevan franja: voltean en cuanto para la ruleta', () => {
    for (const k of ['common', 'uncommon'] as const) {
      const c = full(k)
      expect(c.bandAt, k).toBeNull()
      expect(c.turnAt, k).toBe(c.rarityAt)
      expect(c.turnMs, k).toBe(PHASE.plainTurn)
    }
  })

  it('el contador entra con la carta YA de cara', () => {
    for (const k of ['common', 'rare', 'epic'] as const) {
      const t = full(k)
      expect(t.countAt, k).toBe(t.faceUpAt + PHASE.gap)
      expect(t.doneAt, k).toBe(t.countAt + PHASE.count + PHASE.hold)
    }
  })

  it('una carta sin año ni grado no reserva su tiempo: la ruleta arranca ya', () => {
    const t = buildGachaTimeline({ hasYear: false, hasGrade: false, rarity: 'epic' })
    expect(t.yearAt).toBeNull()
    expect(t.gradeAt).toBeNull()
    expect(t.reelAt).toBe(0)
  })

  it('una épica dura más que una común de punta a punta', () => {
    expect(full('epic').doneAt).toBeGreaterThan(full('common').doneAt)
  })
})
