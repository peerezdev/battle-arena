import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const getBattle = vi.fn()
vi.mock('../../../onchain/packBattleClient', () => ({
  getBattle: (...a: unknown[]) => getBattle(...a),
}))
vi.mock('../../useAliases', () => ({ useAliases: () => ({}) }))

import { VerifyBattlePage } from './VerifyBattlePage'

const tirada = (over = {}) => ({
  round_number: 1, player_wallet: 'So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
  nft_address: 'nft1', rarity: 'Epic', insured_value: 500, auto_sold: false,
  grade: 10, year: '2018', name: 'Charizard', buyback_amount: null,
  memo: 'cc-abc-123', tx_signature: 'SIGxyz', ...over,
})

function pintar() {
  return render(
    <MemoryRouter initialEntries={['/play/battle/b1/verify']}>
      <Routes><Route path="/play/battle/:battleId/verify" element={<VerifyBattlePage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { getBattle.mockReset() })

describe('VerifyBattlePage', () => {
  it('da los dos enlaces de cada tirada: el VRF y la transacción', async () => {
    getBattle.mockResolvedValue({ id: 'b1', pulls: [tirada()] })
    pintar()

    // Por ROL, no por texto: el párrafo que explica la página nombra las dos cosas, así que
    // buscar por texto encuentra la prosa antes que el enlace.
    const vrf = await screen.findByRole('link', { name: /Collector Crypt VRF/i })
    // El memo va SIN `:open` y contra el host de la red; con el sufijo el VRF no encuentra nada.
    expect(vrf.getAttribute('href')).toContain('/api/vrf/verify?memo=cc-abc-123')

    const tx = screen.getByRole('link', { name: /Purchase transaction/i })
    expect(tx.getAttribute('href')).toContain('solscan.io/tx/SIGxyz')
  })

  it('enseña el memo y la firma para poder copiarlos', async () => {
    // Son el material con el que se comprueba a mano, no adorno: tienen que estar completos.
    getBattle.mockResolvedValue({ id: 'b1', pulls: [tirada()] })
    pintar()
    expect(await screen.findByText(/cc-abc-123/)).toBeTruthy()
    expect(screen.getByText(/SIGxyz/)).toBeTruthy()
  })

  it('sin firma dice por qué falta en vez de callarlo', async () => {
    // Las tiradas anteriores a la columna no la tienen. Un enlace roto en una página que existe
    // para demostrar algo es peor que decir que ese dato no lo tenemos.
    getBattle.mockResolvedValue({ id: 'b1', pulls: [tirada({ tx_signature: null })] })
    pintar()
    expect(await screen.findByText(/transaction not recorded/i)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Purchase transaction/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Collector Crypt VRF/i })).toBeTruthy()  // el VRF sigue
  })

  it('explica que el VRF no dice quién compró la tirada', async () => {
    // Es lo único que evita que alguien mire el VRF, vea otra wallet y piense que le engañamos.
    getBattle.mockResolvedValue({ id: 'b1', pulls: [tirada()] })
    pintar()
    expect(await screen.findByText(/credits a battle pull to the wallet that holds/i)).toBeTruthy()
  })

  it('una batalla sin tiradas lo dice, no se queda en blanco', async () => {
    getBattle.mockResolvedValue({ id: 'b1', pulls: [] })
    pintar()
    expect(await screen.findByText(/No pulls to verify yet/i)).toBeTruthy()
  })

  it('si no carga, lo dice', async () => {
    getBattle.mockRejectedValue(new Error('nope'))
    pintar()
    expect(await screen.findByText(/Could not load this battle/i)).toBeTruthy()
  })
})
