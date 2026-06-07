# Backend ELO + lobby de partidas abiertas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend FastAPI con usuarios por wallet+firma, rating ELO derivado solo de batallas liquidadas on-chain, y un lobby de partidas abiertas (modelo desafío) que muestra la diferencia de nivel y respeta los límites de ELO del creador.

**Architecture:** Servicio Python en `backend/`. Lógica pura aislada (`elo.py`), acceso a cadena tras una interfaz `ChainSource` (mock para dev/tests, lector Solana real esqueletado), persistencia SQLAlchemy/SQLite, auth por firma ed25519 (PyNaCl), servicios (`users`, `matches`) que orquestan, y FastAPI como capa fina. Todo testeable offline con `MockChainSource`, DB temporal por test y peticiones firmadas con keypairs de test.

**Tech Stack:** Python 3.9, FastAPI, uvicorn, SQLAlchemy 2.x, SQLite, PyNaCl (ed25519), based58, pydantic-settings, pytest, pytest-asyncio, httpx (TestClient).

**Comandos base** (desde `backend/`):
```bash
cd /Users/mauro/Desarrollos/BattleArena/backend
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
pytest -q
```

---

## File Structure

```
backend/
  requirements.txt, .gitignore, pytest.ini, .env.example
  app/
    __init__.py
    config.py          # Settings (env)
    db.py              # Base, engine/session factory, init_db
    models.py          # User, Match, RatingHistory
    elo.py             # expected_score, updated_ratings, gap_label (puro)
    auth.py            # AuthService: nonce, mensaje, verify firma, token
    chain/
      __init__.py
      base.py          # BattleState, ChainSource Protocol, BattleNotFound
      mock.py          # MockChainSource
      solana.py        # SolanaChainSource (esqueleto)
    services/
      __init__.py
      users.py         # get_or_create_user, set_alias, leaderboard, history
      matches.py       # register_match, list_open, sync_match (+ELO apply)
    main.py            # create_app + endpoints + auth dependency
  tests/
    __init__.py
    conftest.py
    test_elo.py
    test_chain_mock.py
    test_models.py
    test_auth.py
    test_users.py
    test_matches.py
    test_api.py
  README.md
```

**Convenciones:** wallets = base58 de 32 bytes; `elo` entero; `stake` entero (unidades mínimas). `Player` en cadena: `player_a`/`player_b` son wallets base58 o None.

---

## Task 1: Scaffold + config + db

**Files:** `backend/requirements.txt`, `.gitignore`, `pytest.ini`, `.env.example`, `app/__init__.py`, `app/config.py`, `app/db.py`, `tests/__init__.py`, `tests/test_smoke.py`

- [ ] **Step 1: ficheros de proyecto**

`backend/requirements.txt`:
```
fastapi==0.110.0
uvicorn==0.29.0
sqlalchemy==2.0.29
pynacl==1.5.0
based58==0.1.1
pydantic==2.6.4
pydantic-settings==2.2.1
pytest==8.1.1
pytest-asyncio==0.23.6
httpx==0.27.0
```

`backend/.gitignore`:
```
.venv/
__pycache__/
*.pyc
.env
*.db
.pytest_cache/
```

`backend/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

`backend/.env.example`:
```
DATABASE_URL=sqlite:///battlearena.db
CHAIN_SOURCE=mock          # mock | solana
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=
ELO_START=1200
ELO_K=32
SESSION_TTL=3600
```

Empty `app/__init__.py`, `tests/__init__.py`.

- [ ] **Step 2: config.py**

`backend/app/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///battlearena.db"
    chain_source: str = "mock"
    solana_rpc_url: str = "https://api.devnet.solana.com"
    program_id: str = ""
    elo_start: int = 1200
    elo_k: int = 32
    session_ttl: int = 3600


def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 3: db.py**

`backend/app/db.py`:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str):
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(engine):
    # importa los modelos para registrarlos en Base.metadata antes de create_all
    from . import models  # noqa: F401
    Base.metadata.create_all(engine)
```

- [ ] **Step 4: smoke test**

`backend/tests/test_smoke.py`:
```python
from app.config import get_settings


def test_settings_defaults():
    s = get_settings()
    assert s.elo_start == 1200 and s.elo_k == 32
    assert s.chain_source in ("mock", "solana")
```

- [ ] **Step 5: venv + run**

```bash
cd /Users/mauro/Desarrollos/BattleArena/backend
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
pytest -q
```
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/requirements.txt backend/.gitignore backend/pytest.ini backend/.env.example backend/app/__init__.py backend/app/config.py backend/app/db.py backend/tests/__init__.py backend/tests/test_smoke.py
git commit -m "chore(backend): scaffold FastAPI + SQLAlchemy + pytest"
```

---

## Task 2: `elo.py` (puro, TDD)

**Files:** `backend/app/elo.py`, `backend/tests/test_elo.py`

- [ ] **Step 1: test que falla**

