# Crackout

Modo nuevo. La casa pone una carta dentro de una cápsula (*slab*) y los jugadores pagan puntos para
dar golpes. Cada golpe puede romperla. Quien la rompe se lleva la carta.

El nombre viene de la jerga del hobby: *crack out* es sacar una carta de su cápsula. Se descartó
"Break the Slab" por dos motivos, y el segundo pesa más que el primero: ya existe un proyecto que
se llama así, y en coleccionismo un *break* (o *case break*) ya significa otra cosa muy conocida,
abrir cajas selladas en directo y repartir lo que sale.

Dentro del código la palabra *slab* sigue siendo el nombre de la cosa que se rompe, porque es
vocabulario técnico que entiende cualquiera. Crackout es el modo; la losa es la pieza.

## 1. Para qué existe

**Es un sumidero de puntos y una herramienta de retención, no una fuente de ingresos.** Se paga con
gimmighouls y la carta la financia la casa. Hay que diseñarlo con ese objetivo y medirlo con ese
objetivo.

**Se paga con puntos y no con USDC** porque una lotería de pago con premio real es juego de azar
regulado en casi todas partes. Es lo que hace Beezie con sus raffles, y no parece casualidad.

**Es el primer sumidero de gimmighouls que existe.** Hoy los puntos solo ordenan el ranking
(`users.py`, `leaderboard`). No se gastan en nada. Eso significa que el precio del golpe le pone
precio retroactivo a cada punto repartido desde el principio del proyecto, y es una decisión de una
sola dirección.

**Riesgo abierto, del diseño original y sin resolver: el combustible.** Cuando se diseñó esto había
en mainnet 6.140 gimmighouls repartidos entre 12 usuarios. Es poquísimo. Si el modo se lanza sin más
fuentes de puntos, no habrá golpes. Se mitiga eligiendo bien el precio de la primera losa (ver 3),
pero la mitigación de verdad es que haya más maneras de ganar puntos, y eso está fuera de este
diseño.

## 2. Reglas del modo

**Cada golpe tiene una probabilidad `p` fija.** No sube con lo gastado. No hay tope de piedad. Se
aceptan a sabiendas los dos extremos: puede romperse en el primer golpe y puede no romperse en
semanas.

El argumento a favor es la auditabilidad. "1 entre 40, siempre" lo comprueba cualquiera; una `p` que
sube es mucho más difícil de verificar para el jugador, y la verificación es la bandera del producto.

**La losa no caduca.** Vive hasta que alguien la rompa. Sin devolución de puntos ni sorteo de
consolación.

**El golpe no se puede cancelar.** Se cobra, se resuelve y se enseña el resultado en la misma
operación.

## 3. La economía

**`p = 1/D`, con `D = max(2, round(insured_value * 2))`.** El valor asegurado en dólares lo da
Collector Crypt y se conoce al crear la losa.

Consecuencia que conviene entender porque es lo que hace bueno al modo: **el valor esperado de un
golpe es constante**, `p × V = V/(2V) = 0,50 $`. Siempre, valga lo que valga la carta. Una losa cara
no da peores probabilidades por punto gastado, solo dura más. Se explica en una frase y se audita en
una línea.

`D` se compromete como **entero**, no como float. "1 entre 40" se comprueba a ojo; `p = 0.025` invita
a discutir redondeos.

**El coste del golpe se fija al crear cada losa y queda congelado con ella**, junto a `D` y al
extremo de la cadena. No es una constante global. Esto permite lanzar la primera losa barata (el
combustible actual es escaso) y encarecer las siguientes sin tocar código ni invalidar ninguna
verificación pasada: cada losa se comprueba contra su propio compromiso.

Referencia para elegir el precio, dado que un golpe vale 0,50 $ de valor esperado y las batallas dan
0,5 puntos por USDC de volumen (`gimmighoul_per_usdc`) y el gacha 0,1 (`gimmighoul_per_usdc_gacha`):

| Coste por golpe | Valor esperado por punto | Devolución sobre volumen de batallas |
|---|---|---|
| 10 puntos | 0,05 $ | 2,5 % |
| 25 puntos | 0,02 $ | 1,0 % |
| 50 puntos | 0,01 $ | 0,5 % |

La plataforma cobra hoy 0,5 % por jugador con tope del 3 %. Un golpe a 10 puntos devuelve más de lo
que ingresa la casa, así que solo tiene sentido como coste de lanzamiento consciente. El precio de
régimen está más cerca de 50.

## 4. Cómo se hace verificable

### Por qué no vale el commit-reveal que ya existe

