"""Multi-standard NFT transfer (escrow→winner). Pure builders + async resolvers.
v1: pNFT (Metaplex Transfer) + Standard (SPL). cNFT/MPL Core raise UnsupportedNftStandard."""
from __future__ import annotations
import struct
from typing import Optional
from solders.pubkey import Pubkey

METADATA_PROGRAM = Pubkey.from_string("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
_META = bytes(METADATA_PROGRAM)


def metadata_pda(mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"metadata", _META, bytes(mint)], METADATA_PROGRAM)[0]


def master_edition_pda(mint: Pubkey) -> Pubkey:
    return Pubkey.find_program_address([b"metadata", _META, bytes(mint), b"edition"], METADATA_PROGRAM)[0]


def token_record_pda(mint: Pubkey, ata: Pubkey) -> Pubkey:
    return Pubkey.find_program_address(
        [b"metadata", _META, bytes(mint), b"token_record", bytes(ata)], METADATA_PROGRAM)[0]


import base64
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address

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
    """Sequential Borsh walk of a Token Metadata account → programmable_config.ruleSet (or None)."""
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