`backend/tests/test_elo.py`:
```python
from app.elo import expected_score, updated_ratings, gap_label


def test_expected_even():
    assert abs(expected_score(1200, 1200) - 0.5) < 1e-9


def test_update_even_win():
    # 1200 vs 1200, gana A (score 1), K=32 -> +16 / -16
    new_a, new_b = updated_ratings(1200, 1200, 1.0, k=32)
    assert new_a == 1216 and new_b == 1184


def test_update_draw():
    new_a, new_b = updated_ratings(1200, 1200, 0.5, k=32)
    assert new_a == 1200 and new_b == 1200


def test_update_upset_favours_underdog():
    # underdog (1000) vence al favorito (1400): el underdog sube mucho
    new_u, new_fav = updated_ratings(1000, 1400, 1.0, k=32)
    assert new_u > 1000 and new_fav < 1400
    assert (new_u - 1000) > 16  # gana más que en un combate parejo


def test_gap_label_thresholds():
    assert gap_label(0) == "parejo"
    assert gap_label(99) == "parejo"
    assert gap_label(100) == "notable"
    assert gap_label(-250) == "notable"
    assert gap_label(301) == "gran diferencia"
```

- [ ] **Step 2: verificar que falla**

Run: `pytest tests/test_elo.py -q` → ImportError.

- [ ] **Step 3: implementar**

`backend/app/elo.py`:
```python
def expected_score(rating_a: int, rating_b: int) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def updated_ratings(rating_a: int, rating_b: int, score_a: float, k: int = 32) -> tuple[int, int]:
    """score_a: 1.0 gana A, 0.0 gana B, 0.5 empate. Devuelve (nuevo_a, nuevo_b)."""
    ea = expected_score(rating_a, rating_b)
    eb = 1.0 - ea
    score_b = 1.0 - score_a
    new_a = round(rating_a + k * (score_a - ea))
    new_b = round(rating_b + k * (score_b - eb))
    return new_a, new_b


def gap_label(diff: int) -> str:
    d = abs(diff)
    if d < 100:
        return "parejo"
    if d <= 300:
        return "notable"
    return "gran diferencia"
```

- [ ] **Step 4: verificar que pasa**

Run: `pytest tests/test_elo.py -q` → 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/elo.py backend/tests/test_elo.py
git commit -m "feat(backend): ELO (expected/update/gap_label) con tests"
```

---

## Task 3: `chain/base.py` + `chain/mock.py` (TDD)

**Files:** `backend/app/chain/__init__.py`, `backend/app/chain/base.py`, `backend/app/chain/mock.py`, `backend/tests/test_chain_mock.py`

- [ ] **Step 1: test que falla**

`backend/tests/test_chain_mock.py`:
```python
import pytest
from app.chain.mock import MockChainSource
from app.chain.base import BattleNotFound


async def test_get_battle_found():
    src = MockChainSource()
    src.set_battle("B1", player_a="WALLET_A", stake=100)
    b = await src.get_battle("B1")
    assert b["player_a"] == "WALLET_A" and b["phase"] == "Created" and b["player_b"] is None


async def test_get_battle_missing():
    src = MockChainSource()
    with pytest.raises(BattleNotFound):
        await src.get_battle("NOPE")


async def test_advance_joined_and_settled():
    src = MockChainSource()
    src.set_battle("B1", player_a="A", stake=100)
    src.join("B1", player_b="B")
    assert (await src.get_battle("B1"))["player_b"] == "B"
    src.settle("B1", winner="A")
    b = await src.get_battle("B1")
    assert b["phase"] == "Settled" and b["winner"] == "A" and b["is_draw"] is False
```

- [ ] **Step 2: verificar que falla**

Run: `pytest tests/test_chain_mock.py -q` → ImportError.

- [ ] **Step 3: implementar**

`backend/app/chain/__init__.py` (empty).

`backend/app/chain/base.py`:
```python
from typing import Optional, Protocol, TypedDict


class BattleNotFound(Exception):
    pass


class BattleState(TypedDict):
    battle: str
    player_a: str
    player_b: Optional[str]
    stake: int
    phase: str                # 'Created'|'Committing'|'Revealing'|'RoundResolved'|'Settled'|'Closed'
    winner: Optional[str]     # wallet ganadora o None
    is_draw: bool


class ChainSource(Protocol):
    async def get_battle(self, battle: str) -> BattleState: ...
```

`backend/app/chain/mock.py`:
```python
from typing import Optional
from .base import BattleState, BattleNotFound


class MockChainSource:
    """ChainSource en memoria para dev/tests."""

    def __init__(self) -> None:
        self._battles: dict[str, BattleState] = {}

    def set_battle(self, battle: str, player_a: str, stake: int) -> None:
        self._battles[battle] = {
            "battle": battle, "player_a": player_a, "player_b": None,
            "stake": stake, "phase": "Created", "winner": None, "is_draw": False,
        }

    def join(self, battle: str, player_b: str) -> None:
        b = self._battles[battle]
        b["player_b"] = player_b
        b["phase"] = "Committing"

    def settle(self, battle: str, winner: Optional[str] = None, is_draw: bool = False) -> None:
        b = self._battles[battle]
        b["phase"] = "Settled"
        b["winner"] = winner
        b["is_draw"] = is_draw

    async def get_battle(self, battle: str) -> BattleState:
        if battle not in self._battles:
            raise BattleNotFound(battle)
        return dict(self._battles[battle])  # copia defensiva