`provably_fair.py` revela el `server_seed` al final de la partida. Si se revelara mientras la losa
vive, cualquiera calcularía los golpes futuros y esperaría al bueno. Y como la losa no caduca, **las
derrotas quedarían sin verificar hasta que alguien rompa, y puede que nunca**. Justo el modo donde
más falta hace la prueba sería el único sin ella.

### Cadena de hashes, un eslabón por golpe

Al crear la losa se deriva una semilla y se hashea `N` veces. Se publica **solo el extremo de la
cadena**. Cada golpe consume un eslabón, hacia atrás, y se revela al instante: el jugador comprueba
que el hash de su eslabón coincide con el eslabón anterior. Saber el de hoy no dice nada del de
mañana, porque haría falta invertir un SHA-256.

```
seed   = HMAC-SHA256(CRACKOUT_SECRET, slab_id).hexdigest()
h[0]   = seed
h[i]   = sha256(h[i-1]).hexdigest()          para i = 1..N,  N = 10.000
                                              (sobre la cadena hex, igual que seed_hash)
chain_head = h[N]                             lo único que se publica al crear

golpe k (k = 1, 2, 3, ...):
  link_k = h[N-k]                             se revela EN LA RESPUESTA del golpe
  roll   = int.from_bytes(HMAC-SHA256(key=link_k, msg=client_seed)[:8], "big")
  rompe  = roll % D == 0
```

Verificar un golpe son dos comprobaciones que corre cualquiera:

1. `sha256(link_k) == link_{k-1}`, con `link_0 = chain_head`.
2. `HMAC(link_k, client_seed) % D == 0` coincide con el resultado publicado.

El `client_seed` lo elige el jugador. No puede molerlo: no conoce `link_k` hasta después del golpe.

`N = 10.000` fijo. El script de creación **rechaza cartas cuyo `D` no deje al menos 10x de margen**
(es decir, `D > 1.000`, unos 500 $ de valor asegurado), porque una losa que agota la cadena obliga a
recomprometer en público y eso parece un truco aunque no lo sea.

Calcular `link_k` cuesta `N-k` hashes desde la semilla, unos 5 ms en Python. Es despreciable y evita
guardar la cadena. Si algún día molestara, se cachea en memoria; hoy sería complejidad sin motivo.

### La semilla no se guarda

Se deriva al vuelo desde `CRACKOUT_SECRET`, una variable de entorno. Quien lea `battlearena.db` no
conoce ni un golpe futuro.

La contrapartida es real y va documentada: **es un punto único de fallo**. Si se pierde el secreto,
las losas vivas quedan irresolubles. Pesa poco porque ese mismo entorno ya guarda las credenciales
de Privy, que pueden mover las cartas directamente; perder el entorno ya era catastrófico antes de
este modo.

### Se descartó la entropía de Solana

La opción de resolver cada golpe con el hash de un slot futuro elimina de verdad el problema del
orden (ver 9), porque nadie conoce el resultado de antemano, nosotros tampoco. Se descarta por
coste: latencia visible en cada golpe, dependencia de un RPC con historial, slots saltados que hay
que manejar, y atar un juego que se paga con puntos off-chain a un reloj on-chain. No compensa en un
modo que no mueve dinero real.

## 5. Modelo de datos

Dos tablas. La segunda es el registro público append-only.

```python
class CrackoutSlab(Base):
    __tablename__ = "crackout_slabs"
    id: str                      # slug corto, va en la URL del verificador
    nft_address: str
    # Foto CONGELADA de la carta al crear la losa. Si Collector Crypt cambiara el valor asegurado
    # mañana, el "1 entre D" publicado dejaría de cuadrar con lo que se ve en pantalla.
    name, image_url: str
    insured_value: float
    # ── el compromiso, inmutable desde committed_at ──
    chain_head: str
    chain_length: int            # N
    denominator: int             # D
    cost_points: int
    committed_at: datetime
    # ── estado ──
    status: str                  # live | broken | exhausted
    hits: int                    # eslabones consumidos
    broken_by: str | None
    broken_at: datetime | None
    delivery_signature: str | None
```

```python
class CrackoutHit(Base):
    __tablename__ = "crackout_hits"
    # UNIQUE(slab_id, hit_index) es la defensa de concurrencia, no un adorno.
    id: int
    slab_id: str
    hit_index: int               # 1..N, estrictamente secuencial
    wallet: str
    client_seed: str
    link: str                    # el eslabón revelado
    roll: int
    broke: bool
    cost_points: int             # lo cobrado, copiado: el histórico no depende de la losa
    created_at: datetime
```

Los índices se crean con el mecanismo que ya existe (`_ENSURE_INDEXES` en `db.py`), porque aquí no
hay framework de migraciones.

