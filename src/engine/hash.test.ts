import { describe, it, expect } from 'vitest'
import { hashAllocation } from './hash'

const alloc = { apertura: 3, choque: 4, remate: 3 }

describe('hashAllocation', () => {
  it('es determinista para misma asignación y salt', async () => {
    const h1 = await hashAllocation(alloc, 'salt123')
    const h2 = await hashAllocation(alloc, 'salt123')
    expect(h1).toBe(h2)
  })
  it('cambia si cambia el salt', async () => {
    const h1 = await hashAllocation(alloc, 'salt123')
    const h2 = await hashAllocation(alloc, 'salt999')
    expect(h1).not.toBe(h2)
  })
  it('cambia si cambia la asignación', async () => {
    const h1 = await hashAllocation(alloc, 'salt123')
    const h2 = await hashAllocation({ apertura: 4, choque: 3, remate: 3 }, 'salt123')
    expect(h1).not.toBe(h2)
  })
})
