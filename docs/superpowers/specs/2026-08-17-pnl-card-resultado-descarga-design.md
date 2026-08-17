# PNL Card en el resultado, y descargable como imagen — design

Date: 2026-08-17
Status: approved-pending-review

## Objetivo

Dos cosas sobre una pieza que ya existe pero no está enchufada a nada:

1. Que la tarjeta de resultado **salga al ganar una batalla**, no solo en la página de muestra.
2. Que se pueda **descargar como PNG**, para pegarla en X o en Discord.

## Estado de partida (comprobado)

- `pnl.ts`, `PnlCard.tsx` y `shareOnX.ts` existen desde el 2 de agosto, **con tests**.
- **Solo se usan en `DemoPage.tsx`.** `BattleResult.tsx` no los toca.
- En la demo, el ejemplo lleva **`background: null`** (`DemoPage.tsx:183`), así que la tarjeta que
  se ha visto siempre es fondo liso más nuestro logo. El código PUEDE poner de fondo la carta
  ganada (`pnl.ts:57`), pero **eso no lo ha visto nadie**.
- `PnlCard` está medido en `cqw` (porcentaje del ancho), así que la misma tarjeta vale para 320 px
  en el móvil y para una exportación grande. Su propio comentario ya lo anticipaba.
- `BattleResult` recibe el mismo `RevealVM` que necesita `pnlOf(vm)`: **no hay que traer ni un dato
  nuevo**.
- `public/banner.png`: **3168×1344, 7,9 MB**.
- No hay ninguna librería de captura instalada.

## Decisiones

| | |
|---|---|
| Cuándo se ve | Solo si **ganas** (`iWon`, `BattleResult.tsx:26`) |
| Fondo | **`banner.png`**, nuestro, no la carta ganada |
| Descarga | PNG con `html-to-image`, a doble resolución |
| El banner | Copia optimizada a ~1600 px; el original se queda |

### Por qué el fondo es nuestro y no la carta ganada

Es lo que ya se veía, y además **elimina un problema entero**: el CDN de Collector Crypt
(`nft.collectorcrypt.com` → CloudFront) **no envía `access-control-allow-origin`** (medido). Con
una imagen suya de fondo, el navegador marca el lienzo como contaminado y `toBlob()` falla: la
descarga sería imposible sin montar un proxy de imágenes en producción y en desarrollo.

Con `banner.png`, servido por nosotros, no hay nada que resolver.

**Consecuencia que hay que asumir, no esconder:** el campo `background` de `Pnl` se queda sin uso,
y los dos tests que lo comprueban (`pnl.test.ts:60` y `:64`) dejan de tener sentido. Se **borran**
los tres: código y tests de una función que ya no se usa envejecen peor que no tenerlos.

### Por qué se optimiza el banner

7,9 MB para un fondo de 16:9 es 40 veces lo necesario: a 1600 px en JPEG son unos 200 KB, y la
tarjeta se ve igual porque en 16:9 nunca se pintan 3168 px. Sin esto, **cada victoria descarga
7,9 MB** la primera vez, y en móvil con datos eso se nota.

Se genera `public/banner-card.jpg` y la tarjeta usa esa. `banner.png` no se toca.

### Por qué una librería y no dibujar en un lienzo

Dibujarlo a mano obliga a reprogramar el diseño entero —textos, degradados, tipografías, el
recorte del fondo— en código de lienzo. Serían **dos versiones del mismo diseño**, y se
desincronizan a la primera. Con `html-to-image`, lo que se ve es lo que se descarga.

## Qué se construye

### 1. La tarjeta en el resultado

En `BattleResult.tsx`:

```
const pnl = pnlOf(vm)          // ya devuelve null si no está liquidada o no hay ganador
```

Se pinta cuando **`iWon && pnl`**. No se le enseña a quien pierde: la tarjeta es para presumir, y
delante de una derrota sobra. El espectador tampoco la ve.

Debajo van dos botones: **Share on X** (`xIntentUrl(pnl)`, `shareOnX.ts:29`, ya existe) y
**Download**.

### 2. El fondo

`PnlCard` deja de recibir el fondo por datos y usa `/banner-card.jpg` fijo. El velo que ya tiene
—el degradado que abre hacia la derecha para que el texto se lea— se conserva tal cual.

### 3. La descarga

- `html-to-image` sobre el nodo de la tarjeta (`data-testid="pnl-card"`, ya está).
- **`pixelRatio: 2`**, o la imagen sale borrosa en pantallas normales.
- **Los botones van FUERA del nodo capturado.** Es el error clásico: se descarga la tarjeta con un
  botón "Download" dibujado dentro.
- Nombre del fichero con el modo y el multiplicador, para que no se llamen todas `download.png`.

## Errores y casos límite

| Caso | Qué pasa |
|---|---|
| Partida sin liquidar o sin ganador | `pnlOf` devuelve null: no se pinta nada |
| Pierdes, o miras como espectador | No se pinta la tarjeta |
| La captura falla (navegador viejo, memoria) | Aviso "Could not create the image", la tarjeta sigue ahí y el compartir en X sigue funcionando |
| El banner aún no ha cargado al capturar | Se espera a que la imagen esté lista antes de capturar; si no, sale un hueco |
| Entrada 0 (partida gratis) | `multiple` ya es null y la tarjeta lo omite: sin cambios |

## Tests

- **`pnlOf` sin fondo**: se borran los dos tests del `background`; el resto sigue igual.
- **`BattleResult`**: la tarjeta sale al ganar; NO sale al perder; NO sale como espectador; no sale
  si la partida no está liquidada.
- **Descarga**: al pulsar se llama a la captura con el nodo de la tarjeta y con `pixelRatio: 2`;
  si la captura falla, se avisa y no se rompe la pantalla; los botones NO están dentro del nodo
  capturado.
- **El banner**: la tarjeta apunta a `banner-card.jpg`, no al de 7,9 MB. Un test lo fija, porque
  volver al pesado no rompería nada visible.

## Fuera de alcance

- Tarjeta para quien pierde.
- Compartir en Discord.
- Subir la imagen para que X la enseñe en grande (hoy el tuit lleva enlace, no imagen).
- El proxy de imágenes de Collector Crypt: con el fondo propio ya no hace falta.
