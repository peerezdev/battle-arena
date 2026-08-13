/**
 * Interruptores de funcionalidad del frontend.
 *
 * Cada uno tiene su pareja en el backend, y el que manda de verdad es el del backend: este solo
 * evita ofrecer algo que al pulsarlo daría error. Si los dos se desincronizan, el peor caso es
 * cosmético (un botón que responde "no disponible"), nunca que se cuele una acción cerrada.
 */

/**
 * Propinas en USDC entre jugadores.
 *
 * APAGADO por defecto, igual que `tips_enabled` en el backend: la funcionalidad está entera y
 * probada, pero mueve dinero de verdad entre jugadores y todavía no la ha usado ninguno.
 *
 * Para encenderla hay que tocar LOS DOS lados:
 *   · frontend: VITE_TIPS_ENABLED=true en el .env de la raíz
 *   · backend:  TIPS_ENABLED=true en backend/.env
 *
 * Apagarla no borra nada: el endpoint responde 503 `tips_disabled`, los accesos no se pintan, y
 * las propinas ya registradas siguen en la tabla `tips`.
 */
export const TIPS_ENABLED = import.meta.env.VITE_TIPS_ENABLED === 'true'
