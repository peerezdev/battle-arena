import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RoyaleDemoNotice, DEMO_VIDEO_SRC } from './RoyaleDemoNotice'

describe('RoyaleDemoNotice', () => {
  it('muestra el aviso completo', () => {
    render(<RoyaleDemoNotice />)
    expect(screen.getByText('Battle Royale')).toBeTruthy()
    expect(screen.getByText('Hold up. One thing first.')).toBeTruthy()
    expect(screen.getByText(/shouldn't buy a Battle Royale spot/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /watch demo/i })).toBeTruthy()
  })

  it('el vídeo no existe hasta que se pide: nada de precargarlo de fondo', () => {
    const { container } = render(<RoyaleDemoNotice />)
    expect(container.querySelector('video')).toBeNull()
  })

  it('"Watch demo" abre el modal con el vídeo', () => {
    const { container } = render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    expect(video!.getAttribute('src')).toBe(DEMO_VIDEO_SRC)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('se cierra con el botón, con Escape y clicando fuera', () => {
    const { container } = render(<RoyaleDemoNotice />)
    const open = () => fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    const isOpen = () => !!container.querySelector('video')

    open()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(isOpen()).toBe(false)

    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(isOpen()).toBe(false)

    open()
    fireEvent.click(screen.getByRole('dialog'))     // el overlay
    expect(isOpen()).toBe(false)
  })

  it('clicar DENTRO del modal no lo cierra', () => {
    const { container } = render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    fireEvent.click(container.querySelector('video')!)
    expect(container.querySelector('video')).toBeTruthy()
  })

  it('si el vídeo no carga, lo dice en vez de dejar un player roto', () => {
    const { container } = render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    fireEvent.error(container.querySelector('video')!)
    expect(screen.getByText(/demo isn't available/i)).toBeTruthy()
    expect(container.querySelector('video')).toBeNull()
  })
})
