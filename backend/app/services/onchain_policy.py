"""Cuánto se insiste al preguntar a la cadena "¿ya está?".

Un solo sitio que tocar. Dos números independientes, y confundirlos sale caro:

  · CONFIRM_POLLS  → cuántas LLAMADAS al RPC se gastan. Cada una se paga.
  · CONFIRM_DELAY  → cada cuánto se pregunta.
  · el producto     → cuánta PACIENCIA hay antes de rendirse.

Lo que se quiere es paciencia alta y llamadas bajas, y eso se consigue preguntando MENOS VECES
pero MÁS ESPACIADO, no recortando la espera total:

    20 × 3 s = 60 s  con 20 llamadas   ← como estaba
     7 × 3 s = 21 s  con  7 llamadas   ← barato pero impaciente: NO
     7 × 8 s = 56 s  con  7 llamadas   ← misma paciencia, un tercio del gasto

Por qué importa la paciencia: se midió que cartas dadas por "no confirmadas en el escrow"
estaban EN el escrow al mirarlas después. No era el RPC fallando —un 429 lanza, no devuelve
"no está"— sino que llegaban más tarde de lo que duraba la ventana. Recortar la ventana a 21 s
habría dejado atrapadas MÁS cartas, no menos.

El camino bueno no paga esto: el bucle sale en cuanto confirma, así que una operación normal
gasta 1 o 2 llamadas y no espera los 8 s completos.

NO se aplica al sondeo de open_pack: ese pregunta a Collector Crypt, que resuelve por webhook,
y además no gasta créditos de RPC.
"""

CONFIRM_POLLS = 7
CONFIRM_DELAY = 8.0
