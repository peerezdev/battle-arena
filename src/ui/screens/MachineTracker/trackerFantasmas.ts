/**
 * El fondo de la puerta del tracker: tarjetas FALSAS.
 *
 * Es la decisión que sostiene la puerta entera. Lo evidente sería difuminar las tarjetas de verdad,
 * y sería una puerta de mentira: un `filter: blur()` es CSS, y cualquiera lo quita desde las
 * herramientas del navegador en dos clics. Peor todavía, los números seguirían viajando en la
 * respuesta aunque el pixel esté borroso.
 *
 * Así que detrás del cristal no hay datos. Estos números están inventados, no salen de ninguna
 * medición y NO se piden al servidor: la pantalla ni llama a `/gacha/ev` mientras la puerta está
 * puesta. Lo único que se enseña es la FORMA de lo que hay dentro, que es lo que hace entender qué
 * se está perdiendo sin regalarlo.
 *
 * Los nombres son de máquinas reales a propósito: el catálogo es público en Collector Crypt, así que
 * no revelan nada, y con nombres inventados el fondo parecería una maqueta de relleno en vez de una
 * versión desenfocada de la pantalla que hay detrás.
 */
export interface Fantasma {
  name: string
  price: string
  /** Ninguno de estos valores es real. Están escogidos para que el fondo tenga variedad: alguno
   *  por encima de 1, alguno por debajo, y alguno sin medición. */
  value: string
  sub: string
  acento: string
  /** Cuánto arco se rellena, en unidades del trazo del SVG. */
  dash: number
}

export const FANTASMAS: Fantasma[] = [
  { name: 'Elite Pokémon Gacha Pack', price: '$50 · bb 85%', value: '1.194', sub: 'edge +19.45%', acento: '#3ce8a8', dash: 118 },
  { name: 'Starter Pokémon Gacha Pack', price: '$25 · bb 85%', value: '0.913', sub: 'edge -8.69%', acento: '#ff6ba4', dash: 43 },
  { name: 'Static 65', price: '$65 · bb 85%', value: '0.932', sub: 'model estimate', acento: '#7d8794', dash: 48 },
  { name: 'Legendary Pokémon Gacha Pack', price: '$250 · bb 90%', value: '1.058', sub: 'model estimate', acento: '#ffd166', dash: 81 },
  { name: 'Grail Pokémon Gacha Pack', price: '$1000 · bb 93%', value: '1.250', sub: 'model estimate', acento: '#ffd166', dash: 132 },
  { name: 'Elite CNFT Gacha Pack', price: '$50 · bb 85%', value: '1.122', sub: 'model estimate', acento: '#ffd166', dash: 98 },
]
