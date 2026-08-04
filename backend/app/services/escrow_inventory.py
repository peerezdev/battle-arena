"""Inventario COMPARTIDO de wallets de escrow, en su propia base.

Por qué existe
--------------
Una wallet de Privy es la misma en todas las cadenas: mismo par de claves, misma dirección en
devnet y en mainnet. Lo que cambia por red es lo que tiene DENTRO. Hasta ahora el pool
(`escrow_wallets`) mezclaba las dos cosas en la base de cada red, con dos consecuencias:

  · mainnet arrancaba con el pool vacío y creaba wallets nuevas teniendo 79 ya hechas sin usar;
  · y la única lista de cuáles son escrows vivía en la base de DEVNET, así que mainnet dependía
    de una base de pruebas que cualquiera puede borrar.

Aquí se parte en dos:

  · IDENTIDAD  (esta tabla, compartida)  → qué wallets tenemos y su id de Privy para firmar.
  · ESTADO     (`escrow_wallets`, por red) → si está libre, en uso o retenida EN ESA CADENA.

Esa separación es la que permite que la misma wallet esté ocupada en devnet y libre en mainnet a
la vez sin que sea un error: describen cadenas distintas.

Cómo se activa
--------------
`ESCROW_INVENTORY_URL` vacío (por defecto) → todo se comporta como antes, sin inventario. Solo
cuando se configura entra el paso nuevo. Así una instalación que no lo quiera no cambia de
comportamiento por actualizar.

**La ruta tiene que ser ABSOLUTA.** Es el mismo fallo que motivó `scripts/_destino.py`: una ruta
relativa de SQLite se resuelve contra el directorio de trabajo, así que el backend y un script
lanzado desde otro sitio escribirían en inventarios distintos sin dar ningún error. Aquí sería
peor que en un script: dos inventarios divergentes reparten la misma wallet a dos partidas.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, String, create_engine, select
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

logger = logging.getLogger(__name__)

Base = declarative_base()


class EscrowInventory(Base):
    """Una wallet de escrow que existe en Privy. Sin estado: el estado es por red."""
    __tablename__ = "escrow_inventory"
    address = Column(String, primary_key=True)
    wallet_id = Column(String, nullable=False)   # id de Privy, lo que hace falta para firmar
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


_factory = None
_url_cacheada: Optional[str] = None


def _sesiones():
    """Fábrica de sesiones del inventario, o None si no está configurado.

    Se construye una sola vez y se cachea junto a su URL: si la configuración cambia en caliente
    (los tests lo hacen), se rehace en vez de servir una base vieja.
    """
    global _factory, _url_cacheada
    url = (get_settings().escrow_inventory_url or "").strip()
    if not url:
        return None
    if _factory is None or _url_cacheada != url:
        engine = create_engine(url, future=True)
        Base.metadata.create_all(engine)
        _factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
        _url_cacheada = url
    return _factory


def activo() -> bool:
    return _sesiones() is not None


def registrar(address: str, wallet_id: str) -> None:
    """Da de alta una wallet en el inventario. Idempotente: repetirlo no duplica ni falla.

    Se llama al crear una wallet nueva, para que la red que la estrena se la deje disponible a la
    otra en vez de guardársela.
    """
    f = _sesiones()
    if f is None:
        return
    with f() as s:
        if s.get(EscrowInventory, address) is None:
            s.add(EscrowInventory(address=address, wallet_id=wallet_id))
            s.commit()
            logger.info("inventario: alta de %s", address)


def sin_estrenar(usadas: set) -> Optional[dict]:
    """Una wallet del inventario que esta red todavía no ha usado nunca, o None.

    `usadas` son las direcciones que ya tienen fila de estado aquí. Se pide como parámetro y no se
    consulta desde dentro porque el estado vive en OTRA base: este módulo no la conoce ni debe.
    """
    f = _sesiones()
    if f is None:
        return None
    with f() as s:
        fila = s.execute(
            select(EscrowInventory).where(EscrowInventory.address.notin_(usadas or [""]))
            .order_by(EscrowInventory.created_at).limit(1)
        ).scalars().first()
        if fila is None:
            return None
        return {"id": fila.wallet_id, "address": fila.address}


def todas() -> list:
    f = _sesiones()
    if f is None:
        return []
    with f() as s:
        return [{"address": w.address, "wallet_id": w.wallet_id}
                for w in s.execute(select(EscrowInventory)).scalars().all()]
