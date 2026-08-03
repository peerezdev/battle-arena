"""Dice en voz alta contra qué red y qué base va a actuar un script de consola.

Existe por un fallo que no da error: la ruta de `DATABASE_URL` es RELATIVA al directorio de
trabajo. El mismo comando, con el mismo `APP_NETWORK=mainnet`, escribe en una base distinta
según desde dónde se lance — la de producción en `/srv/battlearena/backend`, la de la copia de
desarrollo en cualquier otro sitio. El script responde "apagada" con toda la razón, y el juego
no cambia, porque la apagó en la base que nadie lee.

Una línea a stderr basta para verlo antes de fastidiarla. Va a stderr y no a stdout para no
ensuciar la salida de quien canalice el listado a otro comando.
"""
import os
import sys

_PREFIJO = "sqlite:///"


def ruta_de(database_url: str) -> str:
    """Ruta absoluta de la SQLite, o la URL tal cual si no es SQLite."""
    if not database_url.startswith(_PREFIJO):
        return database_url
    # sqlite:///relativa.db -> relativa al cwd;  sqlite:////abs/oluta.db -> ya absoluta.
    return os.path.abspath(database_url[len(_PREFIJO):])


def anunciar(settings) -> None:
    red = os.environ.get("APP_NETWORK") or "sin APP_NETWORK (¡valores de devnet!)"
    print(f"· red: {red}\n· base: {ruta_de(settings.database_url)}", file=sys.stderr)
