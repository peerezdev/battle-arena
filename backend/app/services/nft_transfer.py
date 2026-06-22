"""Multi-standard NFT transfer (escrow→winner). Pure builders + async resolvers.
v1: pNFT (Metaplex Transfer) + Standard (SPL). cNFT/MPL Core raise UnsupportedNftStandard."""
from __future__ import annotations
import base64
import struct
import httpx
from typing import Optional
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address

METADATA_PROGRAM = Pubkey.from_string("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
_META = bytes(METADATA_PROGRAM)


def metadata_pda(mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"metadata", _META, bytes(mint)], METADATA_PROGRAM)[0]


def master_edition_pda(mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"metadata", _META, bytes(mint), b"edition"], METADATA_PROGRAM)[0]


def token_record_pda(mint: Pubkey, ata: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"metadata", _META, bytes(mint), b"token_record", bytes(ata)], METADATA_PROGRAM)[0]


TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
AUTH_RULES_PROGRAM = Pubkey.from_string("auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg")
SYS_PROGRAM = Pubkey.from_string("11111111111111111111111111111111")
SYSVAR_INSTRUCTIONS = Pubkey.from_string("Sysvar1nstructions1111111111111111111111111")
COMPUTE_BUDGET = Pubkey.from_string("ComputeBudget111111111111111111111111111111")

# TransferV1 canonical flags (is_signer, is_writable), indices 0..16
_PNFT_FLAGS = [
    (False, True), (False, False), (False, True), (False, False), (False, False),
    (False, True), (False, False), (False, True), (False, True), (True, False),
    (True, True), (False, False), (False, False), (False, False), (False, False),
    (False, False), (False, False),
]


def build_pnft_transfer(escrow: str, winner: str, mint: str, recent_blockhash: str,
                        *, ruleset: str) -> str:
    esc = Pubkey.from_string(escrow); win = Pubkey.from_string(winner); mnt = Pubkey.from_string(mint)
    esc_ata = get_associated_token_address(esc, mnt)
    win_ata = get_associated_token_address(win, mnt)
    accounts = [
        esc_ata,                              # 0 source token
        esc,                                  # 1 token_owner
        win_ata,                              # 2 destination token
        win,                                  # 3 destination_owner
        mnt,                                  # 4 mint
        metadata_pda(mnt),                    # 5 metadata
        master_edition_pda(mnt),              # 6 master edition
        token_record_pda(mnt, esc_ata),       # 7 owner token record
        token_record_pda(mnt, win_ata),       # 8 destination token record
        esc,                                  # 9 authority
        esc,                                  # 10 payer
        SYS_PROGRAM,                          # 11
        SYSVAR_INSTRUCTIONS,                  # 12
        TOKEN_PROGRAM,                        # 13
        ATA_PROGRAM,                          # 14
        AUTH_RULES_PROGRAM,                   # 15
        Pubkey.from_string(ruleset),          # 16
    ]
    metas = [AccountMeta(pubkey=accounts[i], is_signer=_PNFT_FLAGS[i][0], is_writable=_PNFT_FLAGS[i][1])
             for i in range(17)]
    data = bytes([49, 0]) + (1).to_bytes(8, "little") + bytes([0])  # Transfer, V1, amount=1, auth_data=None
    transfer_ix = Instruction(METADATA_PROGRAM, data, metas)
    cu_ix = Instruction(COMPUTE_BUDGET, bytes([2]) + (400000).to_bytes(4, "little"), [])
    msg = Message.new_with_blockhash([cu_ix, transfer_ix], esc, Hash.from_string(recent_blockhash))
    return base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()


