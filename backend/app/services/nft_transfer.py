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