## 6. El golpe

`POST /crackout/{id}/hit`, cuerpo `{ client_seed }`, autenticado con `Depends(current_user)` como el
resto de endpoints que gastan del usuario.

Todo dentro de una única transacción de base:

```
1. La losa existe, status == "live" y hits < N          si no → 409
2. UPDATE users SET gimmighouls = gimmighouls - coste
     WHERE wallet = ? AND gimmighouls >= coste
   0 filas → saldo insuficiente → 402, y no se consume eslabón
3. k = hits + 1
   link = h[N-k]
4. INSERT crackout_hits (..., hit_index = k)            UNIQUE hace fallar el golpe simultáneo
5. roll = HMAC(link, client_seed);  rompe = roll % D == 0
6. UPDATE crackout_slabs SET hits = k [, status, broken_by, broken_at]
7. COMMIT
```

La respuesta lleva ya el eslabón, el roll y el resultado. **No hay ninguna ventana entre ver el
resultado y pagarlo.** Si la hubiera, se molería hasta ganar sin pagar los fallidos.

Si el `INSERT` choca por la UNIQUE (dos golpes a la vez), la transacción entera se deshace, incluido
el cobro, y se reintenta recalculando `k`. Hasta tres intentos; después, 503.

La entrega de la carta se dispara **después** del commit. Si falla, la losa queda `broken` con
`delivery_signature` nula, que es un estado visible y reparable, no una carta perdida.

## 7. La vitrina

**Una wallet de Privy propia y permanente para Crackout**, configurada como la del operador
(`crackout_wallet_address`, `crackout_wallet_id`). **No** una wallet del pool de escrows.

Tres razones:

**Se aísla sola.** Los dos barridos automáticos que existen (`escrow_pool_sync.py` y
`sweep_stranded_cards.py`) trabajan sobre el pool y sobre batallas con ganador. Una wallet que nunca
entra en el pool no la mira ninguno. No hacen falta excepciones ni banderas para protegerla.

**El pool no es para esto.** Una wallet de escrow se reserva para una partida y se recicla al
terminar. Una losa no caduca y puede vivir meses. Ocupar una wallet reciclable durante meses es
usarla justo al revés de para lo que se hizo.

**La dirección es fija y publicable, y eso amplía lo que el modo puede prometer.** Cualquiera puede
abrirla en un explorador y ver las cartas dentro. La losa deja de ser una promesa que vive en
nuestra base de datos: además del sorteo, **es verificable que el premio existe**. Una sola dirección
para todas las losas vivas es una dirección que la gente aprende y vigila, no cuarenta direcciones
anónimas.

La vitrina no necesita SOL: solo co-firma la salida de la carta. Las comisiones y el alquiler de la
cuenta destino los paga el operador.

## 8. Crear una losa, y entregar la carta

### Crear es un acto de la casa, con script y sin endpoint

`backend/scripts/crackout.py`. Hoy el backend **no tiene ni un solo endpoint de administración**.
Abrir el primero justo para esto sería añadir una puerta que luego hay que vigilar; un script se
ejecuta desde la máquina y no expone nada.

Lo que hace al crear:

1. Comprueba **on-chain** que la carta está de verdad en la vitrina.
2. Lee de Collector Crypt nombre, imagen y valor asegurado, y los congela en la fila.
3. Calcula `D` y verifica el margen de cadena (`D <= 1.000`).
4. Deriva la semilla, calcula `chain_head` y escribe el compromiso.
5. Anuncia la losa en el chat.

Dry-run por defecto y `--go` para escribir, igual que el resto de scripts del proyecto.

### Entregar reutiliza lo que ya funciona

`build_transfer` con `fee_payer` = dirección del operador. Ya soporta los cuatro estándares (pNFT,
standard, Core y cNFT) y ya se usa exactamente así en `sweep_stranded_cards.py`. Firman la vitrina y
el operador.

**El operador paga el gas y el alquiler de la cuenta destino, no la vitrina.** Es literalmente el
fallo que sigue abierto en el settle de las batallas, donde el escrow paga y no le llega. Aquí se
hace bien desde el principio en vez de heredarlo.

Se confirma el **efecto on-chain** antes de marcar `delivery_signature`. Esta es la lección de la
carta de 93 $ que quedó atrapada con `transferred=1`: dar por entregado lo que el RPC aceptó, sin
comprobar que aterrizara, esconde el problema justo donde se busca.

`crackout.py --entregar` reintenta las losas rotas sin firma. Idempotente: comprueba dónde está la
carta y actúa según lo que encuentre.

## 9. Lo que se promete, y lo que no