def read_pnft_ruleset(data: bytes) -> Optional[Pubkey]:
    """Sequential Borsh walk of a Token Metadata account → programmable_config.ruleSet (or None).
    Returns None on any truncated/old-format buffer (caller voids rather than moving assets blindly)."""
    try:
        o = 1 + 32 + 32  # key + update_authority + mint
        for _ in range(3):  # name, symbol, uri (borsh String: u32 len + bytes)
            n = struct.unpack_from("<I", data, o)[0]; o += 4 + n
        o += 2  # seller_fee_basis_points u16
        if data[o] == 1:  # creators: Option<Vec<Creator>>
            n = struct.unpack_from("<I", data, o + 1)[0]; o = o + 1 + 4 + n * 34
        else:
            o += 1
        o += 1 + 1  # primary_sale_happened + is_mutable
        for _ in range(2):  # edition_nonce, token_standard (Option<u8>)
            o = o + 2 if data[o] == 1 else o + 1
        o = o + 1 + 33 if data[o] == 1 else o + 1  # collection Option<Collection>
        o = o + 1 + 17 if data[o] == 1 else o + 1  # uses Option<Uses>
        o = o + 1 + (1 + 8) if data[o] == 1 else o + 1  # collection_details Option (V1: u64)
        if data[o] == 1:  # programmable_config Option<ProgrammableConfig>
            o += 1  # Some
            o += 1  # variant (V1 = 0)
            if data[o] == 1:  # rule_set Option<Pubkey>
                return Pubkey.from_bytes(data[o + 1:o + 1 + 32])
        return None
    except (IndexError, struct.error):
        return None


# ---------------------------------------------------------------------------
# Detection + dispatcher + submit
# ---------------------------------------------------------------------------
MPL_CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
_MPL_CORE_PK = Pubkey.from_string(MPL_CORE_PROGRAM)


def read_core_collection(data: bytes) -> Optional[Pubkey]:
    """MPL Core AssetV1: key(1) + owner(32) + update_authority enum.
    Variant 2 == Collection → next 32 bytes are the collection pubkey; variants 0/1 → None.
    Returns None on any truncated buffer (caller transfers without a collection)."""
    try:
        o = 1 + 32  # key + owner
        if data[o] == 2:  # Collection
            return Pubkey.from_bytes(data[o + 1:o + 1 + 32])
        return None
    except (IndexError, ValueError):
        return None


def build_core_transfer(escrow: str, winner: str, mint: str, recent_blockhash: str,
                        *, collection: Optional[str]) -> str:
    esc = Pubkey.from_string(escrow); win = Pubkey.from_string(winner); asset = Pubkey.from_string(mint)
    coll = Pubkey.from_string(collection) if collection else _MPL_CORE_PK  # None → program id
    metas = [
        AccountMeta(asset,    is_signer=False, is_writable=True),                       # 0 asset
        AccountMeta(coll,     is_signer=False, is_writable=(collection is not None)),   # 1 collection|None
        AccountMeta(esc,      is_signer=True,  is_writable=True),                       # 2 payer
        AccountMeta(esc,      is_signer=True,  is_writable=False),                      # 3 authority (owner)
        AccountMeta(win,      is_signer=False, is_writable=False),                      # 4 new_owner
        AccountMeta(SYS_PROGRAM, is_signer=False, is_writable=False),                   # 5 system_program
        AccountMeta(_MPL_CORE_PK, is_signer=False, is_writable=False),                  # 6 log_wrapper (None)
    ]
    transfer_ix = Instruction(_MPL_CORE_PK, bytes([14, 0]), metas)  # TransferV1, compression_proof None
    cu_ix = Instruction(COMPUTE_BUDGET, bytes([2]) + (100000).to_bytes(4, "little"), [])
    msg = Message.new_with_blockhash([cu_ix, transfer_ix], esc, Hash.from_string(recent_blockhash))
    return base64.b64encode(bytes(Transaction.new_unsigned(msg))).decode()


class UnsupportedNftStandard(Exception):
    pass


async def _get_account(rpc_url: str, pubkey: str) -> Optional[dict]:
    async with httpx.AsyncClient() as c:
        r = await c.post(
            rpc_url,
            json={"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
                  "params": [pubkey, {"encoding": "base64"}]},
            timeout=20,
        )
        r.raise_for_status()
        return (r.json().get("result") or {}).get("value")


