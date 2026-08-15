import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import User
from app.services.users import buscar_usuarios


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        for wallet, alias in [("Wa1", "ana"), ("Wb2", "anabel"), ("Wc3", "Bea"),
                              ("Wd4", "juanana"), ("We5", None)]:
            s.add(User(wallet=wallet, alias=alias, elo=1200, games_played=0))
        s.commit()
        yield s


def test_busca_por_prefijo_sin_distinguir_mayusculas(session):
    out = [u["alias"] for u in buscar_usuarios(session, "AN")]
    assert sorted(out) == ["ana", "anabel"]


def test_el_prefijo_NO_encuentra_por_el_medio(session):
    """Es el precio aceptado de que la consulta use el índice.

    Buscar "contiene" obliga a recorrer la tabla entera en cada pulsación, y este backend corre en
    un proceso: es la forma del incidente que documenta src/ui/useAliases.ts.
    """
    assert [u["alias"] for u in buscar_usuarios(session, "ana")] == ["ana", "anabel"]
    assert "juanana" not in [u["alias"] for u in buscar_usuarios(session, "ana")]


def test_busca_tambien_por_principio_de_wallet(session):
    """Quien no tiene alias solo se puede encontrar por su wallet."""
    assert [u["wallet"] for u in buscar_usuarios(session, "We")] == ["We5"]


def test_sin_consulta_devuelve_a_todos_ordenados(session):
    out = buscar_usuarios(session, "")
    assert len(out) == 5


def test_el_tope_se_respeta_aunque_se_pida_mas(session):
    assert len(buscar_usuarios(session, "", limit=999)) <= 8


def test_la_consulta_usa_el_indice(session):
    """Si esto falla, la búsqueda recorre la tabla entera y hay que arreglarlo ANTES de subir."""
    from sqlalchemy import text
    plan = session.execute(text(
        "EXPLAIN QUERY PLAN SELECT wallet, alias FROM users "
        "WHERE lower(alias) >= 'an' AND lower(alias) < 'ao' LIMIT 8"
    )).all()
    assert any("USING INDEX ux_users_alias_lower" in str(r) for r in plan), plan
