from .base import BattleState, BattleNotFound


class SolanaChainSource:
    """Lector real de la cuenta Battle on-chain. ESQUELETO: a validar contra devnet
    cuando el programa esté desplegado.

    Decodifica la cuenta Anchor `Battle` (ver onchain/programs/battle_arena/src/state.rs):
    8 bytes de discriminador + layout Borsh:
      player_a: Pubkey[32], player_b... — OJO: en el contrato player_b se rellena en join;
      antes de eso la cuenta solo existe si el creador la inicializó (phase=Created).
      ... value/grade/oracle/stake_mint/stake/cfg/edge/banked/wins/round/phase(enum u8)/
      commit_a/b/reveal_a/b(Option)/deadlines/winner(Option<u8>)/is_draw(bool)/nonce/bump...

    Mapeo de salida:
      phase: u8 -> 'Created'|'Committing'|'Revealing'|'RoundResolved'|'Settled'|'Closed'
      winner: Option<u8> (0=player_a, 1=player_b) -> wallet base58 o None
      player_b: si está a ceros / no asignado -> None
    """

    PHASES = ["Created", "Committing", "Revealing", "RoundResolved", "Settled", "Closed"]

    def __init__(self, rpc_url: str, program_id: str) -> None:
        self._rpc_url = rpc_url
        self._program_id = program_id

    async def get_battle(self, battle: str) -> BattleState:
        # TODO(devnet): implementar contra el programa desplegado:
        #   1. POST JSON-RPC getAccountInfo(battle, encoding=base64) a self._rpc_url
        #   2. si no existe -> raise BattleNotFound(battle)
        #   3. base64-decode los datos, saltar 8 bytes de discriminador
        #   4. decodificar el struct Battle con la MISMA disposición que state.rs
        #      (usar borsh-construct o un parser manual; validar offsets contra una
        #       batalla real en devnet)
        #   5. mapear phase (PHASES[idx]), winner (0->player_a / 1->player_b -> wallet),
        #      player_b (None si sin asignar), is_draw, stake
        raise NotImplementedError(
            "SolanaChainSource pendiente de validar contra devnet; el MVP usa MockChainSource"
        )
