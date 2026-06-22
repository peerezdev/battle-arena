"""Pack Battle lobby: create/join/list with an atomic fill guard. Pure DB logic — USDC/session-signer
checks live in the endpoint layer (they need RPC/Privy). Generates the Provably-Fair server seed."""
from __future__ import annotations
import uuid
from sqlalchemy import update
from app.models import PackBattle, BattlePlayer, BattleRound, BattlePull
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
                   max_players=max_players, status="lobby", server_seed=seed, server_seed_hash=h,
                   creator_wallet=creator_wallet)
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


def cancel_battle(session, battle_id, wallet) -> PackBattle:
    b = session.get(PackBattle, battle_id)
    if b is None:
        raise LobbyError("no existe")
    if b.creator_wallet != wallet:
        raise LobbyError("solo el creador puede cancelar")
    if b.status != "lobby":
        raise LobbyError("solo se puede cancelar un lobby no iniciado")
    b.status = "cancelled"
    session.commit()
    return b


def _player_states(session, battle_id):
    return [{"wallet": p.player_wallet, "eliminated_round": p.eliminated_round,
             "accumulated_value": p.accumulated_value}
            for p in session.query(BattlePlayer).filter_by(battle_id=battle_id)
            .order_by(BattlePlayer.joined_at).all()]


def _rounds(session, battle_id):
    return [{"round_number": r.round_number, "eliminated_wallet": r.eliminated_wallet,
             "tie_break_index": r.tie_break_index}
            for r in session.query(BattleRound).filter_by(battle_id=battle_id)
            .order_by(BattleRound.round_number).all()]


def _pull_recap(session, battle_id):
    return [{"round_number": p.round_number, "player_wallet": p.player_wallet,
             "nft_address": p.nft_address, "rarity": p.rarity,
             "insured_value": p.insured_value, "auto_sold": p.auto_sold}
            for p in session.query(BattlePull).filter_by(battle_id=battle_id)
            .order_by(BattlePull.round_number, BattlePull.id).all()]


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
           "creator_wallet": b.creator_wallet,
           "players": _player_states(session, battle_id),
           "rounds": _rounds(session, battle_id),
           "server_seed_hash": b.server_seed_hash}
    if b.status == "settled":   # reveal + recap only after settle (secrecy)
        out.update(server_seed=b.server_seed, client_seed=b.client_seed,
                   tie_break_index=b.tie_break_index, pulls=_pull_recap(session, battle_id))
    return out


def verification(session, battle):
    """Commit-reveal proof. server_seed/commit_ok revealed only post-settle. Per-round for royale."""
    settled = battle.status == "settled"
    out = {
        "mode": battle.mode,
        "server_seed_hash": battle.server_seed_hash,
        "server_seed": battle.server_seed if settled else None,
        "commit_ok": (verify_commit(battle.server_seed, battle.server_seed_hash)
                      if settled and battle.server_seed else None),
    }
    if battle.mode == "royale":
        out["rounds"] = [{"round_number": r.round_number, "client_seed": r.client_seed,
                          "eliminated_wallet": r.eliminated_wallet, "tie_break_index": r.tie_break_index}
                         for r in session.query(BattleRound).filter_by(battle_id=battle.id)
                         .order_by(BattleRound.round_number).all()]
    else:
        out["client_seed"] = battle.client_seed
        out["tie_break_index"] = battle.tie_break_index
    return out
