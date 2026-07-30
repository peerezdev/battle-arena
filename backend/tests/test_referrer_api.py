"""Endpoints del panel del referidor: resumen y claim.

Lo que estos tests protegen es el camino del dinero. En particular: que un claim no pueda pagar dos
veces, que por debajo del mínimo no se pague, y que **sin wallet de payouts configurada no se pague
nada** — esa wallet está por decidir y no puede colarse el operador por defecto.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.chain.mock import MockChainSource
from app.db import init_db, make_session_factory
from app.main import create_app
from app.models import ReferralCode, ReferralEarning
from app.privy import PrivyVerifier

from tests.test_pack_lobby_api import (APP_ID, DUMMY_MINT, DUMMY_RPC, _auth_headers, _make_es256)

WALLET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
WALLET_ID = "privy-wallet-id-ref"


class _Signer:
    """Firma cualquier cosa. Los tests que llegan hasta aquí solo comprueban el flujo."""
    def __init__(self, falla=False):
        self.falla = falla

    async def sign_solana(self, wallet_id, tx):
        return f"signed-{tx}"


def _client(payout_wallet=("payout-wid", "So11111111111111111111111111111111111111112"),
            claim_min=5_000_000):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    init_db(engine)
    Session = make_session_factory(engine)
    priv = _make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    app = create_app(Session, MockChainSource(), privy=privy, privy_signer=_Signer(),
                     solana_rpc_url=DUMMY_RPC, cc_usdc_mint=DUMMY_MINT,
                     referral_payout_wallet_id=payout_wallet[0],
                     referral_payout_address=payout_wallet[1],
                     referral_claim_min_base_units=claim_min)
    return TestClient(app), Session, priv


def _hdrs(priv):
    return _auth_headers(priv, WALLET, WALLET_ID)


def _con_ganancias(Session, importe):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet=WALLET, rake_share_pct=0.25))
    s.add(ReferralEarning(code="C", referrer_wallet=WALLET, referred_wallet="A",
                          battle_id="b1", amount_base_units=importe))
    s.commit()


def test_endpoints_exigen_auth():
    c, _, _ = _client()
    assert c.get("/users/me/referrer").status_code in (401, 403, 503)
    assert c.post("/users/me/referrer/claim").status_code in (401, 403, 503)


def test_resumen_sin_codigos_devuelve_ceros_no_404():
    """El frontend decide con una sola llamada si enseña el panel."""
    c, _, priv = _client()
    r = c.get("/users/me/referrer", headers=_hdrs(priv))
    assert r.status_code == 200
    assert r.json() == {"codes": [], "unclaimed_base_units": 0, "lifetime_base_units": 0,
                        "claim_min_base_units": 5_000_000}


def test_resumen_con_ganancias():
    c, Session, priv = _client()
    _con_ganancias(Session, 7_000_000)
    body = c.get("/users/me/referrer", headers=_hdrs(priv)).json()
    assert body["unclaimed_base_units"] == 7_000_000
    assert body["codes"][0]["code"] == "C"


def test_por_debajo_del_minimo_no_se_paga():
    c, Session, priv = _client()
    _con_ganancias(Session, 4_999_999)
    r = c.post("/users/me/referrer/claim", headers=_hdrs(priv))
    assert r.status_code == 409 and r.json()["detail"] == "below_minimum"


def test_sin_wallet_de_payouts_configurada_no_se_paga():
    """La decisión pendiente tiene que verse. Antes de que exista esa wallet, un claim por encima
    del mínimo NO puede tirar del operador ni de ninguna otra: responde 503 y el dinero sigue
    reclamable."""
    c, Session, priv = _client(payout_wallet=("", ""))
    _con_ganancias(Session, 9_000_000)
    r = c.post("/users/me/referrer/claim", headers=_hdrs(priv))
    assert r.status_code == 503 and r.json()["detail"] == "payouts_unavailable"
    # y el saldo sigue intacto
    assert c.get("/users/me/referrer", headers=_hdrs(priv)).json()["unclaimed_base_units"] == 9_000_000


@pytest.mark.parametrize("fallo", [False, True])
def test_claim_feliz_y_claim_fallido(monkeypatch, fallo):
    """Si el pago sale: earnings marcadas y unclaimed a cero. Si falla: el dinero sigue reclamable
    — nunca se marca algo como cobrado que no llegó a pagarse."""
    c, Session, priv = _client()
    _con_ganancias(Session, 9_000_000)

    async def _bh(*a, **k):
        return "11111111111111111111111111111111"

    async def _withdraw(*a, **k):
        if fallo:
            raise RuntimeError("la red dijo que no")
        return "SIG-OK"

    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)
    monkeypatch.setattr("app.main.withdraw_usdc", _withdraw)

    r = c.post("/users/me/referrer/claim", headers=_hdrs(priv))
    restante = c.get("/users/me/referrer", headers=_hdrs(priv)).json()["unclaimed_base_units"]
    if fallo:
        assert r.status_code == 502
        assert restante == 9_000_000, "un pago fallido no puede evaporar el dinero"
    else:
        assert r.status_code == 200
        assert r.json() == {"signature": "SIG-OK", "amount_base_units": 9_000_000}
        assert restante == 0


def test_un_segundo_claim_no_vuelve_a_pagar(monkeypatch):
    c, Session, priv = _client()
    _con_ganancias(Session, 9_000_000)
    pagos = []

    async def _bh(*a, **k):
        return "11111111111111111111111111111111"

    async def _withdraw(*a, **k):
        pagos.append(1)
        return "SIG-OK"

    monkeypatch.setattr("app.main.fetch_latest_blockhash", _bh)
    monkeypatch.setattr("app.main.withdraw_usdc", _withdraw)

    assert c.post("/users/me/referrer/claim", headers=_hdrs(priv)).status_code == 200
    segundo = c.post("/users/me/referrer/claim", headers=_hdrs(priv))
    assert segundo.status_code == 409          # ya no queda nada por encima del mínimo
    assert len(pagos) == 1
