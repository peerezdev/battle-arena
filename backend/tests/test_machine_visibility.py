"""Apagar máquinas de gacha a mano.

Lo que estos tests fijan no es tanto que ocultar funcione, sino DÓNDE se aplica: ocultar toca el
catálogo y el precio (o sea, lo que se puede empezar), pero NO las consultas por código, que sirven
para nombrar cosas ya ocurridas. Si se filtrase también ahí, apagar una máquina borraría el nombre
de las partidas que ya se jugaron con ella.
"""
import pytest

from app.db import make_engine, make_session_factory, init_db
from app.models import HiddenMachine
from app.services import machine_visibility as mv

CATALOGO = [
    {"code": "pokemon_50", "name": "PKMN 50", "price": 50},
    {"code": "sweet_99", "name": "Sweet 99", "price": 99},
    {"code": "onepiece_250", "name": "OP 250", "price": 250},
]


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s


def _codigos(ms):
    return [m["code"] for m in ms]


def test_sin_nada_apagado_se_ven_todas(session):
    assert _codigos(mv.visible(session, CATALOGO)) == ["pokemon_50", "sweet_99", "onepiece_250"]


def test_una_apagada_desaparece_del_catalogo(session):
    mv.hide(session, "sweet_99", reason="miniatura rota en CC")
    assert _codigos(mv.visible(session, CATALOGO)) == ["pokemon_50", "onepiece_250"]


def test_encenderla_la_devuelve(session):
    mv.hide(session, "sweet_99")
    assert mv.show(session, "sweet_99") is True
    assert _codigos(mv.visible(session, CATALOGO)) == ["pokemon_50", "sweet_99", "onepiece_250"]


def test_encender_una_que_no_estaba_apagada_no_falla(session):
    assert mv.show(session, "no_existe") is False


def test_apagar_dos_veces_actualiza_el_motivo_sin_duplicar(session):
    mv.hide(session, "sweet_99", reason="primera")
    mv.hide(session, "sweet_99", reason="segunda")
    filas = session.query(HiddenMachine).all()
    assert len(filas) == 1 and filas[0].reason == "segunda"


def test_apagar_un_codigo_que_no_esta_en_el_catalogo_no_estorba(session):
    """Se permite a propósito: así se puede dejar apagada de antemano una que CC aún no sirve."""
    mv.hide(session, "todavia_no_existe")
    assert _codigos(mv.visible(session, CATALOGO)) == ["pokemon_50", "sweet_99", "onepiece_250"]


def test_si_la_base_falla_se_ofrecen_todas(session):
    """Quedarse sin catálogo es mucho peor que enseñar de más: ante un fallo, no se filtra."""
    class _Rota:
        def query(self, *_a, **_k):
            raise RuntimeError("base caída")
    assert mv.hidden_codes(_Rota()) == set()
    assert _codigos(mv.visible(_Rota(), CATALOGO)) == ["pokemon_50", "sweet_99", "onepiece_250"]
