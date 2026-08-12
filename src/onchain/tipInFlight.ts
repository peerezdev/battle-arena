/**
 * Registro de las propinas que están EN VUELO ahora mismo, por wallet de destino.
 *
 * Vive fuera de React a propósito. El estado `busy` del TipModal solo existe mientras el modal
 * está montado, y en el chat el modal se desmonta entero al cerrarlo (`{tipTarget && <TipModal/>}`):
 * cerrar con una propina en vuelo y volver a abrir sobre el mismo jugador devolvía el botón a
 * activo y dejaba mandar una SEGUNDA propina mientras la primera seguía viva. Aquí el envío vivo
 * sobrevive al desmontaje, así que el modal puede preguntarlo al abrirse.
 *
 * Es un Set por destinatario, no un flag global: dos propinas a jugadores DISTINTOS en paralelo
 * son legítimas; lo que no puede repetirse es la misma propina al mismo jugador.
 *
 * Se consulta al abrir y nada más: no hay suscripción ni notificación de cambios. Basta para lo
 * que protege, y el caso raro que deja fuera (la propina termina con el modal ya reabierto, que
 * se queda deshabilitado hasta volver a abrirlo) es infinitamente preferible a pagar dos veces.
 */
const enVuelo = new Set<string>()

export function markTipInFlight(wallet: string): void {
  enVuelo.add(wallet)
}

export function clearTipInFlight(wallet: string): void {
  enVuelo.delete(wallet)
}

export function isTipInFlight(wallet: string): boolean {
  return enVuelo.has(wallet)
}
