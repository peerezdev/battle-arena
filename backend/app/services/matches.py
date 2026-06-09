from __future__ import annotations

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
    creator_wallets = {m.creator for m in matches}
    if viewer is not None:
        creator_wallets.add(viewer)
    users = {u.wallet: u for u in session.scalars(select(User).where(User.wallet.in_(creator_wallets)))} if creator_wallets else {}
    viewer_elo = users[viewer].elo if (viewer is not None and viewer in users) else None
    out = []
    for m in matches:
        creator = users.get(m.creator)
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
    m = session.get(Match, battle_pubkey, with_for_update=True)
    if m is None:
        raise MatchError("partida no registrada")
    try:
        bs = await chain.get_battle(battle_pubkey)
    except BattleNotFound:
        raise MatchError("la batalla no existe on-chain")

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

        if bs["is_draw"] or bs["winner"] is None:
            score_a, res_a, res_b = 0.5, "draw", "draw"
        elif bs["winner"] == a.wallet:
            score_a, res_a, res_b = 1.0, "win", "loss"
        elif bs["winner"] == b.wallet:
            score_a, res_a, res_b = 0.0, "loss", "win"
        else:
            raise MatchError(f"estado on-chain inconsistente: winner {bs['winner']} no es ninguno de los jugadores")

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