**La cadena demuestra que no cambiamos el resultado de un golpe. No demuestra que no podamos influir
en a quién le toca cada eslabón.** El servidor conoce los eslabones futuros y recibe el `client_seed`
en la petición, así que en teoría podría calcular si ese jugador ganaría y, si no le conviene,
retrasarlo o colar otro golpe antes.

Es inherente a cualquier provably-fair con servidor. Se mitiga con el registro público append-only
(índice, jugador, `client_seed`, eslabón) y el índice estrictamente secuencial, que hacen que
reordenar deje huella y se pueda detectar después. **Pero detectar no es impedir.**

Por eso la frase que se publica es **"no podemos cambiar el resultado"**, nunca "no podemos influir
en el sorteo". Y va escrita con esas palabras en la propia página del verificador, no escondida en un
pie de página. Prometer de menos y cumplir es lo que hace creíble el resto.

Las otras cinco vulnerabilidades del análisis original, y dónde quedan resueltas:

| Vulnerabilidad | Dónde se ataca |
|---|---|
| Fuga de la cadena desde la base | 4: la semilla no se guarda, se deriva de `CRACKOUT_SECRET` |
| `p` mutable invalidaría el pasado | 5: `denominator` es una columna de la losa, congelada al crear |
| Golpe no atómico | 6: cobro, eslabón y revelación en una transacción, sin marcha atrás |
| Reutilizar una cadena | 4: una cadena por losa (`HMAC(secreto, slab_id)`), con margen de 10x y estado `exhausted` |
| Concurrencia | 6: `UNIQUE(slab_id, hit_index)` más reintento |

## 10. API

| Endpoint | Qué hace |
|---|---|
| `GET /crackout` | Losas vivas, y las últimas rotas |
| `GET /crackout/{id}` | Compromiso completo (`chain_head`, `N`, `D`, coste) y estado |
| `GET /crackout/{id}/hits?after=` | Registro append-only, paginado |
| `POST /crackout/{id}/hit` | Da un golpe. 402 sin saldo, 409 si no está viva |

## 11. Frontend

Rutas `/play/crackout` (lista de losas vivas), `/play/crackout/:id` (la losa) y
`/play/crackout/:id/verify` (el verificador). Entrada en el Hub, al lado de Arena y Royale.

La pantalla de la losa: la carta grande, el "1 entre D" publicado, el coste del golpe, cuántos van,
el saldo de puntos del jugador y el botón. Cada golpe, una animación corta y el eslabón apareciendo
encadenado al anterior. **Que se vea la cadena creciendo es medio producto; la otra mitad es que se
vea igual cuando pierdes.**

El verificador es hermano de `VerifyBattlePage.tsx`, con una diferencia que es el punto entero:
**la comprobación la hace el navegador**. Se descarga el registro y rehace la cadena por su cuenta,
eslabón a eslabón, hasta llegar al `chain_head` publicado, y rehace cada roll con Web Crypto. No se
fía del backend en ningún momento. También enlaza la vitrina en un explorador, para que se pueda
comprobar que la carta está donde decimos.

Anuncios en el chat al crear una losa y al romperla, reutilizando los eventos estructurados que ya
existen (`event`, `amount_usd`).

## 12. Pruebas

Con tests primero, como el resto del proyecto.

- La cadena: `sha256(link_k) == link_{k-1}` para una losa de juguete completa.
- El roll sale de donde debe, y `D` redondea siempre igual (incluido el suelo de 2).
- Sin saldo no se consume eslabón ni avanza `hits`.
- Dos golpes simultáneos no comparten `hit_index`, y el perdedor no queda cobrado.
- Una losa `broken` no acepta más golpes; una agotada pasa a `exhausted`.
- Cambiar el coste de una losa nueva no altera el histórico de otra.
- El script rechaza una carta que no está en la vitrina, y una cuyo `D` no deje margen.

**Un vector fijo compartido.** Una losa de juguete con semilla conocida y sus primeros golpes,
guardada en un fichero que usan las pruebas del backend **y** las del verificador del navegador. Así
el verificador y el servidor no pueden separarse sin que salte una prueba. Si se separaran, la página
diría "esto no cuadra" sobre golpes que sí cuadran, y eso destruye la confianza más rápido que no
tener página.

## 13. Fuera de alcance

- Endpoint de administración para crear losas. Es un script.
- Cachear la cadena en memoria.
- Entropía on-chain (ver 4).
- Caducidad, devoluciones, sorteos de consolación, topes de piedad.
- Nuevas fuentes de gimmighouls, que son el riesgo real de que el modo nazca quieto (ver 1).
