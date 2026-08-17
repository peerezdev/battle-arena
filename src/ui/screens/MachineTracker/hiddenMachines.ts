/**
 * Qué máquinas ha decidido no ver el usuario en el tracker.
 *
 * En el navegador y no en el backend a propósito: el tracker es público y no pide sesión, así que
 * una preferencia por wallet dejaría fuera justo a los visitantes anónimos, que son el público de
 * esta pantalla.
 *
 * SE GUARDAN LAS OCULTAS, NO LAS VISIBLES. Es la decisión que importa: con la lista de visibles,
 * cada máquina que Collector Crypt añada después nacería invisible para todo el que ya tuviera
 * preferencia guardada, y nadie entendería por qué no le aparece la máquina nueva. Guardando las
 * ocultas, lo que no se ha decidido se ve.
 */
const CLAVE = 'ba.evTracker.hiddenMachines'

function leerCrudo(): unknown {
  try {
    const s = localStorage.getItem(CLAVE)
    return s ? JSON.parse(s) : null
  } catch {
    // localStorage puede fallar entero (modo privado de Safari, permisos) y el JSON puede estar
    // corrupto. Ninguna de las dos cosas debe tumbar la pantalla por una preferencia.
    return null
  }
}

/** Las máquinas ocultas. Devuelve un conjunto vacío ante cualquier dato inválido. */
export function leerOcultas(): Set<string> {
  const v = leerCrudo()
  if (!Array.isArray(v)) return new Set()
  return new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))
}

export function guardarOcultas(ocultas: Set<string>): void {
  try {
    // Ordenadas: así el valor guardado no cambia por el orden en que se pulsó, y comparar dos
    // navegadores o depurar a mano es legible.
    localStorage.setItem(CLAVE, JSON.stringify([...ocultas].sort()))
  } catch {
    /* sin almacenamiento la preferencia dura lo que la pestaña; no es motivo para romper nada */
  }
}

export function alternar(ocultas: Set<string>, code: string): Set<string> {
  const s = new Set(ocultas)
  if (s.has(code)) s.delete(code)
  else s.add(code)
  return s
}

/** Deja solo lo que el usuario quiere ver, conservando el orden que trae el servidor. */
export function visibles<T extends { machine: string }>(filas: T[], ocultas: Set<string>): T[] {
  return filas.filter((f) => !ocultas.has(f.machine))
}
