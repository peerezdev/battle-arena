import pytest
from app.chain.mock import MockChainSource
from app.services.matches import register_match, list_open, sync_match, MatchError
from app.services.users import get_or_create_user


async def test_register_rejects_duplicate(Session):
    chain = MockChainSource(); chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        await register_match(s, chain, creator="A", battle_pubkey="B1", min_elo=None, max_elo=None, elo_start=1200)
        s.commit()
    with Session() as s:
        with pytest.raises(MatchError):
            await register_match(s, chain, creator="A", battle_pubkey="B1", min_elo=None, max_elo=None, elo_start=1200)


async def test_sync_settled_without_opponent(Session):
    chain = MockChainSource(); chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        await register_match(s, chain, creator="A", battle_pubkey="B1", min_elo=None, max_elo=None, elo_start=1200)
        s.commit()
    chain.settle("B1", winner=None)  # liquidada sin que nadie se uniera
    with Session() as s:
        m = await sync_match(s, chain, "B1", elo_start=1200, k=32)
        s.commit()
        assert m.status == "settled" and m.elo_applied is True and m.opponent is None


async def test_list_open_without_viewer_no_enrichment(Session):
    chain = MockChainSource(); chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        await register_match(s, chain, creator="A", battle_pubkey="B1", min_elo=None, max_elo=None, elo_start=1200)
        s.commit()
        rows = list_open(s, viewer=None)
        assert "joinable" not in rows[0] and rows[0]["battle_pubkey"] == "B1"


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


async def test_sync_chain_missing_raises_matcherror(Session):
    chain = MockChainSource(); chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        await register_match(s, chain, creator="A", battle_pubkey="B1", min_elo=None, max_elo=None, elo_start=1200)
        s.commit()
    chain._battles.pop("B1")  # la cuenta on-chain desaparece
    with Session() as s:
        with pytest.raises(MatchError):
            await sync_match(s, chain, "B1", elo_start=1200, k=32)


async def test_sync_settled_winner_none_with_opponent_is_draw(Session):
    chain = MockChainSource(); chain.set_battle("B1", player_a="A", stake=100)
    with Session() as s:
        await register_match(s, chain, creator="A", battle_pubkey="B1", min_elo=None, max_elo=None, elo_start=1200)
        s.commit()
    chain.join("B1", player_b="B")
    chain.settle("B1", winner=None, is_draw=False)  # estado ambiguo: defensivo -> empate
    with Session() as s:
        m = await sync_match(s, chain, "B1", elo_start=1200, k=32)
        s.commit()
        a = get_or_create_user(s, "A", 1200); b = get_or_create_user(s, "B", 1200)
        assert a.elo == 1200 and b.elo == 1200  # empate entre iguales -> sin cambio
        assert m.is_draw is False  # se refleja el estado on-chain real, pero el rating fue de empate


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
