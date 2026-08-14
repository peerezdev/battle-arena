import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MentionAutocomplete } from './MentionAutocomplete'

const candidatos = [
  { wallet: 'WalletAAAA1111', name: 'ana' },
  { wallet: 'WalletBBBB2222', name: 'Bea' },
]

describe('MentionAutocomplete', () => {
  it('enseña a los candidatos con su wallet, para distinguir nombres parecidos', () => {
    render(<MentionAutocomplete candidatos={candidatos} onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(screen.getByText('ana')).toBeTruthy()
    expect(screen.getByText('Bea')).toBeTruthy()
    expect(screen.getByText(/Wall…1111/)).toBeTruthy()
  })

  it('Enter elige el resaltado, y las flechas lo mueven', () => {
    const onElegir = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onElegir).toHaveBeenCalledWith(candidatos[1])
  })

  it('sin tocar nada, Enter elige al primero', () => {
    const onElegir = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onElegir).toHaveBeenCalledWith(candidatos[0])
  })

  it('el resaltado da la vuelta en los extremos', () => {
    const onElegir = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'ArrowUp' })     // desde el primero, al último
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onElegir).toHaveBeenCalledWith(candidatos[1])
  })

  it('Escape cierra sin elegir a nadie', () => {
    const onElegir = vi.fn(); const onCerrar = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={onCerrar} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
    expect(onElegir).not.toHaveBeenCalled()
  })

  it('pulsar con el ratón también elige', () => {
    const onElegir = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={vi.fn()} />)
    fireEvent.click(screen.getByText('Bea'))
    expect(onElegir).toHaveBeenCalledWith(candidatos[1])
  })

  it('sin candidatos no pinta nada', () => {
    const { container } = render(
      <MentionAutocomplete candidatos={[]} onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
