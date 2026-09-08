// Claim del airdrop $CARDS. Ruta enlazable desde fuera y fuera de la barra lateral a
// propósito: deja de tener sentido en cuanto CC cierre la bóveda, y una entrada muerta
// en el menú es peor que no tenerla.
import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { config } from '../../../onchain/config'
import { fetchAirdrop, claimAirdrop, AirdropError } from '../../../onchain/airdropClient'
import type { AirdropStatus } from '../../../onchain/airdropClient'

const CARDS = (base: number): string => (base / 1_000_000).toLocaleString('en-US')

type Fase = 'cargando' | 'listo' | 'reclamando' | 'error'

export function ClaimScreen() {
  const { identityToken } = useIdentityToken()
  const [fase, setFase] = useState<Fase>('cargando')
  const [estado, setEstado] = useState<AirdropStatus | null>(null)
  const [firma, setFirma] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string>('')

  useEffect(() => {
    if (config.isDevnet || !identityToken) return
    let vivo = true
    fetchAirdrop(identityToken)
      .then((s) => { if (vivo) { setEstado(s); setFirma(s.signature); setFase('listo') } })
      .catch((e) => {
        if (!vivo) return
        // Nunca "no eres elegible" por un fallo nuestro: eso se lo diría a gente que sí lo es.
        setAviso(e instanceof AirdropError && e.kind === 'unavailable'
          ? 'The airdrop claim is not available right now. Please try again later.'
          : 'Could not check your airdrop right now. Please try again in a moment.')
        setFase('error')
      })
    return () => { vivo = false }
  }, [identityToken])

  if (config.isDevnet) {
    return <p>The $CARDS airdrop only exists on mainnet.</p>
  }
  if (!identityToken) {
    return <p>Log in to check your $CARDS airdrop.</p>
  }
  if (fase === 'cargando') {
    return <p>Checking your airdrop…</p>
  }
  if (fase === 'error') {
    return <p>{aviso}</p>
  }
  if (!estado?.eligible) {
    return <p>This wallet is not eligible for the $CARDS airdrop.</p>
  }

  const yaEsta = estado.claimed || firma !== null

  async function reclamar() {
    if (!identityToken) return
    setFase('reclamando')
    try {
      const r = await claimAirdrop(identityToken)
      setFirma(r.signature)
      setEstado((s) => (s ? { ...s, claimed: true } : s))
      setFase('listo')
    } catch (e) {
      // needs_delegation NO es already_claimed: decirle a alguien sin firma delegada que ya
      // reclamó sería mentirle sobre su propio dinero y lo dejaría sin saber qué hacer.
      if (e instanceof AirdropError && e.kind === 'needs_delegation') {
        setAviso('Grant signing access (session signer) so the game can claim for you, then try again. You can revoke it anytime in Privy.')
      } else if (e instanceof AirdropError && e.kind === 'already_claimed') {
        setAviso('You have already claimed your $CARDS airdrop.')
      } else {
        setAviso('The claim could not be completed. Please try again in a moment.')
      }
      setFase('error')
    }
  }

  return (
    <div>
      <h1>$CARDS airdrop</h1>
      <p>
        <strong>{CARDS(estado.amount)}</strong> $CARDS
      </p>
      {yaEsta ? (
        <>
          <p>Already claimed.</p>
          {firma && (
            <a href={`https://solscan.io/tx/${firma}`} target="_blank" rel="noopener noreferrer">
              {firma}
            </a>
          )}
        </>
      ) : (
        <button onClick={reclamar} disabled={fase === 'reclamando'}>
          {fase === 'reclamando' ? 'Claiming…' : 'Claim $CARDS'}
        </button>
      )}
    </div>
  )
}
