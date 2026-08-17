import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch', () => {
  it('dispara crear y demo', () => {
    const onCreate = vi.fn(), onPlayDemo = vi.fn()
    render(<QuickMatch onCreate={onCreate} onPlayDemo={onPlayDemo} />)
    fireEvent.click(screen.getByText(/create/i)); expect(onCreate).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/demo/i)); expect(onPlayDemo).toHaveBeenCalled()
  })

  it('SOLO botones: ni rótulo, ni titular, ni descripción', () => {
    // Los tres estaban de más en el Lobby unificado: la guía de modos de arriba ya explica a qué
    // se juega y las tarjetas de abajo ya dicen qué hay abierto. Aquí solo faltaba la acción.
    render(<QuickMatch onCreate={vi.fn()} onPlayDemo={vi.fn()} />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText(/Quick match/i)).toBeNull()
    expect(screen.queryByText(/Jump into/i)).toBeNull()
    expect(screen.queryByText(/players open the same packs/i)).toBeNull()
  })

  it('el botón dice "Create Match", sin nombrar un modo', () => {
    // El modo se elige DENTRO del modal, así que prometer "Create Pack Battle" con los dos modos a
    // la vista sería mentir a medias.
    render(<QuickMatch onCreate={vi.fn()} />)
    expect(screen.getByText('Create Match')).toBeTruthy()
    expect(screen.queryByText(/Create Pack Battle/i)).toBeNull()
    expect(screen.queryByText(/Create Battle Royale/i)).toBeNull()
  })

  it('sin onPlayDemo no hay enlace de demo', () => {
    render(<QuickMatch onCreate={vi.fn()} />)
    expect(screen.queryByText(/demo/i)).toBeNull()
  })

  it('con canCreate en false se esconde el botón de crear', () => {
    render(<QuickMatch onCreate={() => {}} canCreate={false} />)
    expect(screen.queryByText('Create Match')).toBeNull()
  })

  it('el enlace de la demo se queda aunque no se pueda crear', () => {
    // Son cosas distintas: que no puedas crear una partida no te impide ver cómo se juega.
    render(<QuickMatch onCreate={() => {}} onPlayDemo={vi.fn()} canCreate={false} />)
    expect(screen.getByText(/free demo/i)).toBeTruthy()
  })
})