```

- [ ] **Step 4: verificar que pasa**

Run: `pytest tests/test_chain_mock.py -q` → 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/chain/__init__.py backend/app/chain/base.py backend/app/chain/mock.py backend/tests/test_chain_mock.py
git commit -m "feat(backend): ChainSource + MockChainSource"
```

---

## Task 4: `models.py` (User, Match, RatingHistory)

**Files:** `backend/app/models.py`, `backend/tests/test_models.py`

- [ ] **Step 1: test que falla**

`backend/tests/test_models.py`:
```python
from app.db import Base, make_engine, make_session_factory, init_db
from app.models import User, Match, RatingHistory


def test_create_and_query():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        s.add(User(wallet="A", elo=1200))
        s.add(Match(battle_pubkey="B1", creator="A", stake=100, status="open"))
        s.commit()
        u = s.get(User, "A")
        m = s.get(Match, "B1")
        assert u.elo == 1200 and u.games_played == 0
        assert m.creator == "A" and m.status == "open" and m.elo_applied is False
        assert m.min_elo is None and m.max_elo is None
```

- [ ] **Step 2: verificar que falla**

Run: `pytest tests/test_models.py -q` → ImportError.

- [ ] **Step 3: implementar**

`backend/app/models.py`:
```python
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    wallet: Mapped[str] = mapped_column(String, primary_key=True)
    alias: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    elo: Mapped[int] = mapped_column(Integer, default=1200)
    games_played: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Match(Base):
    __tablename__ = "matches"
    battle_pubkey: Mapped[str] = mapped_column(String, primary_key=True)
    creator: Mapped[str] = mapped_column(String, index=True)
    opponent: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    stake: Mapped[int] = mapped_column(Integer)
    min_elo: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_elo: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open", index=True)  # open|joined|settled
    winner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_draw: Mapped[bool] = mapped_column(Boolean, default=False)
    elo_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    settled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RatingHistory(Base):
    __tablename__ = "rating_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wallet: Mapped[str] = mapped_column(String, index=True)
    battle_pubkey: Mapped[str] = mapped_column(String)
    elo_before: Mapped[int] = mapped_column(Integer)
    elo_after: Mapped[int] = mapped_column(Integer)
    result: Mapped[str] = mapped_column(String)  # win|loss|draw
    ts: Mapped[datetime] = mapped_column(DateTime, default=_now)
```

- [ ] **Step 4: verificar que pasa**

Run: `pytest tests/test_models.py -q` → 1 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/models.py backend/tests/test_models.py
git commit -m "feat(backend): modelos User, Match, RatingHistory"
```

---

## Task 5: `auth.py` (firma ed25519 + token, TDD)

**Files:** `backend/app/auth.py`, `backend/tests/test_auth.py`

- [ ] **Step 1: test que falla**

`backend/tests/test_auth.py`:
```python
import pytest
import based58
from nacl.signing import SigningKey
from app.auth import AuthService, auth_message, AuthError


def _wallet(key: SigningKey) -> str:
    return based58.b58encode(bytes(key.verify_key)).decode()


def test_nonce_then_verify_issues_token():
    key = SigningKey.generate()
    wallet = _wallet(key)
    auth = AuthService(nonce_fn=lambda: "NONCE123", token_fn=lambda: "TOK", now_fn=lambda: 1000, ttl=3600)
    nonce = auth.issue_nonce(wallet)
    assert nonce == "NONCE123"
    sig = key.sign(auth_message(nonce).encode()).signature
    token = auth.verify(wallet, sig.hex())
    assert token == "TOK"
    assert auth.wallet_for_token("TOK") == wallet


def test_bad_signature_rejected():
    key = SigningKey.generate()
    other = SigningKey.generate()
    wallet = _wallet(key)
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: 0, ttl=3600)
    auth.issue_nonce(wallet)
    bad = other.sign(auth_message("N").encode()).signature  # firma de otra clave
    with pytest.raises(AuthError):
        auth.verify(wallet, bad.hex())


def test_verify_without_nonce_rejected():
    key = SigningKey.generate()
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: 0, ttl=3600)
    with pytest.raises(AuthError):
        auth.verify(_wallet(key), "00")


def test_expired_token_returns_none():
    t = {"v": 0}
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: t["v"], ttl=10)
    key = SigningKey.generate(); wallet = _wallet(key)
    auth.issue_nonce(wallet)
    sig = key.sign(auth_message("N").encode()).signature
    auth.verify(wallet, sig.hex())
    t["v"] = 100  # pasa el TTL
    assert auth.wallet_for_token("T") is None
```

- [ ] **Step 2: verificar que falla**

Run: `pytest tests/test_auth.py -q` → ImportError.

- [ ] **Step 3: implementar**

`backend/app/auth.py`:
```python
import secrets
import time
from typing import Callable, Optional
import based58
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError


