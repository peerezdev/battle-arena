/**
 * Si este navegador ya pasó por la demo de Battle Royale.
 *
 * El aviso existe para que nadie pague una plaza sin saber a qué juega. Cumplido eso, seguir
 * enseñándolo es un cartel fijo en la pantalla a la que más se vuelve, y los carteles fijos se
 * dejan de leer — también el día que sí importe.
 *
 * SE MARCA AL ABRIR EL VÍDEO, no al terminarlo. Saber cuánto ha visto alguien pediría escuchar el
 * `timeupdate` y decidir un umbral, y ese umbral sería inventado. Abrirlo ya es la señal de que el
 * aviso hizo su trabajo: a partir de ahí es decisión del jugador.
 *
 * En el navegador y no en el backend a propósito: el Lobby se ve sin sesión, y una preferencia por
 * wallet dejaría el aviso permanente justo para quien todavía no ha entrado, que es quien más lo
 * necesita.
 */
const CLAVE = 'ba.royaleDemo.visto'

export function yaVisto(): boolean {
  try {
    return localStorage.getItem(CLAVE) === '1'
  } catch {
    // Safari en privado lanza al leer. Ante la duda se enseña el aviso: molestar es más barato que
    // dejar a alguien pagar sin saber a qué juega.
    return false
  }
}

export function marcarVisto(): void {
  try {
    localStorage.setItem(CLAVE, '1')
  } catch { /* sin almacenamiento el aviso volverá; no es motivo para romper nada */ }
}
