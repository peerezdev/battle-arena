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

  it('marca a los conectados, y sin la marca la lista se ve igual que siempre', () => {
    // La búsqueda de `/tip` ofrece a jugadores que pueden no estar en la sala; las menciones, solo
    // a conectados. Si el punto saliera siempre, no distinguiría nada.
    const { container } = render(
      <MentionAutocomplete candidatos={candidatos} onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0)

    render(<MentionAutocomplete
      candidatos={[{ wallet: 'W1', name: 'ana', online: true }, { wallet: 'W2', name: 'Bea' }]}
      onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(screen.getAllByRole('img', { name: /online now/i })).toHaveLength(1)
  })

  it('la segunda línea puede describir un comando en vez de una wallet', () => {
    // Un comando no tiene wallet: acortar su descripción a "Send…ayer" sería basura.
    render(<MentionAutocomplete
      candidatos={[{ wallet: '/tip', name: '/tip', detalle: 'Send USDC to another player' }]}
      onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(screen.getByText('Send USDC to another player')).toBeTruthy()
  })

  it('sin candidatos no pinta nada', () => {
    const { container } = render(
      <MentionAutocomplete candidatos={[]} onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