class AuthError(Exception):
    pass


def auth_message(nonce: str) -> str:
    return f"BattleArena auth: {nonce}"


class AuthService:
    def __init__(self, nonce_fn: Callable[[], str] = lambda: secrets.token_urlsafe(16),
                 token_fn: Callable[[], str] = lambda: secrets.token_urlsafe(24),
                 now_fn: Callable[[], float] = time.time, ttl: int = 3600) -> None:
        self._nonce_fn = nonce_fn
        self._token_fn = token_fn
        self._now = now_fn
        self._ttl = ttl
        self._nonces: dict[str, str] = {}            # wallet -> nonce
        self._tokens: dict[str, tuple[str, float]] = {}  # token -> (wallet, expiry)

    def issue_nonce(self, wallet: str) -> str:
        nonce = self._nonce_fn()
        self._nonces[wallet] = nonce
        return nonce

    def verify(self, wallet: str, signature_hex: str) -> str:
        nonce = self._nonces.get(wallet)
        if nonce is None:
            raise AuthError("sin nonce para esta wallet")
        try:
            vk = VerifyKey(based58.b58decode(wallet.encode()))
            vk.verify(auth_message(nonce).encode(), bytes.fromhex(signature_hex))
        except (BadSignatureError, ValueError) as e:
            raise AuthError(f"firma inválida: {e}")
        del self._nonces[wallet]  # un solo uso
        token = self._token_fn()
        self._tokens[token] = (wallet, self._now() + self._ttl)
        return token

    def wallet_for_token(self, token: str) -> Optional[str]:
        entry = self._tokens.get(token)
        if entry is None:
            return None
        wallet, expiry = entry
        if self._now() > expiry:
            del self._tokens[token]
            return None
        return wallet
```

- [ ] **Step 4: verificar que pasa**

Run: `pytest tests/test_auth.py -q` → 4 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/auth.py backend/tests/test_auth.py
git commit -m "feat(backend): auth por firma ed25519 + token de sesión"
```

---

## Task 6: `services/users.py` (TDD)

**Files:** `backend/app/services/__init__.py`, `backend/app/services/users.py`, `backend/tests/conftest.py`, `backend/tests/test_users.py`

- [ ] **Step 1: conftest con DB por test**

`backend/tests/conftest.py`:
```python
import pytest
from app.db import make_engine, make_session_factory, init_db


@pytest.fixture
def Session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    return make_session_factory(engine)
```

- [ ] **Step 2: test que falla**

`backend/tests/test_users.py`:
```python
from app.services.users import get_or_create_user, set_alias, leaderboard, history


def test_get_or_create(Session):
    with Session() as s:
        u = get_or_create_user(s, "A", elo_start=1200)
        s.commit()
        assert u.elo == 1200
        u2 = get_or_create_user(s, "A", elo_start=1200)
        assert u2.wallet == "A"  # no duplica


def test_set_alias(Session):
    with Session() as s:
        get_or_create_user(s, "A", elo_start=1200)
        set_alias(s, "A", "Mauro")
        s.commit()
        assert get_or_create_user(s, "A", elo_start=1200).alias == "Mauro"


def test_leaderboard_orders_by_elo(Session):
    with Session() as s:
        get_or_create_user(s, "A", elo_start=1200).elo = 1300
        get_or_create_user(s, "B", elo_start=1200).elo = 1500
        get_or_create_user(s, "C", elo_start=1200).elo = 1100
        s.commit()
        top = leaderboard(s, limit=2)
        assert [u.wallet for u in top] == ["B", "A"]
```

- [ ] **Step 3: verificar que falla**

Run: `pytest tests/test_users.py -q` → ImportError.

- [ ] **Step 4: implementar**

`backend/app/services/__init__.py` (empty).

`backend/app/services/users.py`:
```python
from typing import Optional
from sqlalchemy import select, desc
from sqlalchemy.orm import Session
from ..models import User, RatingHistory


def get_or_create_user(session: Session, wallet: str, elo_start: int) -> User:
    user = session.get(User, wallet)
    if user is None:
        user = User(wallet=wallet, elo=elo_start, games_played=0)
        session.add(user)
        session.flush()
    return user


def set_alias(session: Session, wallet: str, alias: str) -> None:
    user = session.get(User, wallet)
    if user is None:
        raise ValueError("usuario no existe")
    user.alias = alias


def leaderboard(session: Session, limit: int = 50) -> list[User]:
    return list(session.scalars(select(User).order_by(desc(User.elo)).limit(limit)))


def history(session: Session, wallet: str) -> list[RatingHistory]:
    return list(session.scalars(
        select(RatingHistory).where(RatingHistory.wallet == wallet).order_by(desc(RatingHistory.ts))
    ))
```

- [ ] **Step 5: verificar que pasa**

