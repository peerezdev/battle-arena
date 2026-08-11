import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const conf = vi.hoisted(() => ({ discordUrl: '', xUrl: '' }))
vi.mock('../../../onchain/config', () => ({ config: conf }))

import { SocialLinks } from './LeftRail'

beforeEach(() => { conf.discordUrl = ''; conf.xUrl = '' })

describe('SocialLinks', () => {
  it('cada icono lleva a su enlace y se abre fuera', () => {
    conf.discordUrl = 'https://discord.gg/ejemplo'
    conf.xUrl = 'https://x.com/ejemplo'
    render(<SocialLinks />)

    const discord = screen.getByRole('link', { name: 'Discord' })
    const x = screen.getByRole('link', { name: 'X' })
    expect(discord.getAttribute('href')).toBe('https://discord.gg/ejemplo')
    expect(x.getAttribute('href')).toBe('https://x.com/ejemplo')
    // Son enlaces externos: sacar de la app al que está jugando sería perder la partida.
    expect(discord.getAttribute('target')).toBe('_blank')
    expect(discord.getAttribute('rel')).toContain('noreferrer')
  })

  it('sin URL configurada no se pinta ese icono', () => {
    // Un enlace social que no lleva a ninguna parte transmite que el proyecto está abandonado.
    //
    // Se comprueba que NO EXISTE el elemento, no que no tenga rol de enlace: un <a href=""> se
    // pinta igual pero deja de exponerse como `link`, así que buscar por rol daba por bueno un
    // icono que sí estaba en pantalla. El test pasaba sin comprobar nada.
    conf.xUrl = 'https://x.com/ejemplo'
    const { container } = render(<SocialLinks />)
    expect(screen.queryByLabelText('Discord')).toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'X' })).toBeTruthy()
  })

  it('sin ninguna URL no se pinta nada', () => {
    const { container } = render(<SocialLinks />)
    expect(container.firstChild).toBeNull()
  })

  it('los iconos tienen nombre accesible, no solo dibujo', () => {
    // Sin texto visible, el `aria-label` es lo único que los distingue para un lector de pantalla.
    conf.discordUrl = 'https://discord.gg/ejemplo'
    render(<SocialLinks />)
    expect(screen.getByLabelText('Discord')).toBeTruthy()
  })
})
