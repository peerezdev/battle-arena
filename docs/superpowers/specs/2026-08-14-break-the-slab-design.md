# Break the Slab — diseño a medias

**Estado: sin terminar.** Queda UNA decisión (ver el final). Todo lo demás está decidido.

Modo nuevo: se pone una carta en juego y los jugadores dan golpes intentando romper la losa y
llevársela.

## Decidido

**Se paga con gimmighouls**, no con USDC. Los puntos se ganan jugando, no se compran. Es lo que
hace Beezie con sus raffles, y no parece casualidad: una lotería de pago con premio real es juego
de azar regulado en casi todas partes.

Consecuencia: la carta la financia la casa. Esto es **un sumidero de puntos y una herramienta de
retención**, no una fuente de ingresos, y hay que diseñarlo con ese objetivo.

Ojo con el combustible: en mainnet había **6.140 gimmighouls repartidos entre 12 usuarios** cuando
se diseñó esto. Es poquísimo. Si el modo se lanza sin más fuentes de puntos, no habrá golpes.

**Cada golpe tiene una probabilidad `p` FIJA de romper la losa.** No sube con lo gastado, no hay
tope de piedad. Se aceptaron a sabiendas los dos extremos: puede romperse en el primer golpe y
puede no romperse en semanas.

El argumento a favor, que es bueno: **una `p` fija y publicada es trivial de auditar**. «1 entre
200, siempre» lo comprueba cualquiera; una `p` que sube es mucho más difícil de verificar para el
jugador, y la verificación es la bandera del producto.

**La losa no caduca.** Vive hasta que alguien la rompa. Sin devolución de puntos ni sorteo de
consolación.

## La decisión que falta: cómo se hace verificable

El commit-reveal que ya existe (`provably_fair.py`) **no vale tal cual**. Ese esquema revela el
`server_seed` al final; si se revela mientras la losa vive, cualquiera calcula los golpes futuros y
espera al bueno. Con `p` fija y sin caducidad, eso significa que **las derrotas quedarían sin
verificar hasta que alguien rompa la losa, y puede que nunca**. Justo el modo donde más falta hace
la prueba sería el único sin ella.

### Opción A — cadena de hashes, un eslabón por golpe (la recomendada)

Al crear la losa se genera un seed y se hashea N veces; se publica solo el extremo de la cadena.
Cada golpe consume un eslabón que se revela **al instante**: el jugador comprueba que su hash
coincide con el eslabón anterior. Saber el de hoy no dice nada del de mañana, porque haría falta
invertir un SHA-256. El resultado sale de `HMAC(eslabón, client_seed)` y rompe si cae por debajo
de `p`.

Es el esquema estándar del sector. **Cada golpe se verifica en el momento, gane o pierda.**

### Opción C — entropía de la cadena de Solana

Cada golpe usa el hash de un bloque futuro. Nadie lo conoce de antemano, ni nosotros. Elimina el
problema del orden (ver abajo) a cambio de latencia, complejidad, y de atar un juego que se paga
con puntos off-chain a un reloj on-chain.

### Vulnerabilidades de A, que es lo que hay que sopesar

**La grande: la cadena no impide elegir el orden.** Demuestra que no cambiamos un resultado después
de conocerlo; NO demuestra que no elegimos a quién le toca cada eslabón. El servidor conoce todos
los eslabones futuros, y el `client_seed` llega en la petición, así que puede calcular si ese
jugador ganaría y, si no le conviene, retrasar, colar un golpe propio o servirle el siguiente.

Es inherente a cualquier provably-fair con servidor. Se mitiga con un **registro público
append-only** (índice, jugador, `client_seed`, eslabón revelado) que hace detectable el
reordenamiento a posteriori, y con un índice estrictamente secuencial. Pero **detectar no es
impedir**. La frase publicable es «no podemos cambiar el resultado», no «no podemos influir en el
sorteo».

Las otras cinco, todas resolubles pero ninguna olvidable:

- **Fuga de la cadena.** Quien lea la base conoce los golpes futuros. Se reduce derivando los
  eslabones al vuelo desde un secreto en el entorno, pero eso lo convierte en punto único de fallo.
- **`p` tiene que quedar comprometida** al crear la losa, junto al extremo de la cadena, e
  inmutable. Si es una constante mutable, cambiarla invalida en silencio toda verificación pasada.
- **Golpe atómico.** Cobrar puntos, consumir eslabón y revelar, en una transacción sin marcha
  atrás. Si se puede ver el resultado y cancelar, se muele hasta ganar.
- **Una cadena por losa**, jamás reutilizada. Si se agota hay que recomprometer en público y
  documentarlo, o parece un truco.
- **Concurrencia.** Dos golpes simultáneos no pueden consumir el mismo eslabón. Contador
  transaccional.

**La pregunta abierta:** ¿A con los límites escritos y bien explicados, o C para eliminar de verdad
el problema del orden?
