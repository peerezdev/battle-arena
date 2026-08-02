import pytest
from app.db import make_engine, make_session_factory, init_db
from app.services import emotes


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


def test_catalog_has_codes_and_urls():
    cat = emotes.catalog()
    assert {e["code"] for e in cat} >= {"charmander", "bulbasaur", "squirtle"}
    assert all(e["video_url"].startswith("/") for e in cat)


def test_read_grants_defaults_on_first_access(session):
    out = emotes.read_user_emotes(session, "WALLET_A")
    assert set(out["owned"]) == set(emotes.DEFAULT_EMOTES)
    # slots default to the first MAX_SLOTS owned, in catalog order
    assert out["slots"] == out["owned"][:emotes.MAX_SLOTS]


def test_set_slots_keeps_only_owned(session):
    emotes.read_user_emotes(session, "A")  # grants defaults
    elegidos = ["squirtle", "charmander", "bulbasaur"]
    out = emotes.set_emote_slots(session, "A", ["squirtle", "not_owned", "charmander", "bulbasaur"])
    # Lo elegido va primero y en orden; "not_owned" no aparece ni por el relleno, que solo
    # reparte emotes que el usuario tiene.
    assert out["slots"][:3] == elegidos
    assert "not_owned" not in out["slots"]
    # persists on re-read
    assert emotes.read_user_emotes(session, "A")["slots"][:3] == elegidos


def test_slots_guardados_se_rellenan_hasta_el_tope(session):
    """Este era el bug: quien ya tuviera slots guardados no veía los huecos nuevos.

    El usuario tenía 3 códigos en `emote_slots` de cuando el tope era 3. Subirlo a 4 no le añadía
    ninguno porque solo se rellenaba la lista VACÍA, así que seguía viendo 3 botones. Ahora se
    completa hasta el tope respetando primero su orden.
    """
    emotes.read_user_emotes(session, "VIEJO")
    tres = emotes.DEFAULT_EMOTES[:3]
    emotes.set_emote_slots(session, "VIEJO", tres)

    out = emotes.read_user_emotes(session, "VIEJO")
    assert len(out["slots"]) == emotes.MAX_SLOTS
    assert out["slots"][:3] == tres                    # lo que eligió va primero
    assert len(set(out["slots"])) == len(out["slots"])  # sin repetidos
    assert all(c in out["owned"] for c in out["slots"])


def test_relleno_no_pasa_del_tope_aunque_no_haya_de_sobra(session):
    # Con menos emotes que huecos se queda con los que haya, sin inventarse ninguno.
    emotes.read_user_emotes(session, "POCOS")
    out = emotes.read_user_emotes(session, "POCOS")
    assert len(out["slots"]) == min(emotes.MAX_SLOTS, len(out["owned"]))


def test_max_slots_no_se_mueve_sin_tocar_el_frontend():
    """El tope vive en dos sitios: aquí y en src/ui/emotes/EmoteBar.tsx.

    Si el backend baja por debajo del frontend, la barra deja fijar un emote que el servidor
    descarta al guardar, y el usuario ve cómo desaparece solo. Los otros tests de este fichero
    comparan contra `emotes.MAX_SLOTS`, así que pasan con cualquier valor: este fija el número
    para que cambiarlo obligue a mirar el otro lado.
    """
    assert emotes.MAX_SLOTS == 4


def test_set_slots_caps_at_max_slots(session):
    # Con más códigos que huecos se queda con los primeros. La barra rápida enseña MAX_SLOTS
    # botones: si el backend guardara más, el usuario tendría emotes fijados que no vería.
    emotes.read_user_emotes(session, "CAP")
    pedidos = emotes.DEFAULT_EMOTES[: emotes.MAX_SLOTS + 2]
    assert len(pedidos) > emotes.MAX_SLOTS, "el catálogo tiene que traer más emotes que huecos"
    out = emotes.set_emote_slots(session, "CAP", pedidos)
    assert out["slots"] == pedidos[: emotes.MAX_SLOTS]


def test_set_slots_dedupes_and_drops_unowned(session):
    emotes.read_user_emotes(session, "B")
    out = emotes.set_emote_slots(session, "B", ["charmander", "charmander", "ghost"])
    assert out["slots"][0] == "charmander"          # una sola vez, pese a venir repetido
    assert out["slots"].count("charmander") == 1
    assert "ghost" not in out["slots"]


def test_owns(session):
    emotes.read_user_emotes(session, "C")
    assert emotes.owns(session, "C", "charmander") is True
    assert emotes.owns(session, "C", "nope") is False
