"""Rachas por rareza: cuántas tiradas lleva sin salir y cuánto suele tardar."""
from datetime import datetime, timedelta, timezone

from app.services.tier_gaps import rachas_por_tier
from app.services.winners_store import guardar

AHORA = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


def sembrar(s, tiers, machine="pokemon_50"):
    """`tiers` de MÁS ANTIGUA a más reciente, que es como ocurren."""
    guardar(s, [{"nft_address": f"{machine}-{i}", "machine": machine, "prize_tier": t,
                 "insured_value": 40.0, "weighted_insured_value": None, "memo": None,
                 "winner": "W", "created_at": AHORA - timedelta(minutes=len(tiers) - i),
                 "source": "live"} for i, t in enumerate(tiers)])


def de(filas, nombre):
    return next(f for f in filas if f["tier"] == nombre)


def test_racha_cero_si_salio_en_la_ultima(Session):
    with Session() as s:
        sembrar(s, [4, 4, 2])                     # la última es Rare
        assert de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Rare")["current"] == 0


def test_la_racha_cuenta_las_tiradas_desde_su_ultima_aparicion(Session):
    with Session() as s:
        sembrar(s, [2, 4, 4, 4])                  # Rare salió y luego 3 Commons
        assert de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Rare")["current"] == 3


def test_la_media_es_el_espacio_entre_apariciones(Session):
    """Sin la media, un "39" no significa nada: puede ser normal o rarísimo según la máquina."""
    with Session() as s:
        # Epic 1 de cada 5: 20 tiradas, 4 epics → (20−4)/4 = 4.0 de espacio medio.
        sembrar(s, [1 if i % 5 == 0 else 4 for i in range(20)])
        assert de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Epic")["average"] == 4.0


def test_la_media_se_MIDE_no_se_asume_de_las_odds(Session):
    """Converge a (1−p)/p, así que si CC publicara unas odds y sirviera otras, este número lo
    delataría. Por eso se calcula de lo observado y no de las odds declaradas."""
    with Session() as s:
        sembrar(s, [2 if i % 25 == 0 else 4 for i in range(100)])   # p real = 0.04
        media = de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Rare")["average"]
        assert 22 <= media <= 26                                     # (1−0.04)/0.04 = 24


def test_una_rareza_que_no_salio_devuelve_None_y_no_el_tamaño(Session):
    """Redondear a la muestra daría por medido algo que no se ha medido: la racha es MAYOR que n."""
    with Session() as s:
        sembrar(s, [4] * 30)
        epic = de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Epic")
        assert epic["current"] is None and epic["average"] is None
        assert epic["seen"] == 0 and epic["sample"] == 30
        assert epic["cold"] is False        # sin medida no se puede decir que venga fría


def test_fria_es_ir_por_encima_de_su_propio_ritmo(Session):
    with Session() as s:
        # Rare cada 5 durante un rato y luego 20 tiradas sin ella.
        sembrar(s, [2 if i % 5 == 0 else 4 for i in range(30)] + [4] * 20)
        rare = de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Rare")
        assert rare["current"] > rare["average"] and rare["cold"] is True


def test_no_esta_fria_si_va_a_su_ritmo(Session):
    with Session() as s:
        sembrar(s, [2 if i % 5 == 0 else 4 for i in range(30)])
        assert de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Rare")["cold"] is False


def test_solo_mira_su_maquina(Session):
    with Session() as s:
        sembrar(s, [1, 1, 1], machine="otra")
        sembrar(s, [4] * 10)
        assert de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Epic")["seen"] == 0


def test_sin_datos_devuelve_las_cuatro_rarezas_vacias(Session):
    with Session() as s:
        filas = rachas_por_tier(s, "vacia", ahora=AHORA)
        assert [f["tier"] for f in filas] == ["Common", "Uncommon", "Rare", "Epic"]
        assert all(f["current"] is None for f in filas)


def test_lo_de_fuera_de_la_ventana_no_cuenta(Session):
    with Session() as s:
        sembrar(s, [2])                                   # dentro
        guardar(s, [{"nft_address": "viejo", "machine": "pokemon_50", "prize_tier": 1,
                     "insured_value": 40.0, "weighted_insured_value": None, "memo": None,
                     "winner": "W", "created_at": AHORA - timedelta(hours=60), "source": "live"}])
        assert de(rachas_por_tier(s, "pokemon_50", ahora=AHORA), "Epic")["seen"] == 0
