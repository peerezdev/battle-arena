# Sorteo del ganador en Pack Battle cuando hay empate

**Fecha:** 2026-08-02
**Estado:** aprobado

## El problema

En una Pack Battle gana quien acumula más valor. Cuando dos, tres o los cuatro jugadores
terminan con el mismo total, el backend ya resuelve el empate por sorteo, pero en pantalla no
se ve nada: la última carta se destapa, pasan tres segundos y la pantalla de resultado aparece
con un ganador ya marcado, sin explicar por qué ese y no otro de los que empataban.

## Lo que ya existe (y no hay que tocar)

**El backend ya decide y ya lo deja auditado.** `determine_winner`
(`backend/app/services/pack_engine.py`) suma el `insured_value` por jugador, coge a los que
comparten el máximo, los ordena y sortea con la semilla Provably-Fair:

```python
maxv = max(totals.values())
candidates = sorted([w for w, t in totals.items() if t == maxv])
if len(candidates) == 1:
    return candidates[0], None
if not server_seed:
    raise ValueError("server_seed must be set before a tie-break draw")
idx = pick_index(server_seed, client_seed, len(candidates))
return candidates[idx], idx
```

El índice se guarda en `battle.tie_break_index` y sale en el payload de la partida, donde el
panel de verificación ya lo enseña. **Esta función es un feature solo de frontend:** el ganador
ya está decidido y es comprobable; la animación únicamente enseña un sorteo que ya ocurrió.

**Battle Royale ya tiene la animación equivalente.** Su hook tiene una fase `tieBreak` y
`EliminationOverlay` hace girar una ruleta entre los empatados hasta aterrizar en el elegido.
La mecánica del giro está extraída en `royaleShared.ts`: `spinSequence`, `spinStepMs`,
`spinDurationMs` y `tintFor`.

La diferencia con Pack Battle es de significado: el royale sortea **quién cae** (último puesto,
cartel rojo), y aquí se sortea **quién gana** (primer puesto).

## Arquitectura

Tres piezas, cada una con una responsabilidad.

### 1. `src/ui/screens/battle/packTieBreak.ts` — decidir si hay empate

Función pura, sin React:

```ts
export interface TieBreak { tied: string[]; value: number }
export function tieBreakOf(vm: RevealVM): TieBreak | null
```

Devuelve los wallets empatados en el total más alto y ese total. Devuelve `null` —o sea, no hay
nada que animar— en cuatro casos:

- la partida no está liquidada o no hay ganador;
- solo hay un jugador con el máximo;
- hay menos de dos jugadores;
- **el ganador no está entre los empatados.** No debería pasar (el backend sortea entre los
  candidatos), pero si pasara, la ruleta giraría hacia alguien que no ganó. Ante datos que no
  cuadran, no animar es mejor que mentir.

El orden de `tied` es el de los jugadores en la mesa, no el alfabético del backend. Da igual
para el resultado —el ganador se lee de `vm.winner`, no del índice— y en pantalla se lee mejor.

### 2. `src/ui/screens/battle/WinnerDrawOverlay.tsx` — el cartel

Hermano de `EliminationOverlay`, reusando `spinSequence`, `spinStepMs` y `tintFor`.

**No se generaliza `EliminationOverlay` con un `variant`.** Cambian el color, las tres cadenas
de texto y el significado; tocarlo arriesga una pantalla del royale que ya funciona, a cambio de
ahorrar unas pocas líneas. Lo que de verdad se comparte —la mecánica del giro— ya está fuera.

Textos, en inglés como el resto de la interfaz:

| | girando | aterrizado |
|---|---|---|
| eyebrow | `TIED FOR FIRST · $305.00` | igual |
| titular | `Drawing a winner at random…` | `Winner drawn at random` |
| pie | `3 tied` | `★ WINNER` |

Color dorado (`POT_GOLD`), no el rojo del cartel de eliminación.

### 3. `src/ui/screens/battle/PackReveal.tsx` — cuándo se enseña

Hoy, al destaparse la última carta se espera `ROUND_HOLD_MS` (3 s) y se llama a `onComplete`,
que lleva a la pantalla de resultado. Se mete el sorteo en medio:

```
última carta de cara
      ↓ ROUND_HOLD_MS
  ¿hay empate?  ── no ──→ onComplete()  (igual que hoy)
      │ sí
      ↓ spinDurationMs(tied) + WINNER_SHOW_MS
  onComplete()
```

La duración del giro **no es fija**: se calcula con `spinDurationMs`, que es exactamente el
problema que el royale ya tuvo (con un tiempo fijo, a partir de cierto número de empatados la
ruleta seguía girando cuando la fase ya había terminado). Con 2 empatados son ~1,1 s; con 4,
~2,6 s.

## Casos límite

- **Reduced-motion:** no hay sorteo. Se va al resultado con los mismos tiempos de hoy. Es lo que
  hace el royale.
- **Todos a cero** (todas las cartas auto-vendidas o sin valor tasado): es un empate real que el
  backend sorteó, así que se anima igual. Enseñar el sorteo es lo honesto.
- **Partida sin liquidar:** `tieBreakOf` devuelve `null`; comportamiento idéntico al actual.

## Cómo se prueba a mano

Un empate exige que dos cartas valgan exactamente lo mismo, que es raro con valores reales. Sin
una forma de forzarlo, verificar esto a ojo depende de la suerte.

`/play/demo/pack?tie=1` reparte **la misma carta a los cuatro jugadores**, forzando un empate a
cuatro bandas. Convive con `?forced=1`, que fuerza las rarezas.

## Tests

**`packTieBreak.ts`** — empate de 2, de 3 y de 4; un solo líder no es empate; partida sin
liquidar; ganador fuera de la lista de empatados.

**`WinnerDrawOverlay.tsx`** — arranca girando y termina en el ganador y no en otro; con
reduced-motion sale ya aterrizado; enseña cuántos empataron.

**`PackReveal.tsx`** — con empate, `onComplete` no se llama hasta que el sorteo acaba; sin
empate, los tiempos son los de hoy; con reduced-motion no aparece el cartel.

**`demoBattle.ts`** — con `tie`, los cuatro jugadores tienen el mismo total.
