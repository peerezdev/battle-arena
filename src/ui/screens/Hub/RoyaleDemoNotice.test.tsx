import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RoyaleDemoNotice, DEMO_VIDEO_SRC } from './RoyaleDemoNotice'

// El aviso se esconde en cuanto se marca como visto, así que sin esto un test contagiaría a los
// siguientes: el segundo ya no encontraría ni el botón.
beforeEach(() => localStorage.clear())

describe('RoyaleDemoNotice', () => {
  it('avisa de ver la demo ANTES de pagar una plaza', () => {
    // Es su único trabajo, y por eso la frase habla del precio y no de la demo.
    render(<RoyaleDemoNotice />)
    expect(screen.getByText(/New to Battle Royale\? Watch the demo first\./)).toBeTruthy()
    expect(screen.getByText(/before paying for a spot/)).toBeTruthy()
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

  // Un render por vía de cierre: al cerrar el modal el aviso ya se ha marcado como visto y
  // desaparece, así que no se puede reabrir sobre el mismo montaje.
  it.each([
    ['el botón de cerrar', () => fireEvent.click(screen.getByRole('button', { name: /close/i }))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['clicando fuera', () => fireEvent.click(screen.getByRole('dialog'))],
  ])('el modal se cierra con %s', (_nombre, cerrar) => {
    localStorage.clear()
    const { container } = render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    expect(container.querySelector('video')).toBeTruthy()
    cerrar()
    expect(container.querySelector('video')).toBeNull()
  })

  it('clicar DENTRO del modal no lo cierra', () => {
    const { container } = render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    fireEvent.click(container.querySelector('video')!)
    expect(container.querySelector('video')).toBeTruthy()
  })

  it('una vez visto, NO vuelve a aparecer', () => {
    // Cumplido su trabajo, seguir enseñándolo es un cartel fijo en la pantalla a la que más se
    // vuelve, y los carteles fijos se dejan de leer — también el día que sí importe.
    render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    cleanup()
    const { container } = render(<RoyaleDemoNotice />)
    expect(container.innerHTML).toBe('')
  })

  it('se marca al ABRIR el vídeo, no al terminarlo', () => {
    // Medir cuánto ha visto alguien pediría un umbral inventado. Abrirlo ya es la señal.
    render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    expect(localStorage.getItem('ba.royaleDemo.visto')).toBe('1')
  })

  it('se puede quitar sin verlo, y tampoco vuelve', () => {
    // Un aviso del que no se puede salir se lee como publicidad.
    render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('button', { name: /watch demo/i })).toBeNull()
    cleanup()
    const { container } = render(<RoyaleDemoNotice />)
    expect(container.innerHTML).toBe('')
  })

  it('si el vídeo no carga, lo dice en vez de dejar un player roto', () => {
    const { container } = render(<RoyaleDemoNotice />)
    fireEvent.click(screen.getByRole('button', { name: /watch demo/i }))
    fireEvent.error(container.querySelector('video')!)
    expect(screen.getByText(/demo isn't available/i)).toBeTruthy()
    expect(container.querySelector('video')).toBeNull()
  })
})


describe('DEMO_VIDEO_SRC', () => {
  it('apunta a /media/, que es lo que sirve Caddy fuera del repo', () => {
    // El test de arriba compara el src del <video> contra esta misma constante, así que pasaba
    // con cualquier ruta — y de hecho apuntaba a /royale-demo.mp4, que no existe: el modal se
    // abría y el vídeo no cargaba. Antes eso se detectaba mirando el disco (`public/…`).
    //
    // Ya no se puede: el vídeo vive fuera del repositorio, en /srv/battlearena/media, para no
    // dejar 13 MB por versión en el historial de git. Aquí solo queda fijar la FORMA de la ruta;
    // que el fichero exista y se sirva de verdad lo comprueba verify.sh contra el servidor, que
    // es donde esa pregunta tiene respuesta.
    expect(DEMO_VIDEO_SRC.startsWith('/media/')).toBe(true)
    expect(DEMO_VIDEO_SRC.endsWith('.mp4')).toBe(true)
  })
})
