from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str):
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# Idempotent column additions for the migration-less SQLite dev DB. create_all() creates
# new TABLES but never adds COLUMNS to pre-existing ones, so we guard each new column with
# an ADD COLUMN that runs only when the column is missing. Extend this list when adding columns.
_ENSURE_COLUMNS = [
    ("users", "gimmighouls", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "referred_by", "VARCHAR"),
    ("users", "withdraw_address", "VARCHAR"),
    ("users", "emote_slots", "VARCHAR"),
    ("pack_battles", "gimmighouls_awarded", "BOOLEAN NOT NULL DEFAULT 0"),
    ("pack_battles", "rematch_battle_id", "VARCHAR"),
    ("pack_battles", "fee_base_units", "INTEGER"),
    ("pack_battles", "fee_pct", "FLOAT"),
    ("pack_battles", "fee_charged", "BOOLEAN NOT NULL DEFAULT 0"),
    ("gacha_packs", "price", "INTEGER"),
    ("gacha_packs", "insured_value", "FLOAT"),
    ("gacha_packs", "name", "VARCHAR"),
    ("gacha_packs", "submitted_at", "DATETIME"),
    ("chat_messages", "kind", "VARCHAR NOT NULL DEFAULT 'user'"),
    ("chat_messages", "action", "VARCHAR"),
    ("chat_messages", "event", "VARCHAR"),
    ("chat_messages", "amount_usd", "FLOAT"),
    ("chat_messages", "machine", "VARCHAR"),
    ("chat_messages", "mult", "FLOAT"),
    ("battle_pulls", "refunded", "BOOLEAN NOT NULL DEFAULT 0"),
]


def _ensure_columns(engine):
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in _ENSURE_COLUMNS:
            if table not in existing_tables:
                continue  # create_all just made it with the column already present
            cols = {c["name"] for c in insp.get_columns(table)}
            if column not in cols:
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}'))


def _backfill_gacha_price(engine):
    """Best-effort: set price for already-opened gacha packs (opened before price tracking) from the
    number in pack_type (e.g. 'pokemon_50' → $50), so past gacha spend still counts toward the wager.
    Only fills NULLs → idempotent. Packs with no number in the code (e.g. 'pokemon_cnft') stay null."""
    import re
    insp = inspect(engine)
    if "gacha_packs" not in set(insp.get_table_names()):
        return
    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT memo, pack_type FROM gacha_packs WHERE opened_at IS NOT NULL AND price IS NULL"
        )).fetchall()
        for memo, pack_type in rows:
            m = re.search(r"(\d+)", pack_type or "")
            if m:
                conn.execute(text("UPDATE gacha_packs SET price = :p WHERE memo = :m"),
                             {"p": int(m.group(1)) * 1_000_000, "m": memo})


def _backfill_refunded(engine):
    """One-shot al añadir battle_pulls.refunded: las batallas ya terminadas se dan por
    saldadas (sus refunds ocurrieron antes de existir el flag). Solo se llama cuando la
    columna acaba de crearse — ver init_db."""
    insp = inspect(engine)
    if "battle_pulls" not in set(insp.get_table_names()):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE battle_pulls SET refunded = 1 WHERE battle_id IN "
            "(SELECT id FROM pack_battles WHERE status IN ('settled', 'voided', 'cancelled'))"
        ))


def init_db(engine):
    # importa los modelos para registrarlos en Base.metadata antes de create_all
    from . import models  # noqa: F401
    insp = inspect(engine)
    had_refunded = ("battle_pulls" in set(insp.get_table_names())
                    and "refunded" in {c["name"] for c in insp.get_columns("battle_pulls")})
    Base.metadata.create_all(engine)
    _ensure_columns(engine)
    if not had_refunded:
        _backfill_refunded(engine)
    _backfill_gacha_price(engine)