Run: `pytest tests/test_users.py -q` → 3 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/services/__init__.py backend/app/services/users.py backend/tests/conftest.py backend/tests/test_users.py
git commit -m "feat(backend): servicio de usuarios (get_or_create, alias, leaderboard, history)"
```

---

## Task 7: `services/matches.py` (register, list_open, sync — el núcleo, TDD)

**Files:** `backend/app/services/matches.py`, `backend/tests/test_matches.py`

- [ ] **Step 1: test que falla**

`backend/tests/test_matches.py`:
```python
import pytest
from app.chain.mock import MockChainSource
from app.services.matches import register_match, list_open, sync_match, MatchError
from app.services.users import get_or_create_user


async def test_register_requires_created_and_creator(Session):
    chain = MockChainSource()
    chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        m = await register_match(s, chain, creator="A", battle_pubkey="B1",
                                 min_elo=1000, max_elo=1500, elo_start=1200)
        s.commit()
        assert m.status == "open" and m.stake == 100 and m.min_elo == 1000

    # creador que no coincide con player_a -> error
    with Session() as s:
        with pytest.raises(MatchError):
            await register_match(s, chain, creator="X", battle_pubkey="B1",
                                 min_elo=None, max_elo=None, elo_start=1200)

    # batalla inexistente -> error
    with Session() as s:
        with pytest.raises(MatchError):
            await register_match(s, chain, creator="A", battle_pubkey="NOPE",
                                 min_elo=None, max_elo=None, elo_start=1200)


async def test_list_open_enriches_with_gap_and_joinable(Session):
    chain = MockChainSource()
    chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        get_or_create_user(s, "A", 1200).elo = 1500
        await register_match(s, chain, creator="A", battle_pubkey="B1",
                             min_elo=1400, max_elo=1600, elo_start=1200)
        get_or_create_user(s, "V", 1200).elo = 1450
        s.commit()
        rows = list_open(s, viewer="V")
        assert len(rows) == 1
        r = rows[0]
        assert r["creator_elo"] == 1500 and r["viewer_elo"] == 1450
        assert r["elo_diff"] == -50 and r["gap_label"] == "parejo"
        assert r["joinable"] is True  # 1450 en [1400,1600]
        # viewer fuera de rango -> no joinable
        get_or_create_user(s, "W", 1200).elo = 1700
        s.commit()
        r2 = list_open(s, viewer="W")[0]
        assert r2["joinable"] is False


async def test_sync_joined_then_settled_applies_elo_once(Session):
    chain = MockChainSource()
    chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        await register_match(s, chain, creator="A", battle_pubkey="B1",
                             min_elo=None, max_elo=None, elo_start=1200)
        s.commit()

    chain.join("B1", player_b="B")
    with Session() as s:
        m = await sync_match(s, chain, "B1", elo_start=1200, k=32)
        s.commit()
        assert m.status == "joined" and m.opponent == "B"

    chain.settle("B1", winner="A")
    with Session() as s:
        m = await sync_match(s, chain, "B1", elo_start=1200, k=32)
        s.commit()
        assert m.status == "settled" and m.elo_applied is True
        a = get_or_create_user(s, "A", 1200); b = get_or_create_user(s, "B", 1200)
        assert a.elo == 1216 and b.elo == 1184
        assert a.games_played == 1 and b.games_played == 1

    # doble sync no re-aplica
    with Session() as s:
        await sync_match(s, chain, "B1", elo_start=1200, k=32)
        s.commit()
        a = get_or_create_user(s, "A", 1200)
        assert a.elo == 1216 and a.games_played == 1
```

- [ ] **Step 2: verificar que falla**

Run: `pytest tests/test_matches.py -q` → ImportError.

- [ ] **Step 3: implementar**

`backend/app/services/matches.py`:
```python
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..chain.base import ChainSource, BattleNotFound
from ..models import Match, RatingHistory
from ..elo import updated_ratings, gap_label
from .users import get_or_create_user


class MatchError(Exception):
    pass


async def register_match(session: Session, chain: ChainSource, creator: str, battle_pubkey: str,
                         min_elo: Optional[int], max_elo: Optional[int], elo_start: int) -> Match:
    try:
        bs = await chain.get_battle(battle_pubkey)
    except BattleNotFound:
        raise MatchError("la batalla no existe on-chain")
    if bs["phase"] != "Created":
        raise MatchError(f"la batalla no está en Created (phase={bs['phase']})")
    if bs["player_a"] != creator:
        raise MatchError("el creador no coincide con player_a on-chain")
    if session.get(Match, battle_pubkey) is not None:
        raise MatchError("la partida ya está registrada")
    get_or_create_user(session, creator, elo_start)
    m = Match(battle_pubkey=battle_pubkey, creator=creator, stake=bs["stake"],
              min_elo=min_elo, max_elo=max_elo, status="open")
    session.add(m)
    session.flush()
    return m


