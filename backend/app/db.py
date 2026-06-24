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
    ("pack_battles", "gimmighouls_awarded", "BOOLEAN NOT NULL DEFAULT 0"),
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


def init_db(engine):
    # importa los modelos para registrarlos en Base.metadata antes de create_all
    from . import models  # noqa: F401
    Base.metadata.create_all(engine)
    _ensure_columns(engine)
