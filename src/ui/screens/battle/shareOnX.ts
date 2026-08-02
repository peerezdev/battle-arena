import { SITE_URL, type Pnl } from './pnl'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/**
 * El texto del tuit que se le deja escrito al ganador.
 *
 * Con ganancia se presume de la cifra, que es de lo que va la tarjeta. Con pérdida NO: ganar la
 * partida y perder dinero pasa cuando el botín vale menos que la entrada, y un tuit que dijera
 * "+" ahí sería mentira. En ese caso se cuenta lo que sí es cierto —que ganó y qué se llevó— y
 * se deja la cifra de balance fuera.
 */
export function tweetText(pnl: Pnl): string {
  const modo = pnl.mode.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
  if (pnl.profit >= 0) {
    const mult = pnl.multiple != null ? ` · ×${pnl.multiple.toFixed(1)}` : ''
    return `Just won a ${modo} on Collector Arena 🏆\n\n${usd(pnl.profit)} profit${mult}`
  }
  return `Just won a ${modo} on Collector Arena 🏆\n\n${usd(pnl.payout)} in cards`
}

/**
 * El enlace que abre X con el tuit ya escrito.
 *
 * OJO: la intención de X **no admite adjuntar una imagen**. No hay parámetro para media; lo
 * único que viaja es texto y enlace. Para que salga foto en el tuit, la página enlazada tiene
 * que servir `twitter:card` y `twitter:image`, y es el rastreador de X quien la recoge.
 */
export function xIntentUrl(pnl: Pnl, url: string = SITE_URL): string {
  const q = new URLSearchParams({ text: tweetText(pnl), url })
  return `https://x.com/intent/post?${q.toString()}`
}
