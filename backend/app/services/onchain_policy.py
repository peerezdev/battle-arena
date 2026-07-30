"""Cuánto se insiste al preguntar a la cadena "¿ya está?".

Un solo sitio que tocar. Cada sondeo es una llamada al RPC y se paga: con el techo en 20 y
3 s de espera, una operación que NO va a confirmar quema 20 créditos y un minuto entero antes
de rendirse — y el reveal de una royale hace eso por cada tirada y por cada carta. Una partida
con 14 cartas atascadas llegaba a ~2.145 llamadas.

El camino bueno no cambia: el bucle sale en cuanto confirma, así que una operación normal gasta
2 o 3 llamadas tanto con 7 como con 20. Bajar el techo solo abarata el FALLO.

7 × 3 s = 21 s. Solana confirma en 1-2 s; si a los 21 no ha confirmado, esperar 40 más no lo
arregla. El precio es que en una congestión fuerte se abandona algo que habría entrado en el
segundo 30: la carta se queda en el escrow —lo que ya pasaba— y la recupera
scripts/rescue_and_buyback.py.

NO se aplica al sondeo de open_pack: ese pregunta a Collector Crypt, que resuelve por webhook y
puede tardar de verdad. Ahí 21 s haría fallar tiradas buenas, y además no cuesta créditos.
"""

CONFIRM_POLLS = 7
CONFIRM_DELAY = 3.0
