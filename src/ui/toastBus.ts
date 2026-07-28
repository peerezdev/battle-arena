// Bus de toasts: emitir, retirar y declarar hueco. Aparte del componente porque exportar
// funciones junto a uno rompe el Fast Refresh (react-refresh/only-export-components).
export type ToastKind = 'error' | 'info' | 'success'
export interface ToastAction { label: string; onClick: () => void }
export interface ToastItem { id: number; msg: string; kind: ToastKind; action?: ToastAction }

let listeners: Array<(t: ToastItem) => void> = []
let closers: Array<(id: number) => void> = []
let nextId = 1

/** Fire a transient toast from anywhere (no provider needed). Pass `action` to add a button.
 *  Devuelve su id, por si hay que retirarlo antes de tiempo con `dismissToast`. */
export function showToast(msg: string, kind: ToastKind = 'error', action?: ToastAction): number {
  const t = { id: nextId++, msg, kind, action }
  listeners.forEach((l) => l(t))
  return t.id
}

/** Retira un toast antes de que expire. Para avisos que describen un estado —"turbo activado"—
 *  que dejan de ser ciertos si el usuario lo deshace enseguida. */
export function dismissToast(id: number | null | undefined) {
  if (id == null) return
  closers.forEach((c) => c(id))
}

// Hueco extra que reservar por debajo del toast. Lo declara la pantalla que monta una barra
// pegajosa propia (la de acciones del gacha en móvil): el Toaster vive en el shell y no puede
// saber qué hay encima del nav en cada pantalla.
let inset = 0
let insetListeners: Array<(n: number) => void> = []
export function setToastInset(px: number) {
  inset = px
  insetListeners.forEach((l) => l(px))
}


/** Solo para el Toaster: suscribirse a los tres canales. Devuelve la baja. */
export function subscribeToasts(
  onShow: (t: ToastItem) => void, onClose: (id: number) => void, onInset: (px: number) => void,
): () => void {
  listeners.push(onShow); closers.push(onClose); insetListeners.push(onInset)
  return () => {
    listeners = listeners.filter((x) => x !== onShow)
    closers = closers.filter((x) => x !== onClose)
    insetListeners = insetListeners.filter((x) => x !== onInset)
  }
}

/** Hueco declarado en este momento, para el estado inicial del Toaster. */
export const currentInset = () => inset
