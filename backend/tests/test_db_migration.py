"""Guard against a money-loss regression in db.init_db's one-shot refunded backfill.

_backfill_refunded (app/db.py) marks battle_pulls.refunded = 1 for every pull of a
settled/voided/cancelled battle, but ONLY the very first time the `refunded` column is
added to an existing (pre-migration) battle_pulls table — see init_db's `had_refunded`
gate. If that gate ever regressed (e.g. ran the backfill unconditionally on every
startup), a battle that voids AFTER the column already exists would get its still-pending
refunds silently marked done, and players would never get paid.

This test drives the migration through a real file-based sqlite DB across three
init_db() calls, simulating: (1) upgrade from a pre-`refunded` schema — backfill SHOULD
run and mark existing settled/voided/cancelled pulls refunded; (2) a later battle voiding
after the column exists — backfill must NOT re-run and must NOT touch its pending pull.
"""
from __future__ import annotations

from sqlalchemy import inspect, text

from app.db import make_engine, init_db


def _column_names(engine, table):
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_backfill_refunded_runs_once_on_column_creation_only(tmp_path):
    db_path = tmp_path / "migration.db"
    engine = make_engine(f"sqlite:///{db_path}")

    # 1) Fresh DB: init_db creates every table (refunded already present via the model).
    init_db(engine)
    assert "refunded" in _column_names(engine, "battle_pulls")

    # Simulate the OLD pre-migration schema by dropping the column (SQLite >= 3.35
    # supports DROP COLUMN; this repo's sqlite3 does — verified below).
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE battle_pulls DROP COLUMN refunded"))
    assert "refunded" not in _column_names(engine, "battle_pulls")

    # 2) Insert a voided battle + an unrefunded pull using the OLD schema (raw SQL —
    # the ORM model itself still has the `refunded` column, so it can't insert here).
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO pack_battles (id, mode, machine_code, price, max_players, status, "
            "gimmighouls_awarded, fee_charged, created_at) VALUES "
            "('vb1', 'pack', 'm', 50000000, 2, 'voided', 0, 0, '2026-01-01 00:00:00')"
        ))
        conn.execute(text(
            "INSERT INTO battle_pulls (battle_id, player_wallet, memo, auto_sold, "
            "transferred, round_number) VALUES ('vb1', 'walletA', 'memoA', 0, 0, 1)"
        ))

    # Running init_db again re-adds the column (via _ensure_columns) AND, because the
    # column had just been (re-)created, backfills refunded=1 for settled/voided/cancelled
    # battles' pulls — the upgrade path.
    init_db(engine)
    assert "refunded" in _column_names(engine, "battle_pulls")
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT refunded FROM battle_pulls WHERE battle_id = 'vb1' AND player_wallet = 'walletA'"
        )).fetchone()
    assert row[0] == 1, "upgrade path: pre-existing voided battle's pull should be backfilled to refunded=1"

    # 3) Insert a SECOND voided battle + a pull that is explicitly still pending
    # (refunded=0) — simulating a battle that voided AFTER the column already existed.
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO pack_battles (id, mode, machine_code, price, max_players, status, "
            "gimmighouls_awarded, fee_charged, created_at) VALUES "
            "('vb2', 'pack', 'm', 50000000, 2, 'voided', 0, 0, '2026-02-01 00:00:00')"
        ))
        conn.execute(text(
            "INSERT INTO battle_pulls (battle_id, player_wallet, memo, auto_sold, "
            "transferred, refunded, round_number) VALUES ('vb2', 'walletB', 'memoB', 0, 0, 0, 1)"
        ))

    # Running init_db a THIRD time must NOT re-run the backfill (the column already
    # exists from step 2) — the still-pending refund for vb2/walletB must survive untouched.
    init_db(engine)
    with engine.connect() as conn:
        row_vb2 = conn.execute(text(
            "SELECT refunded FROM battle_pulls WHERE battle_id = 'vb2' AND player_wallet = 'walletB'"
        )).fetchone()
        row_vb1 = conn.execute(text(
            "SELECT refunded FROM battle_pulls WHERE battle_id = 'vb1' AND player_wallet = 'walletA'"
        )).fetchone()
    assert row_vb2[0] == 0, (
        "gate regression: backfill must NOT re-run once the column exists — a freshly "
        "voided battle's pending refund would otherwise be silently marked done (players unpaid)"
    )
    assert row_vb1[0] == 1, "the earlier upgrade-path backfill should not be undone by the no-op run"