def list_open(session: Session, viewer: Optional[str] = None) -> list[dict]:
    from ..models import User
    matches = list(session.scalars(select(Match).where(Match.status == "open")))
    viewer_elo = None
    if viewer is not None:
        vu = session.get(User, viewer)
        viewer_elo = vu.elo if vu else None
    out = []
    for m in matches:
        creator = session.get(User, m.creator)
        creator_elo = creator.elo if creator else None
        row = {
            "battle_pubkey": m.battle_pubkey, "creator": m.creator,
            "creator_alias": creator.alias if creator else None,
            "creator_elo": creator_elo, "stake": m.stake,
            "min_elo": m.min_elo, "max_elo": m.max_elo,
        }
        if viewer_elo is not None and creator_elo is not None:
            diff = viewer_elo - creator_elo
            joinable = ((m.min_elo is None or viewer_elo >= m.min_elo) and
                        (m.max_elo is None or viewer_elo <= m.max_elo))
            row.update({"viewer_elo": viewer_elo, "elo_diff": diff,
                        "gap_label": gap_label(diff), "joinable": joinable})
        out.append(row)
    return out


async def sync_match(session: Session, chain: ChainSource, battle_pubkey: str,
                     elo_start: int, k: int) -> Match:
    m = session.get(Match, battle_pubkey)
    if m is None:
        raise MatchError("partida no registrada")
    bs = await chain.get_battle(battle_pubkey)

    if bs["player_b"] and m.status == "open":
        m.opponent = bs["player_b"]
        m.status = "joined"

    settled = bs["phase"] in ("Settled", "Closed")
    if settled and not m.elo_applied:
        a = get_or_create_user(session, m.creator, elo_start)
        opp_wallet = m.opponent or bs["player_b"]
        if opp_wallet is None:
            # liquidada sin rival (p.ej. timeout antes de unirse): nada que ratear
            m.status = "settled"; m.elo_applied = True
            m.settled_at = datetime.now(timezone.utc)
            session.flush()
            return m
        b = get_or_create_user(session, opp_wallet, elo_start)
        m.opponent = opp_wallet

        if bs["is_draw"]:
            score_a, res_a, res_b = 0.5, "draw", "draw"
        elif bs["winner"] == a.wallet:
            score_a, res_a, res_b = 1.0, "win", "loss"
        else:
            score_a, res_a, res_b = 0.0, "loss", "win"

        before_a, before_b = a.elo, b.elo
        a.elo, b.elo = updated_ratings(a.elo, b.elo, score_a, k=k)
        a.games_played += 1
        b.games_played += 1
        session.add_all([
            RatingHistory(wallet=a.wallet, battle_pubkey=battle_pubkey,
                          elo_before=before_a, elo_after=a.elo, result=res_a),
            RatingHistory(wallet=b.wallet, battle_pubkey=battle_pubkey,
                          elo_before=before_b, elo_after=b.elo, result=res_b),
        ])
        m.winner = bs["winner"]; m.is_draw = bs["is_draw"]
        m.status = "settled"; m.elo_applied = True
        m.settled_at = datetime.now(timezone.utc)

    session.flush()
    return m
```
- [ ] **Step 4: verificar que pasa**

Run: `pytest tests/test_matches.py -q` → 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/services/matches.py backend/tests/test_matches.py
git commit -m "feat(backend): servicio de matches (register/list_open/sync + aplicación ELO idempotente)"
```

---

## Task 8: `main.py` (FastAPI) + `test_api.py`

**Files:** `backend/app/main.py`, `backend/tests/test_api.py`

- [ ] **Step 1: implementar `main.py`**

