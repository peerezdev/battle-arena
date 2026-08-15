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
    # Orden exacto, no sorted(): el orden lo da el índice y es parte de lo que se protege.
    assert [u["alias"] for u in buscar_usuarios(session, "AN")] == ["ana", "anabel"]


def test_el_prefijo_NO_encuentra_por_el_medio(session):
    """Es el precio aceptado de que la consulta use el índice.

    Buscar "contiene" obliga a recorrer la tabla entera en cada pulsación, y este backend corre en
    un proceso: es la forma del incidente que documenta src/ui/useAliases.ts.
    """
    assert [u["alias"] for u in buscar_usuarios(session, "ana")] == ["ana", "anabel"]
    assert "juanana" not in [u["alias"] for u in buscar_usuarios(session, "ana")]


def test_busca_tambien_por_principio_de_wallet(session):
    """Quien no tiene alias solo se puede encontrar por su wallet, y esa búsqueda tampoco
    distingue mayúsculas: las wallets son base58 y nadie recuerda dónde iban."""
    assert [u["wallet"] for u in buscar_usuarios(session, "We")] == ["We5"]
    assert [u["wallet"] for u in buscar_usuarios(session, "we")] == ["We5"]


def test_sin_consulta_devuelve_a_todos_ordenados(session):
    """Sin `q`, solo quien TIENE alias (a quien no lo tiene se le encuentra por wallet, no aquí),
    en el orden real que da el índice — no solo la longitud."""
    out = buscar_usuarios(session, "")
    assert [u["alias"] for u in out] == ["ana", "anabel", "Bea", "juanana"]


def test_sin_consulta_no_incluye_a_quien_no_tiene_alias(session):
    out = buscar_usuarios(session, "")
    assert "We5" not in [u["wallet"] for u in out]


def test_el_tope_se_respeta_aunque_se_pida_mas():
    """La fixture compartida solo tiene 5 usuarios (todos caben en el tope), así que aquí se
    monta una con más de 8 para que el recorte tenga algo real que recortar: sin él, limit=999
    devolvería 999 y el test seguiría en verde por el motivo equivocado."""
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        for i in range(12):
            s.add(User(wallet=f"W{i}", alias=f"user{i:02d}", elo=1200, games_played=0))
        s.commit()
        assert len(buscar_usuarios(s, "", limit=999)) == 8


def test_la_consulta_usa_el_indice(session):
    """Si esto falla, la búsqueda recorre la tabla entera y hay que arreglarlo ANTES de subir.

    Captura el SQL que EMITE `buscar_usuarios` de verdad (no uno parecido escrito a mano: eso
    dejaba pasar mutaciones a LIKE o sin tope sin que ningún test se enterara) y le pide a SQLite
    su plan real, para los dos caminos que existen: con prefijo y sin consulta.
    """
    from sqlalchemy import event

    capturado = []

    def _capturar(conn, cursor, statement, parameters, context, executemany):
        if statement.strip().upper().startswith("SELECT"):
            capturado.append((statement, parameters))

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", _capturar)
    try:
        buscar_usuarios(session, "an")
        buscar_usuarios(session, "")
    finally:
        event.remove(engine, "before_cursor_execute", _capturar)

    assert len(capturado) == 2, capturado
    cur = session.connection().connection.dbapi_connection.cursor()
    etiquetas = ["con prefijo", "sin consulta"]
    for etiqueta, (statement, parameters) in zip(etiquetas, capturado):
        cur.execute(f"EXPLAIN QUERY PLAN {statement}", parameters)
        detalles = [str(row) for row in cur.fetchall()]
        # "SCAN users" a secas (sin "USING INDEX"/"USING COVERING INDEX" detrás) es SQLite leyendo
        # la tabla entera fila a fila; "SCAN users USING INDEX ..." recorre el índice, no la tabla.
        escaneo_de_tabla = any(
            "SCAN users" in d and "USING INDEX" not in d and "USING COVERING INDEX" not in d
            for d in detalles
        )
        assert not escaneo_de_tabla, (etiqueta, statement, detalles)
        if etiqueta == "sin consulta":
            # No basta con "sin SCAN de tabla": un SCAN DE ÍNDICE completo también arranca por el
            # PRINCIPIO, que es donde SQLite ordena los NULL — hay que pagar por cada usuario SIN
            # alias antes de llegar a las 8 filas buenas. Solo un SEARCH acotado (la cota `> ""`)
            # prueba que arranca ya después de los NULL. Si esto vuelve a `isnot(None)`, el plan
            # sigue sin tener "SCAN users" pelado y el assert de arriba no lo pillaría — por eso
            # hace falta este, más estricto.
            assert any("SEARCH users USING INDEX ux_users_alias_lower" in d for d in detalles), \
                (etiqueta, detalles)
