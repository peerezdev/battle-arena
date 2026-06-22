import base64
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from app.services.nft_transfer import (
    build_core_transfer, read_core_collection, MPL_CORE_PROGRAM, SYS_PROGRAM)

ASSET = "4VE7wrGvS3hBNb9kyManAx2pWmRQJftQAqGsEE7C5Tff"
ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
WINNER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
COLLECTION = "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac"
BLOCKHASH = "11111111111111111111111111111111"


def _core_ix(out):
    tx = Transaction.from_bytes(base64.b64decode(out))
    keys = tx.message.account_keys
    core = Pubkey.from_string(MPL_CORE_PROGRAM)
    ix = next(i for i in tx.message.instructions if keys[i.program_id_index] == core)
    return tx, keys, ix


def test_build_core_transfer_with_collection():
    tx, keys, ix = _core_ix(build_core_transfer(ESCROW, WINNER, ASSET, BLOCKHASH, collection=COLLECTION))
    assert keys[0] == Pubkey.from_string(ESCROW)            # fee payer
    assert bytes(ix.data) == bytes([14, 0])                 # TransferV1, compression_proof None
    assert len(ix.accounts) == 7
    a = [str(keys[i]) for i in ix.accounts]
    assert a == [ASSET, COLLECTION, ESCROW, ESCROW, WINNER, str(SYS_PROGRAM), MPL_CORE_PROGRAM]


def test_build_core_transfer_no_collection_uses_program_id():
    tx, keys, ix = _core_ix(build_core_transfer(ESCROW, WINNER, ASSET, BLOCKHASH, collection=None))
    a = [str(keys[i]) for i in ix.accounts]
    assert a[1] == MPL_CORE_PROGRAM                         # None → CoRE program id


def test_read_core_collection_variant2_returns_pubkey():
    data = bytes([1]) + bytes(32) + bytes([2]) + bytes(Pubkey.from_string(COLLECTION))
    assert str(read_core_collection(data)) == COLLECTION


def test_read_core_collection_variant1_or_0_returns_none():
    assert read_core_collection(bytes([1]) + bytes(32) + bytes([1]) + bytes(32)) is None
    assert read_core_collection(bytes([1]) + bytes(32) + bytes([0])) is None


def test_read_core_collection_truncated_returns_none():
    assert read_core_collection(b"\x01" + b"\x00" * 10) is None