`backend/app/main.py`:
```python
from typing import Optional
from fastapi import FastAPI, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .config import get_settings
from .db import make_engine, make_session_factory, init_db
from .auth import AuthService, AuthError
from .chain.base import ChainSource
from .chain.mock import MockChainSource
from .services.users import get_or_create_user, set_alias, leaderboard, history
from .services.matches import register_match, list_open, sync_match, MatchError
from .elo import gap_label


class VerifyBody(BaseModel):
    wallet: str
    signature_hex: str


class AliasBody(BaseModel):
    alias: str


class CreateMatchBody(BaseModel):
    battle_pubkey: str
    min_elo: Optional[int] = None
    max_elo: Optional[int] = None


def create_app(session_factory, chain: ChainSource, auth: AuthService,
               elo_start: int = 1200, elo_k: int = 32) -> FastAPI:
    app = FastAPI(title="Battle Arena — Backend")

    def db() -> Session:
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    def current_wallet(authorization: Optional[str] = Header(None)) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        wallet = auth.wallet_for_token(authorization[len("Bearer "):])
        if wallet is None:
            raise HTTPException(401, "token inválido o caducado")
        return wallet

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/auth/nonce")
    async def auth_nonce(wallet: str = Query(..., min_length=32, max_length=44)):
        return {"nonce": auth.issue_nonce(wallet)}

    @app.post("/auth/verify")
    async def auth_verify(body: VerifyBody):
        try:
            token = auth.verify(body.wallet, body.signature_hex)
        except AuthError as e:
            raise HTTPException(401, str(e))
        return {"token": token}

    @app.post("/users/me/alias")
    async def me_alias(body: AliasBody, wallet: str = Depends(current_wallet), s: Session = Depends(db)):
        get_or_create_user(s, wallet, elo_start)
        set_alias(s, wallet, body.alias)
        s.commit()
        return {"wallet": wallet, "alias": body.alias}

    @app.get("/users/{wallet}")
    async def get_user(wallet: str, s: Session = Depends(db)):
        u = get_or_create_user(s, wallet, elo_start)
        s.commit()
        return {"wallet": u.wallet, "alias": u.alias, "elo": u.elo, "games_played": u.games_played}

    @app.get("/users/{wallet}/history")
    async def get_history(wallet: str, s: Session = Depends(db)):
        return [{"battle_pubkey": h.battle_pubkey, "elo_before": h.elo_before,
                 "elo_after": h.elo_after, "result": h.result} for h in history(s, wallet)]

    @app.post("/matches")
    async def post_match(body: CreateMatchBody, wallet: str = Depends(current_wallet), s: Session = Depends(db)):
        try:
            m = await register_match(s, chain, creator=wallet, battle_pubkey=body.battle_pubkey,
                                     min_elo=body.min_elo, max_elo=body.max_elo, elo_start=elo_start)
        except MatchError as e:
            raise HTTPException(409, str(e))
        s.commit()
        return {"battle_pubkey": m.battle_pubkey, "status": m.status, "stake": m.stake,
                "min_elo": m.min_elo, "max_elo": m.max_elo}

    @app.get("/matches/open")
    async def get_open(viewer: Optional[str] = None, s: Session = Depends(db)):
        rows = list_open(s, viewer=viewer)
        s.commit()
        return rows

    @app.post("/matches/{battle_pubkey}/sync")
    async def post_sync(battle_pubkey: str, s: Session = Depends(db)):
        try:
            m = await sync_match(s, chain, battle_pubkey, elo_start=elo_start, k=elo_k)
        except MatchError as e:
            raise HTTPException(404, str(e))
        s.commit()
        return {"battle_pubkey": m.battle_pubkey, "status": m.status, "winner": m.winner,
                "is_draw": m.is_draw, "elo_applied": m.elo_applied}

    @app.get("/elo/compare")
    async def elo_compare(a: str, b: str, s: Session = Depends(db)):
        ua = get_or_create_user(s, a, elo_start); ub = get_or_create_user(s, b, elo_start)
        s.commit()
        diff = ua.elo - ub.elo
        return {"elo_a": ua.elo, "elo_b": ub.elo, "diff": diff, "gap_label": gap_label(diff)}

    @app.get("/leaderboard")
    async def get_leaderboard(limit: int = 50, s: Session = Depends(db)):
        return [{"wallet": u.wallet, "alias": u.alias, "elo": u.elo} for u in leaderboard(s, limit)]

    return app


def build_default_app() -> FastAPI:
    s = get_settings()
    engine = make_engine(s.database_url)
    init_db(engine)
    session_factory = make_session_factory(engine)
    chain: ChainSource = MockChainSource()  # 'solana' se cablea cuando el lector real esté validado
    auth = AuthService(ttl=s.session_ttl)
    return create_app(session_factory, chain, auth, elo_start=s.elo_start, elo_k=s.elo_k)


app = build_default_app()
```

- [ ] **Step 2: escribir `test_api.py`**

`backend/tests/test_api.py`:
```python
import based58
from fastapi.testclient import TestClient
from nacl.signing import SigningKey
from app.main import create_app
from app.db import make_engine, make_session_factory, init_db
from app.auth import AuthService, auth_message
from app.chain.mock import MockChainSource


def _client():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    sf = make_session_factory(engine)
    chain = MockChainSource()
    auth = AuthService(now_fn=lambda: 1000, ttl=3600)
    app = create_app(sf, chain, auth, elo_start=1200, elo_k=32)
    return TestClient(app), chain, auth


def _login(c, key):
    wallet = based58.b58encode(bytes(key.verify_key)).decode()
    nonce = c.get("/auth/nonce", params={"wallet": wallet}).json()["nonce"]
    sig = key.sign(auth_message(nonce).encode()).signature.hex()
    token = c.post("/auth/verify", json={"wallet": wallet, "signature_hex": sig}).json()["token"]
    return wallet, token


def test_health():
    c, _, _ = _client()
    assert c.get("/health").json()["status"] == "ok"


def test_auth_and_create_match_flow():
    c, chain, _ = _client()
    key = SigningKey.generate()
    wallet, token = _login(c, key)
    chain.set_battle("B1", player_a=wallet, stake=100)
    r = c.post("/matches", json={"battle_pubkey": "B1", "min_elo": 1000, "max_elo": 1500},
               headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["stake"] == 100
    # listado con viewer
    rows = c.get("/matches/open", params={"viewer": wallet}).json()
    assert rows[0]["battle_pubkey"] == "B1" and rows[0]["joinable"] is True


def test_create_match_requires_auth():
    c, chain, _ = _client()
    chain.set_battle("B1", player_a="A", stake=100)
    r = c.post("/matches", json={"battle_pubkey": "B1"})
    assert r.status_code == 401


def test_sync_applies_elo_and_compare():
    c, chain, _ = _client()
    ka, kb = SigningKey.generate(), SigningKey.generate()
    wa, token = _login(c, ka)
    wb = based58.b58encode(bytes(kb.verify_key)).decode()
    chain.set_battle("B1", player_a=wa, stake=100)
    c.post("/matches", json={"battle_pubkey": "B1"}, headers={"Authorization": f"Bearer {token}"})
    chain.join("B1", player_b=wb); chain.settle("B1", winner=wa)
    r = c.post("/matches/B1/sync")
    assert r.status_code == 200 and r.json()["elo_applied"] is True
    cmp = c.get("/elo/compare", params={"a": wa, "b": wb}).json()
    assert cmp["elo_a"] == 1216 and cmp["elo_b"] == 1184 and cmp["diff"] == 32
```

