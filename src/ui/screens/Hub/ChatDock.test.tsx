import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Shape of what ChatDock hands to <TipModal> — TipModal's own props type isn't exported, and
// this test only needs the fields it asserts on, not TipModal's internals.
interface CapturedTipModalProps {
  open: boolean
  to: { wallet: string; alias?: string | null }
  source: 'profile' | 'chat'
  onClose: () => void
}

// Mock the chat hook so ChatDock doesn't open a real WebSocket. `chatState.messages` is
// mutable so individual tests can inject system announcements. `chatState.ownWallet` backs
// the useEmbeddedSolanaAddress mock below, so tip tests can set "who am I" per test.
// `tipModalCalls` records every prop set ChatDock hands to <TipModal>, so wiring tests can
// assert on WHO the modal was opened for, not just that a tip button exists somewhere.
const { chatState, tipModalCalls } = vi.hoisted(() => ({
  chatState: { messages: [] as any[], ownWallet: null as string | null },
  tipModalCalls: [] as CapturedTipModalProps[],
}))
vi.mock('../../../hooks/useChat', () => ({
  useChat: () => ({ messages: chatState.messages, send: vi.fn(), canPost: false, online: 0 }),
}))
vi.mock('../../../wallet/embedded', () => ({ useEmbeddedSolanaAddress: () => chatState.ownWallet }))
// TipModal is Task 5's own component, already tested there; ChatDock only needs to know it was
// opened for the right recipient, not TipModal's internals — so the mock records its props
// (open/to/source) instead of rendering anything.
vi.mock('../../components/TipModal', () => ({
  TipModal: (props: CapturedTipModalProps) => { tipModalCalls.push(props); return null },
}))

import { ChatDock } from './ChatDock'
import { addDrop } from '../../drops/dropsStore'

// ChatDock uses useNavigate (system-announcement buttons), so it needs a Router.
const renderDock = () => render(<MemoryRouter><ChatDock /></MemoryRouter>)

beforeEach(() => {
  localStorage.clear()
  chatState.messages = []
  chatState.ownWallet = null
  tipModalCalls.length = 0
})

