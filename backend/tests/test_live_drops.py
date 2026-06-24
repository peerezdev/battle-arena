import asyncio

import respx
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import app.main as main
from app.main import create_app
from app.db import make_session_factory, init_db
from app.privy import PrivyVerifier
from app.chain.mock import MockChainSource
from app.services.gacha import GachaService
from app.services.users import get_or_create_user, set_alias

from tests.conftest import make_es256, privy_auth_headers

BASE = "https://dev-gacha.collectorcrypt.com"
APP_ID = "app123"
WALLET_A = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"


def _client(alias=None):
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    sf = make_session_factory(engine)
    if alias is not None:
        with sf() as s:
            get_or_create_user(s, WALLET_A, 1200)
            set_alias(s, WALLET_A, alias)
            s.commit()
    priv = make_es256()
    privy = PrivyVerifier(app_id=APP_ID, key_resolver=lambda kid: priv.public_key())
    gacha = GachaService(base_url=BASE, api_key="k")
    app = create_app(sf, MockChainSource(), elo_start=1200, elo_k=32,
                     gacha=gacha, gacha_rate_limit=100, privy=privy)
    return TestClient(app), priv


def _hdrs(priv, wallet):
    return privy_auth_headers(priv, APP_ID, wallet)


def _mock_open(monkeypatch, *, captured, sleeps, tasks):
    """Common monkeypatching: capture broadcast, record sleep durations
    (skipping the real 30s wait), and collect scheduled background tasks so the
    test can drive them deterministically."""
    real_sleep = asyncio.sleep

    async def fake_sleep(secs):
        sleeps.append(secs)
        await real_sleep(0)

    async def fake_broadcast(self, msg):
        captured.append(msg)

    class _FakeTask:
        """Captures the scheduled coroutine instead of running it on the
        request's (soon-closed) event loop, so the test can drive it itself."""
        def __init__(self, coro):
            self.coro = coro

    def fake_create_task(coro, *a, **kw):
        t = _FakeTask(coro)
        tasks.append(t)
        return t

    monkeypatch.setattr(main.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(main.asyncio, "create_task", fake_create_task)
    monkeypatch.setattr(main.ConnectionManager, "broadcast", fake_broadcast)
    async def _high_bal(*a, **kw):
        return 100_000_000
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_bal)


def _drain(tasks):
    loop = asyncio.new_event_loop()
    try:
        for t in tasks:
            loop.run_until_complete(t.coro)
    finally:
        loop.close()


def _setup_routes():
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "m-drop", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "success": True, "nft_address": "Mint" + "1" * 40, "rarity": "Rare",
        "nftWon": {"content": {"metadata": {"name": "Pika"}},
                   "image": "https://x/p.png", "insured_value": 123.5}}))


@respx.mock
def test_open_pack_schedules_delayed_drop_with_username(monkeypatch):
    captured: list = []
    sleeps: list = []
    tasks: list = []
    _mock_open(monkeypatch, captured=captured, sleeps=sleeps, tasks=tasks)
    _setup_routes()
    c, priv = _client(alias="neo")
    hdrs = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    r = c.post("/gacha/open-pack", json={"memo": "m-drop"}, headers=hdrs)
    assert r.status_code == 200

    # The delayed broadcast task must be allowed to run.
    _drain(tasks)

    assert sleeps == [main.LIVE_DROP_DELAY_S]
    assert len(captured) == 1
    msg = captured[0]
    assert msg["type"] == "drop"
    assert msg["wallet"] == WALLET_A
    assert msg["username"] == "neo"
    assert msg["name"] == "Pika"
    assert msg["valueUsd"] == 123.5
    assert msg["rarity"] == "Rare"
    assert msg["image"] == "https://x/p.png"
    assert isinstance(msg["ts"], int)


@respx.mock
def test_drop_username_null_when_no_alias(monkeypatch):
    captured: list = []
    sleeps: list = []
    tasks: list = []
    _mock_open(monkeypatch, captured=captured, sleeps=sleeps, tasks=tasks)
    _setup_routes()
    c, priv = _client(alias=None)
    hdrs = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    c.post("/gacha/open-pack", json={"memo": "m-drop"}, headers=hdrs)

    _drain(tasks)

    assert len(captured) == 1
    assert captured[0]["username"] is None


@respx.mock
def test_pending_open_does_not_broadcast(monkeypatch):
    captured: list = []
    sleeps: list = []
    tasks: list = []
    _mock_open(monkeypatch, captured=captured, sleeps=sleeps, tasks=tasks)
    respx.get(f"{BASE}/api/machines").mock(return_value=Response(200, json={"machines": [
        {"code": "pokemon_50", "price": 50, "available": True}]}))
    respx.get(f"{BASE}/api/status").mock(return_value=Response(200, json={"gachas": []}))
    respx.post(f"{BASE}/api/generatePack").mock(
        return_value=Response(200, json={"memo": "m-pend", "transaction": "dA=="}))
    respx.post(f"{BASE}/api/openPack").mock(
        return_value=Response(200, json={"code": "WAITING_FOR_WEBHOOK"}))
    c, priv = _client(alias="neo")
    hdrs = _hdrs(priv, WALLET_A)
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=hdrs)
    c.post("/gacha/open-pack", json={"memo": "m-pend"}, headers=hdrs)

    _drain(tasks)

    assert captured == []
    assert sleeps == []
    assert tasks == []