- [ ] **Step 3: verificar**

Run: `pytest tests/test_api.py -q` → tests passed. Then the full suite:
```bash
cd /Users/mauro/Desarrollos/BattleArena/backend && source .venv/bin/activate && pytest -q
# arranque humo:
python -c "from app.main import app; print('import ok')"
```
Expected: toda la suite verde; import ok (crea `battlearena.db` local, gitignored).

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/main.py backend/tests/test_api.py
git commit -m "feat(backend): FastAPI (auth, usuarios, lobby, sync, compare, leaderboard)"
```

---

## Task 9: `chain/solana.py` (esqueleto) + README

**Files:** `backend/app/chain/solana.py`, `backend/README.md`

- [ ] **Step 1: esqueleto del lector real**

`backend/app/chain/solana.py`:
```python
from .base import BattleState, BattleNotFound


class SolanaChainSource:
    """Lector real de la cuenta Battle on-chain. ESQUELETO: a validar contra devnet
    cuando el programa esté desplegado. Decodifica la cuenta Anchor `Battle`:
    8 bytes de discriminador + layout Borsh de onchain/programs/battle_arena/src/state.rs
    (player_a/b: Pubkey[32], ..., phase: enum u8, winner: Option<u8>, is_draw: bool, ...).
    """

    def __init__(self, rpc_url: str, program_id: str) -> None:
        self._rpc_url = rpc_url
        self._program_id = program_id

    async def get_battle(self, battle: str) -> BattleState:
        # TODO(devnet): getAccountInfo(battle) vía RPC JSON, base64-decode los datos,
        # saltar 8 bytes de discriminador, decodificar el struct Battle con la misma
        # disposición que state.rs, y mapear phase(u8)->str, winner(Option<u8>)->wallet.
        raise NotImplementedError("SolanaChainSource pendiente de validar contra devnet")
```

> Nota: este esqueleto NO se cablea en `build_default_app` (usa `MockChainSource`) hasta validarlo contra una batalla real. Es el riesgo aislado documentado en el spec.

- [ ] **Step 2: README**

`backend/README.md` documentando: qué es (backend de orquestación de la Fase 1), arranque (`venv`, `pip install`, `uvicorn app.main:app`), endpoints (auth nonce/verify, users, matches open/sync, elo/compare, leaderboard), el modelo de **lobby abierto** (crear → listar con diferencia de ELO y `joinable` → unirse), que el **ELO se deriva solo de batallas liquidadas on-chain** (vía `ChainSource`; mock en dev, lector Solana real esqueletado), la **auth por firma de wallet**, el **límite de ELO del creador como gate off-chain** (no garantía on-chain), config por env, y los riesgos (lector real pendiente de devnet, token opaco→JWT en prod, anti-colusión fuera del MVP).

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add backend/app/chain/solana.py backend/README.md
git commit -m "docs(backend): lector Solana esqueletado + README"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** scaffold+config+db (Task 1), ELO puro (2), ChainSource+mock (3), modelos (4), auth firma+token (5), servicio usuarios (6), servicio matches register/list/sync con ELO idempotente y `joinable`/gap (7), FastAPI con todos los endpoints incl. `/elo/compare` y `/leaderboard` (8), lector Solana esqueleto + README (9). Decisiones: wallet+firma (5,8), ELO solo on-chain vía ChainSource (3,7), lobby sin matchmaking (7,8), límites de ELO del creador como gate off-chain reflejado en `joinable` (7). ✔️
- **Placeholders:** el `NotImplementedError` de `SolanaChainSource` (Task 9) es intencional y documentado (esqueleto a validar contra devnet, no se cablea). Ningún otro placeholder: el código de cada paso es correcto tal cual.
- **Consistencia de tipos:** `BattleState{battle,player_a,player_b,stake,phase,winner,is_draw}`, `ChainSource.get_battle`, `updated_ratings(a,b,score_a,k)->(int,int)`, `gap_label(diff)->str`, `register_match/list_open/sync_match` y los modelos `User/Match/RatingHistory` coherentes entre tasks y tests. Caso ELO 1200v1200→1216/1184 verificado en elo, matches y api. ✔️
- **Riesgo conocido:** el lector real de cadena (decodificar la cuenta Anchor `Battle` en Python) debe validarse contra devnet; el MVP corre sobre `MockChainSource` y toda la suite es offline.