def _token_standard(data: bytes) -> Optional[int]:
    """Walk Borsh-encoded Token Metadata account bytes to the token_standard Option<u8>."""
    o = 1 + 32 + 32  # key + update_authority + mint
    for _ in range(3):  # name, symbol, uri
        n = struct.unpack_from("<I", data, o)[0]; o += 4 + n
    o += 2  # seller_fee_basis_points
    if data[o] == 1:  # creators Option<Vec<Creator>>
        n = struct.unpack_from("<I", data, o + 1)[0]; o = o + 1 + 4 + n * 34
    else:
        o += 1
    o += 1 + 1  # primary_sale_happened + is_mutable
    o = o + 2 if data[o] == 1 else o + 1  # edition_nonce Option<u8>
    if data[o] == 1:  # token_standard Some
        return data[o + 1]
    return None


async def detect_standard(rpc_url: str, mint: str) -> str:
    """Return 'pnft' | 'standard' | 'cnft' | 'core' | 'unknown'."""
    info = await _get_account(rpc_url, mint)
    if info is None:
        return "cnft"  # no mint account → compressed NFT (lives in a Merkle tree)
    if info.get("owner") == MPL_CORE_PROGRAM:
        return "core"
    if info.get("owner") != str(TOKEN_PROGRAM):
        return "unknown"
    # Classic SPL mint → inspect metadata token_standard field
    meta = await _get_account(rpc_url, str(metadata_pda(Pubkey.from_string(mint))))
    if meta is None:
        return "standard"
    raw = base64.b64decode(meta["data"][0])
    return "pnft" if _token_standard(raw) == 4 else "standard"


async def build_transfer(rpc_url: str, escrow: str, winner: str, mint: str, blockhash: str) -> str:
    """Dispatch to the correct builder; raise UnsupportedNftStandard for unsupported standards."""
    std = await detect_standard(rpc_url, mint)
    if std == "pnft":
        meta = await _get_account(rpc_url, str(metadata_pda(Pubkey.from_string(mint))))
        ruleset = read_pnft_ruleset(base64.b64decode(meta["data"][0]))
        if ruleset is None:
            raise UnsupportedNftStandard("pnft with no ruleset is not supported in v1")
        return build_pnft_transfer(escrow, winner, mint, blockhash, ruleset=str(ruleset))
    if std == "standard":
        from app.services.solana_tx import build_nft_transfer
        return build_nft_transfer(escrow, winner, mint, blockhash)
    if std == "core":
        info = await _get_account(rpc_url, mint)
        coll = read_core_collection(base64.b64decode(info["data"][0])) if info else None
        return build_core_transfer(escrow, winner, mint, blockhash,
                                   collection=str(coll) if coll else None)
    raise UnsupportedNftStandard(f"standard={std!r} is not supported")


async def nft_in_owner(rpc_url: str, owner: str, mint: str) -> bool:
    """True iff `owner` holds >=1 of `mint` (any token program) on-chain."""
    async with httpx.AsyncClient() as c:
        r = await c.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "getTokenAccountsByOwner",
                                        "params": [owner, {"mint": mint}, {"encoding": "jsonParsed"}]}, timeout=20)
        r.raise_for_status()
        for a in (r.json().get("result") or {}).get("value", []):
            amt = a["account"]["data"]["parsed"]["info"]["tokenAmount"]["uiAmountString"]
            if amt and float(amt) >= 1:
                return True
    return False


async def submit_signed_tx(rpc_url: str, signed_tx_b64: str) -> str:
    """POST sendTransaction; raise on RPC error; return the transaction signature."""
    async with httpx.AsyncClient() as c:
        r = await c.post(
            rpc_url,
            json={"jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
                  "params": [signed_tx_b64, {"encoding": "base64"}]},
            timeout=30,
        )
        r.raise_for_status()
        d = r.json()
        if d.get("error"):
            raise RuntimeError(f"sendTransaction failed: {d['error']}")
        return d["result"]
