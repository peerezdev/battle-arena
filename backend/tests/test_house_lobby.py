"""Lobbies de la casa: una Battle Royale siempre abierta, sin que la casa apueste.

Crear una partida SIEMPRE había implicado que el creador entra y paga su buy-in. Para un lobby
automático eso significaría que la casa pone 70 $ cada vez que abre uno. Aquí se abre vacío: sin
creador, sin cobro, y el primer jugador que entra ocupa la primera plaza.
"""
import pytest

from app.db import init_db, make_engine, make_session_factory
from app.models import BattlePlayer, PackBattle
from app.services.flags import clear_flag, set_flag
from app.services.house_lobby import (FLAG, PLAZAS, configuracion, es_de_la_casa,
                                      hace_falta_una, maquina_configurada)
from app.services.pack_lobby import cancel_battle, create_battle, join_battle, LobbyError


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s


def _casa(session, machine="pokemon_25"):
    return create_battle(session, None, None, machine_code=machine,
                         price=25_000_000, max_players=5, mode="royale")


# ── el lobby se abre vacío ────────────────────────────────────────────────────

def test_se_crea_sin_jugadores_y_sin_creador(session):
    b = _casa(session)
    assert b.creator_wallet is None
    assert session.query(BattlePlayer).filter_by(battle_id=b.id).count() == 0
    assert es_de_la_casa(b)


def test_el_primer_jugador_ocupa_la_primera_plaza(session):
    b = _casa(session)
    _, lleno = join_battle(session, b.id, "ANA", "wid-ana")
    assert lleno is False
    jugadores = session.query(BattlePlayer).filter_by(battle_id=b.id).all()
    assert [p.player_wallet for p in jugadores] == ["ANA"]


def test_se_llena_con_las_cinco_plazas_libres(session):
    """Sin creador dentro, caben 5 jugadores de verdad — no 4."""
    b = _casa(session)
    for i in range(4):
        _, lleno = join_battle(session, b.id, f"W{i}", f"wid{i}")
        assert lleno is False
    _, lleno = join_battle(session, b.id, "W4", "wid4")
    assert lleno is True
    assert session.get(PackBattle, b.id).status == "running"


def test_una_partida_normal_sigue_metiendo_al_creador(session):
    b = create_battle(session, "YO", "wid-yo", machine_code="pokemon_25",
                      price=25_000_000, max_players=5, mode="royale")
    assert b.creator_wallet == "YO"
    assert session.query(BattlePlayer).filter_by(battle_id=b.id).count() == 1
    assert not es_de_la_casa(b)


def test_nadie_puede_cancelar_un_lobby_de_la_casa_desde_la_interfaz(session):
    """No tiene creador, así que la comprobación de "solo el creador" no la pasa nadie. Se retira
    desde consola, que es lo que impide que un jugador cierre la sala de todos."""
    b = _casa(session)
    with pytest.raises(LobbyError):
        cancel_battle(session, b.id, "ANA")


# ── cuándo hace falta abrir uno ───────────────────────────────────────────────

def test_hace_falta_si_no_hay_ninguna(session):
    assert hace_falta_una(session, "pokemon_25") is True


@pytest.mark.parametrize("estado", ["lobby", "running"])
def test_no_hace_falta_si_ya_hay_una_esperando_o_en_juego(session, estado):
    b = _casa(session)
    b.status = estado
    session.commit()
    assert hace_falta_una(session, "pokemon_25") is False


@pytest.mark.parametrize("estado", ["settled", "voided", "cancelled"])
def test_una_terminada_no_cuenta(session, estado):
    b = _casa(session)
    b.status = estado
    session.commit()
    assert hace_falta_una(session, "pokemon_25") is True


def test_otra_maquina_no_cuenta(session):
    _casa(session, machine="pokemon_50")
    assert hace_falta_una(session, "pokemon_25") is True


def test_una_pack_battle_no_cuenta(session):
    create_battle(session, "YO", "wid", machine_code="pokemon_25",
                  price=25_000_000, max_players=4, mode="pack")
    assert hace_falta_una(session, "pokemon_25") is True


# ── el interruptor ────────────────────────────────────────────────────────────

def test_apagado_por_defecto(session):
    assert maquina_configurada(session) is None


def test_encendido_devuelve_la_maquina(session):
    set_flag(session, FLAG, "pokemon_25")
    assert maquina_configurada(session) == "pokemon_25"


def test_apagarlo_lo_deja_en_none(session):
    set_flag(session, FLAG, "pokemon_25")
    assert clear_flag(session, FLAG) is True
    assert maquina_configurada(session) is None


def test_un_valor_vacio_cuenta_como_apagado(session):
    """Encender sin decir máquina no puede significar "cualquiera": sería abrir salas al azar."""
    set_flag(session, FLAG, "   ")
    assert maquina_configurada(session) is None


# ── el tamaño de la sala también se cambia desde consola ─────────────────────
# Si las plazas viven en el código, tocarlas exige desplegar y reiniciar — justo lo que el
# interruptor viene a evitar. El valor del flag es `maquina` o `maquina:plazas`.

def test_por_defecto_son_diez_plazas(session):
    set_flag(session, FLAG, "pokemon_25")
    assert configuracion(session) == ("pokemon_25", 10)
    assert PLAZAS == 10


def test_las_plazas_se_pueden_fijar_en_el_flag(session):
    set_flag(session, FLAG, "pokemon_25:7")
    assert configuracion(session) == ("pokemon_25", 7)


@pytest.mark.parametrize("valor", ["pokemon_25:4", "pokemon_25:11", "pokemon_25:0"])
def test_unas_plazas_fuera_de_los_limites_del_modo_caen_al_defecto(session, valor):
    """Battle Royale es de 5 a 10. Un número imposible no puede apagar el auto-royale: se avisa y
    se abre del tamaño de siempre."""
    set_flag(session, FLAG, valor)
    assert configuracion(session) == ("pokemon_25", PLAZAS)


def test_unas_plazas_ilegibles_tampoco_apagan_nada(session):
    set_flag(session, FLAG, "pokemon_25:muchas")
    assert configuracion(session) == ("pokemon_25", PLAZAS)


def test_apagado_sigue_devolviendo_none(session):
    assert configuracion(session) is None
    set_flag(session, FLAG, ":8")          # plazas sin máquina no es nada
    assert configuracion(session) is None
