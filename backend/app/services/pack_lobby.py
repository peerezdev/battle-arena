"""Pack Battle lobby: create/join/list with an atomic fill guard. Pure DB logic — USDC/session-signer
checks live in the endpoint layer (they need RPC/Privy). Generates the Provably-Fair server seed."""
from __future__ import annotations
import uuid
from sqlalchemy import update
from app.models import PackBattle, BattlePlayer
from app.services.provably_fair import gen_server_seed, verify_commit


class LobbyError(Exception):
    pass


class ModeNotSupported(LobbyError):
    pass


def create_battle(session, creator_wallet, creator_wallet_id, *, machine_code, price, max_players, mode="pack"):
    if mode not in ("pack", "royale"):
        raise ModeNotSupported(f"Modo '{mode}' no soportado")
    if not (2 <= max_players <= 10):
        raise LobbyError("max_players debe estar entre 2 y 10")
    seed, h = gen_server_seed()
    b = PackBattle(id=uuid.uuid4().hex, mode=mode, machine_code=machine_code, price=price,
                   max_players=max_players, status="lobby", server_seed=seed, server_seed_hash=h)
    session.add(b)
    session.add(BattlePlayer(battle_id=b.id, player_wallet=creator_wallet, wallet_id=creator_wallet_id))
    session.commit()
    return b


def join_battle(session, battle_id, player_wallet, player_wallet_id):
    b = session.get(PackBattle, battle_id)
    if b is None or b.status != "lobby":
        raise LobbyError("partida no disponible")
    players = session.query(BattlePlayer).filter_by(battle_id=battle_id).all()
    if any(p.player_wallet == player_wallet for p in players):
        raise LobbyError("ya estás en la partida")
    if len(players) >= b.max_players:
        raise LobbyError("partida llena")
    session.add(BattlePlayer(battle_id=battle_id, player_wallet=player_wallet, wallet_id=player_wallet_id))
    session.commit()
    count = session.query(BattlePlayer).filter_by(battle_id=battle_id).count()
    filled = False
    if count >= b.max_players:
        # atomic flip: only the caller that flips lobby→running triggers the run
        res = session.execute(update(PackBattle).where(PackBattle.id == battle_id,
                                                       PackBattle.status == "lobby")
                              .values(status="running"))
        session.commit()
        filled = res.rowcount == 1
        session.refresh(b)
    return b, filled


def _players(session, battle_id):
    return [p.player_wallet for p in session.query(BattlePlayer)
            .filter_by(battle_id=battle_id).order_by(BattlePlayer.joined_at).all()]


def list_open(session):
    return [{"id": b.id, "machine_code": b.machine_code, "price": b.price, "max_players": b.max_players,
             "players": session.query(BattlePlayer).filter_by(battle_id=b.id).count()}
            for b in session.query(PackBattle).filter_by(status="lobby").all()]


def get_battle(session, battle_id):
    b = session.get(PackBattle, battle_id)
    if b is None:
        raise LobbyError("no existe")
    out = {"id": b.id, "mode": b.mode, "machine_code": b.machine_code, "price": b.price,
           "max_players": b.max_players, "status": b.status, "winner": b.winner,
           "players": _players(session, battle_id), "server_seed_hash": b.server_seed_hash}
    if b.status == "settled":   # reveal only after settle
        out.update(server_seed=b.server_seed, client_seed=b.client_seed, tie_break_index=b.tie_break_index)
    return out


def verification(b):
    return {"server_seed_hash": b.server_seed_hash, "server_seed": b.server_seed if b.status == "settled" else None,
            "client_seed": b.client_seed, "tie_break_index": b.tie_break_index,
            "commit_ok": verify_commit(b.server_seed, b.server_seed_hash) if b.server_seed else None}
