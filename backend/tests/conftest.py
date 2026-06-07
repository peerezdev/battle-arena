import pytest
from app.db import make_engine, make_session_factory, init_db


@pytest.fixture
def Session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    return make_session_factory(engine)
