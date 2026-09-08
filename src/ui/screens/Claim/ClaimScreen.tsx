// Claim del airdrop $CARDS. Ruta enlazable desde fuera y fuera de la barra lateral a
// propósito: deja de tener sentido en cuanto CC cierre la bóveda, y una entrada muerta
// en el menú es peor que no tenerla.
import { useEffect, useRef, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { config } from '../../../onchain/config'
import { fetchAirdrop, claimAirdrop, AirdropError } from '../../../onchain/airdropClient'
import type { AirdropStatus } from '../../../onchain/airdropClient'

const CARDS = (base: number): string => (base / 1_000_000).toLocaleString('en-US')

type CargaFase = 'cargando' | 'listo' | 'error'

export function ClaimScreen() {
  const { identityToken } = useIdentityToken()
  const [cargaFase, setCargaFase] = useState<CargaFase>('cargando')
  const [estado, setEstado] = useState<AirdropStatus | null>(null)
  const [firma, setFirma] = useState<string | null>(null)
  const [avisoCarga, setAvisoCarga] = useState('')
  const [reclamando, setReclamando] = useState(false)
  const [avisoReclamo, setAvisoReclamo] = useState('')

  // Guarda contra setState tras desmontar: reintentar() y reclamar() son promesas que pueden
  // resolver después de que el jugador navegue fuera de /claim.
  const montado = useRef(true)
  useEffect(() => () => { montado.current = false }, [])

  // Nunca "no eres elegible" por un fallo nuestro: eso se lo diría a gente que sí lo es. Y el
  // error nunca es un callejón sin salida: reintentar() repite esta misma llamada.
  function aplicarErrorCarga(e: unknown) {
    setAvisoCarga(e instanceof AirdropError && e.kind === 'unavailable'
      ? 'The airdrop claim is not available right now. Please try again later.'
      : 'Could not check your airdrop right now. Please try again in a moment.')
    setCargaFase('error')
  }

  useEffect(() => {
    if (config.isDevnet || !identityToken) return
    let vivo = true
    fetchAirdrop(identityToken)
      .then((s) => { if (vivo) { setEstado(s); setFirma(s.signature); setCargaFase('listo') } })
      .catch((e) => { if (vivo) aplicarErrorCarga(e) })
    return () => { vivo = false }
  }, [identityToken])

  // El botón "Try again" del estado de error: no depende del efecto (solo repite la
  // llamada con el identityToken actual), así no hace falta esperar a que cambie ese token.
  function reintentar() {
    if (!identityToken) return
    setCargaFase('cargando')
    setAvisoCarga('')
    fetchAirdrop(identityToken)
      .then((s) => { if (montado.current) { setEstado(s); setFirma(s.signature); setCargaFase('listo') } })
      .catch((e) => { if (montado.current) aplicarErrorCarga(e) })
  }

  if (config.isDevnet) {
    return <p>The $CARDS airdrop only exists on mainnet.</p>
  }
  if (!identityToken) {
    return <p>Log in to check your $CARDS airdrop.</p>
  }
  if (cargaFase === 'cargando') {
    return <p>Checking your airdrop…</p>
  }
  if (cargaFase === 'error') {
    return (
      <div>
        <p>{avisoCarga}</p>
        <button onClick={reintentar}>Try again</button>
      </div>
    )
  }
  if (!estado?.eligible) {
    return <p>This wallet is not eligible for the $CARDS airdrop.</p>
  }

  const yaEsta = estado.claimed || firma !== null

  async function reclamar() {
    if (!identityToken) return
    setReclamando(true)
    setAvisoReclamo('')
    try {
      const r = await claimAirdrop(identityToken)
      if (!montado.current) return
      setFirma(r.signature)
      setEstado((s) => (s ? { ...s, claimed: true } : s))
    } catch (e) {
      if (!montado.current) return
      // needs_delegation NO es already_claimed: decirle a alguien sin firma delegada que ya
      // reclamó sería mentirle sobre su propio dinero y lo dejaría sin saber qué hacer. Y en
      // los tres casos el botón se queda activo: un fallo de firma o de red no es "no elegible",
      // y convertirlo aquí en un callejón sin salida tiraría la misma distinción que ya hace
      // el backend (502/503 frente a 403) al último paso.
      if (e instanceof AirdropError && e.kind === 'needs_delegation') {
        setAvisoReclamo('Grant signing access (session signer) so the game can claim for you, then try again. You can revoke it anytime in Privy.')
      } else if (e instanceof AirdropError && e.kind === 'already_claimed') {
        setAvisoReclamo('You have already claimed your $CARDS airdrop.')
      } else {
        setAvisoReclamo('The claim could not be completed. Please try again in a moment.')
      }
    } finally {
      if (montado.current) setReclamando(false)
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
        <>
          {avisoReclamo && <p>{avisoReclamo}</p>}
          <button onClick={() => void reclamar()} disabled={reclamando}>
            {reclamando ? 'Claiming…' : 'Claim $CARDS'}
          </button>
        </>
      )}
    </div>
  )
}
