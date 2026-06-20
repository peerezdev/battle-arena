"""Tests for build_nft_transfer — SPL NFT escrow→winner transaction builder."""
import base64

import pytest
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address

from app.services.solana_tx import (
    build_nft_transfer,
    TOKEN_PROGRAM,
    ATA_PROGRAM,
)

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------
ESCROW   = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
DEST     = "A4ahkivAG4NoZAE8Sy4qv8nn2DU9yoXRQcttuCeGtTJv"
MINT     = "So11111111111111111111111111111111111111112"   # wrapped SOL mint (valid devnet-style pubkey)
BLOCKHASH = "11111111111111111111111111111111"             # 32-zero-byte hash, always valid

TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"


@pytest.fixture()
def default_tx() -> Transaction:
    """Build a transaction with default (classic SPL) token program and decode it."""
    out = build_nft_transfer(ESCROW, DEST, MINT, BLOCKHASH)
    return Transaction.from_bytes(base64.b64decode(out))


# ---------------------------------------------------------------------------
# Test 1: basic structure
# ---------------------------------------------------------------------------
class TestBuildNftTransferStructure:
    def test_returns_string(self):
        out = build_nft_transfer(ESCROW, DEST, MINT, BLOCKHASH)
        assert isinstance(out, str)

    def test_base64_roundtrip(self):
        out = build_nft_transfer(ESCROW, DEST, MINT, BLOCKHASH)
        tx = Transaction.from_bytes(base64.b64decode(out))
        assert tx is not None

    def test_fee_payer_is_escrow(self, default_tx):
        assert default_tx.message.account_keys[0] == Pubkey.from_string(ESCROW)

    def test_exactly_two_instructions(self, default_tx):
        assert len(default_tx.message.instructions) == 2

    def test_ata_create_instruction_data(self, default_tx):
        """The ATA-create instruction must use discriminator 1 (CreateIdempotent)."""
        ata_prog = Pubkey.from_string(ATA_PROGRAM)
        keys = default_tx.message.account_keys
        create_ix = next(
            ix for ix in default_tx.message.instructions
            if keys[ix.program_id_index] == ata_prog
        )
        # Compiled instruction data is bytes-like
        assert bytes(create_ix.data) == bytes([1])

    def test_transfer_checked_instruction_data(self, default_tx):
        """transfer_checked must use discriminator 12, amount=1 LE u64, decimals=0."""
        token_prog = Pubkey.from_string(TOKEN_PROGRAM)
        keys = default_tx.message.account_keys
        transfer_ix = next(
            ix for ix in default_tx.message.instructions
            if keys[ix.program_id_index] == token_prog
        )
        expected = bytes([12]) + (1).to_bytes(8, "little") + bytes([0])
        assert bytes(transfer_ix.data) == expected

    def test_src_ata_in_account_keys(self, default_tx):
        token_prog = Pubkey.from_string(TOKEN_PROGRAM)
        src_ata = get_associated_token_address(
            Pubkey.from_string(ESCROW), Pubkey.from_string(MINT), token_prog
        )
        assert src_ata in default_tx.message.account_keys

    def test_dest_ata_in_account_keys(self, default_tx):
        token_prog = Pubkey.from_string(TOKEN_PROGRAM)
        dest_ata = get_associated_token_address(
            Pubkey.from_string(DEST), Pubkey.from_string(MINT), token_prog
        )
        assert dest_ata in default_tx.message.account_keys


# ---------------------------------------------------------------------------
# Test 2: custom token_program (Token-2022)
# ---------------------------------------------------------------------------
class TestBuildNftTransferToken2022:
    def test_token2022_transfer_ix_uses_custom_program(self):
        """Passing Token-2022 id routes the transfer_checked to that program."""
        out = build_nft_transfer(ESCROW, DEST, MINT, BLOCKHASH, token_program=TOKEN_2022)
        tx = Transaction.from_bytes(base64.b64decode(out))
        token2022_pk = Pubkey.from_string(TOKEN_2022)
        keys = tx.message.account_keys
        transfer_ix = next(
            ix for ix in tx.message.instructions
            if keys[ix.program_id_index] == token2022_pk
        )
        expected = bytes([12]) + (1).to_bytes(8, "little") + bytes([0])
        assert bytes(transfer_ix.data) == expected

    def test_token2022_ata_create_uses_custom_token_prog(self):
        """ATA-create instruction must reference Token-2022 as the token program."""
        out = build_nft_transfer(ESCROW, DEST, MINT, BLOCKHASH, token_program=TOKEN_2022)
        tx = Transaction.from_bytes(base64.b64decode(out))
        token2022_pk = Pubkey.from_string(TOKEN_2022)
        ata_prog_pk  = Pubkey.from_string(ATA_PROGRAM)
        keys = tx.message.account_keys
        create_ix = next(
            ix for ix in tx.message.instructions
            if keys[ix.program_id_index] == ata_prog_pk
        )
        # The token program (last account in create ix) must be Token-2022
        last_account_idx = create_ix.accounts[-1]
        assert keys[last_account_idx] == token2022_pk

    def test_token2022_fee_payer_still_escrow(self):
        out = build_nft_transfer(ESCROW, DEST, MINT, BLOCKHASH, token_program=TOKEN_2022)
        tx = Transaction.from_bytes(base64.b64decode(out))
        assert tx.message.account_keys[0] == Pubkey.from_string(ESCROW)