describe('ChatDock live drops', () => {
  // Recent Drops is hidden for now (kept in the code for future reuse) — the render-drops
  // tests below are skipped until it's re-enabled in ChatDock.
  it.skip('renders a drop row with the opener username', () => {
    addDrop({
      id: 'mint-1', name: 'Pikachu', valueUsd: 123.5, rarity: 'Rare',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'neo',
      ts: Date.now(),
    })
    renderDock()
    expect(screen.getByText('Pikachu')).toBeTruthy()
    expect(screen.getByText('neo')).toBeTruthy()
  })

  it.skip('falls back to a short wallet when username is null', () => {
    addDrop({
      id: 'mint-2', name: 'Charizard', valueUsd: 999, rarity: 'Epic',
      image: null, source: 'gacha', wallet: 'So1anaAAAAAAAAAAAAAAZZZZ', username: null,
      ts: Date.now(),
    })
    renderDock()
    expect(screen.getByText('Charizard')).toBeTruthy()
    expect(screen.getByText('So1a…ZZZZ')).toBeTruthy()
  })

  // Regression: a drop with ts in epoch SECONDS (backend / legacy cache) must render
  // a sane relative time, not "~20608d ago" from treating seconds as milliseconds.
  it.skip('renders a seconds-epoch ts as a recent time, not decades ago', () => {
    addDrop({
      id: 'mint-secs', name: 'Mew', valueUsd: 50, rarity: 'Rare',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'kai',
      ts: Math.floor(Date.now() / 1000), // seconds, like the backend emits
    })
    renderDock()
    expect(screen.getByText('Mew')).toBeTruthy()
    // no drop should render a decades-old age from misreading seconds as ms
    expect(screen.queryByText(/\d{3,}d ago/)).toBeNull()
  })

  // Regression: drops persisted before the global-drops change lack wallet/username.
  // ChatDock must render them (as 'anon') instead of crashing on userColor(undefined).
  it.skip('renders a legacy drop without wallet/username without crashing', () => {
    addDrop({
      id: 'mint-legacy', name: 'Squirtle', valueUsd: 10, rarity: 'Common',
      image: null, source: 'gacha', ts: Date.now(),
    } as any)
    renderDock()
    expect(screen.getByText('Squirtle')).toBeTruthy()
    expect(screen.getByText('anon')).toBeTruthy()
  })

  // Lobby v2: an Epic drop gets a "BIG PULL" badge next to its name — the badge is
  // driven by rarity, not value, so a low-value Epic still earns it.
  it.skip('shows a BIG PULL badge for an Epic drop (rarity-driven, not value)', () => {
    addDrop({
      id: 'mint-bigpull', name: 'Mewtwo', valueUsd: 200, rarity: 'Epic',
      image: null, source: 'gacha', wallet: 'WalletABCDEF1234', username: 'ash',
      ts: Date.now(),
    })
    renderDock()
    expect(screen.getByText('Mewtwo')).toBeTruthy()
    // The dropsStore accumulates in-memory across tests, so earlier Epics may also
    // carry the badge — assert at least one is present.
    expect(screen.getAllByText('BIG PULL').length).toBeGreaterThanOrEqual(1)
  })

  // System announcements (battle created / big hit / winner) render as a highlighted row,
  // and carry their action button when present.
  it('renders a system announcement with its action button', () => {
    chatState.messages = [{
      user: '📢 Arena', text: 'Nueva Pack Battle · entrada $50 USDC', ts: Date.now(),
      kind: 'system', action: { label: 'Unirse', battleId: 'b1', mode: 'pack' },
    }]
    renderDock()
    expect(screen.getByText('Nueva Pack Battle · entrada $50 USDC')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unirse' })).toBeTruthy()
  })

  it('renders a battle-created event as "{creator} created a Pack Battle $50" + Join', () => {
    chatState.messages = [{
      user: 'prueba2', text: 'created a Pack Battle', ts: Date.now(),
      kind: 'system', event: 'created', amountUsd: 250, mode: 'pack',   // 250 → unique vs test drops
      action: { label: 'Join', battleId: 'b7', mode: 'pack' },
    }]
    renderDock()
    expect(screen.getByText('prueba2')).toBeTruthy()
    expect(screen.getByText(/created a Pack Battle/)).toBeTruthy()
    expect(screen.getByText('$250')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
  })

  it('renders a system announcement without an action (no button)', () => {
    chatState.messages = [{
      user: '📢 Arena', text: '🔥 neo sacó Charizard · $300 (x6.0 la tirada)', ts: Date.now(),
      kind: 'system',
    }]
    renderDock()
    expect(screen.getByText(/neo sacó Charizard/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unirse' })).toBeNull()
  })

  it('renders a big-hit event with the machine chip, player, name and gold value, no button', () => {
    chatState.messages = [{
      user: 'neo', text: 'pulled Charizard', ts: Date.now(),
      kind: 'system', event: 'hit', amountUsd: 320, machine: 'TCG Prime', mult: 10,
    }]
    renderDock()
    expect(screen.getByText('neo')).toBeTruthy()
    expect(screen.getByText(/pulled Charizard/)).toBeTruthy()
    expect(screen.getByText('$320')).toBeTruthy()
    expect(screen.getByText('TCG PRIME')).toBeTruthy()                       // machine the hit came from
    expect(screen.getByText('(x10)')).toBeTruthy()                           // hit multiple
    expect(screen.queryByRole('button', { name: /View|Join/ })).toBeNull()   // hits carry no action button
  })

  it('a hit with no machine falls back to a GACHA chip', () => {
    chatState.messages = [{ user: 'neo', text: 'pulled Charizard', ts: Date.now(), kind: 'system', event: 'hit', amountUsd: 320 }]
    renderDock()
    expect(screen.getByText('GACHA')).toBeTruthy()
  })

  it('renders a winner event like created: player + mode + gold value + multiplier + View button', () => {
    chatState.messages = [{
      user: 'mole', text: 'won a Pack Battle', ts: Date.now(),
      kind: 'system', event: 'winner', amountUsd: 1200, mode: 'pack', mult: 5,
      action: { label: 'View', battleId: 'b9', mode: 'pack' },
    }]
    renderDock()
    expect(screen.getByText('mole')).toBeTruthy()
    expect(screen.getByText(/won a Pack Battle/)).toBeTruthy()
    expect(screen.getByText('$1,200')).toBeTruthy()
    expect(screen.getByText(/\(x5\)/)).toBeTruthy()                     // take ÷ entry multiplier
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
  })
})

describe('ChatDock · perfiles clicables', () => {
  it('el nombre de quien habla lleva a su perfil', () => {
    chatState.messages = [{ user: 'Mauro', wallet: 'So1anaAAA111', text: 'hola', ts: 1 }]
    renderDock()
    const link = screen.getByRole('link', { name: 'Mauro' })
    expect(link.getAttribute('href')).toBe('/profile/So1anaAAA111')
  })

  it('un aviso SIN dueño no enlaza, pero sigue enseñando el nombre', () => {
    // El caso real: los avisos guardados antes de que existiera la columna `wallet`. Se pinta el
    // nombre igual —la línea tiene que seguir leyéndose— pero sin enlace, porque
    // `/profile/undefined` prometería un perfil que no existe.
    //
    // Con `event` a propósito: es la rama donde el nombre SÍ se pinta. Un aviso sin evento
    // enseña solo el texto, así que allí no habría nada que comprobar.
    chatState.messages = [{
      user: 'Battle Arena', text: 'won a Pack Battle', ts: 1,
      kind: 'system', event: 'winner', amountUsd: 500,
    }]
    renderDock()
    expect(screen.queryByRole('link', { name: 'Battle Arena' })).toBeNull()
    expect(screen.getByText('Battle Arena')).toBeTruthy()
  })

  it('un aviso CON dueño sí enlaza', () => {
    // "X ganó una Pack Battle" nombra a una persona, y esa persona tiene perfil.
    chatState.messages = [{
      user: 'Neo', wallet: 'So1anaBBB222', text: 'won a Pack Battle', ts: 1,
      kind: 'system', event: 'winner', amountUsd: 500,
    }]
    renderDock()
    expect(screen.getByRole('link', { name: 'Neo' }).getAttribute('href'))
      .toBe('/profile/So1anaBBB222')
  })

  it('la wallet va escapada', () => {
    chatState.messages = [{ user: 'X', wallet: 'a/b?c', text: 'hola', ts: 1 }]
    renderDock()
    expect(screen.getByRole('link', { name: 'X' }).getAttribute('href')).toBe('/profile/a%2Fb%3Fc')
  })
})

describe('ChatDock · propina desde el chat', () => {
  it('ofrece dar propina a quien habla, pero no a los avisos de la casa sin wallet', () => {
    chatState.messages = [
      { user: 'Rival', wallet: 'WalletB', text: 'hola', ts: 1 },
      { user: 'House', wallet: undefined, text: 'aviso', ts: 2, kind: 'system' },
    ]
    renderDock()
    expect(screen.getAllByRole('button', { name: /tip/i })).toHaveLength(1)
  })

  it('no ofrece propina en un aviso de la casa aunque nombre a un jugador con wallet', () => {
    // Un evento estructurado (created/hit/winner) también pasa por `Autor` y puede traer
    // wallet real (p.ej. "Neo won a Pack Battle") — pero sigue siendo un aviso de la casa,
    // no un mensaje de Neo, así que no debe ofrecer propina.
    chatState.messages = [{
      user: 'Neo', wallet: 'WalletC', text: 'won a Pack Battle', ts: 1,
      kind: 'system', event: 'winner', amountUsd: 500,
    }]
    renderDock()
    expect(screen.queryByRole('button', { name: /tip/i })).toBeNull()
  })

  it('no ofrece dar propina a uno mismo', () => {
    chatState.ownWallet = 'WalletA'
    chatState.messages = [{ user: 'Yo', wallet: 'WalletA', text: 'hola', ts: 1 }]
    renderDock()
    expect(screen.queryByRole('button', { name: /tip/i })).toBeNull()
  })

  it('el botón TIP mide al menos 24px de alto (WCAG 2.2 AA, criterio 2.5.8)', () => {
    // jsdom no hace layout real (getBoundingClientRect siempre da 0 ahí), así que se mide la
    // caja a partir de los estilos EN LÍNEA que React aplicó de verdad (no una estimación): con
    // box-sizing por defecto (content-box), alto de caja = lineHeight + paddingTop + paddingBottom.
    chatState.messages = [{ user: 'Rival', wallet: 'WalletB', text: 'hola', ts: 1 }]
    renderDock()
    const btn = screen.getByRole('button', { name: /tip rival/i })
    const contentHeight = parseFloat(btn.style.lineHeight)
    const paddingTop = parseFloat(btn.style.paddingTop)
    const paddingBottom = parseFloat(btn.style.paddingBottom)
    const boxHeight = contentHeight + paddingTop + paddingBottom
    expect(boxHeight).toBeGreaterThanOrEqual(24)
  })

  it('pulsar el botón de UN autor concreto (no el primero) abre el modal con SU wallet y alias', () => {
    // Regresión contra un cableado que siempre coja el primer mensaje de la lista: con un solo
    // modal para toda la lista (decisión de Task 7), un `onTip` que ignore qué botón se pulsó
    // pasaría cualquier test que solo cuente botones. Aquí se pulsa el de en medio (Bob) y se
    // exige que el modal reciba EXACTAMENTE su wallet/alias, no los de Ana ni los de Cid.
    chatState.messages = [
      { user: 'Ana', wallet: 'WalletAAA', text: 'hola', ts: 1 },
      { user: 'Bob', wallet: 'WalletBBB', text: 'qué tal', ts: 2 },
      { user: 'Cid', wallet: 'WalletCCC', text: 'ey', ts: 3 },
    ]
    renderDock()
    fireEvent.click(screen.getByRole('button', { name: /tip bob/i }))
    expect(tipModalCalls.length).toBeGreaterThan(0)
    const lastCall = tipModalCalls[tipModalCalls.length - 1]
    expect(lastCall.to.wallet).toBe('WalletBBB')
    expect(lastCall.to.alias).toBe('Bob')
    expect(lastCall.source).toBe('chat')
  })
})
