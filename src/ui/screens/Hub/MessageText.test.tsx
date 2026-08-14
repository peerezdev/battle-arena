import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
}))

import { MessageText } from './MessageText'

describe('MessageText', () => {
  it('la mención enlaza al perfil de quien se mencionó', () => {
    render(<MessageText text="hola @ana, mira" mentions={[{ wallet: 'WalletA', label: 'ana' }]} />)
    const enlace = screen.getByRole('link', { name: '@ana' })
    expect(enlace.getAttribute('href')).toBe('/profile/WalletA')
  })

  it('un mensaje sin menciones se pinta plano', () => {
    // Los mensajes anteriores a esta funcionalidad no traen el campo, y son la mayoría.
    render(<MessageText text="hola @ana" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/hola @ana/)).toBeTruthy()
  })

  it('solo enlaza la etiqueta mencionada, no cualquier arroba', () => {
    render(<MessageText text="@ana y @otro" mentions={[{ wallet: 'WalletA', label: 'ana' }]} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('conserva el texto de alrededor', () => {
    const { container } = render(
      <MessageText text="mira @ana esto" mentions={[{ wallet: 'WalletA', label: 'ana' }]} />)
    expect(container.textContent).toBe('mira @ana esto')
  })

  it('enlaza las dos veces que aparece la misma mención', () => {
    render(<MessageText text="@ana y otra vez @ana" mentions={[{ wallet: 'WalletA', label: 'ana' }]} />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('una etiqueta con caracteres raros no rompe el pintado', () => {
    // Quien no tiene alias se menciona por su wallet abreviada, con puntos suspensivos, y el
    // punto es un comodín en una expresión regular.
    render(<MessageText text="gracias @8QDB…gtm6 !"
                        mentions={[{ wallet: 'WalletC', label: '8QDB…gtm6' }]} />)
    expect(screen.getByRole('link', { name: '@8QDB…gtm6' })).toBeTruthy()
  })
})
