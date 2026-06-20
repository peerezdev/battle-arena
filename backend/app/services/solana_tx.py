"""
Solana NFT transfer transaction builder for BattleArena Pack Battle escrow→winner transfers.

Builds an unsigned legacy transaction that:
  1. Creates the destination ATA idempotently (CreateIdempotent)
  2. Transfers 1 unit of the NFT mint via transfer_checked

Scope: regular SPL Token NFTs (graded cards).
Compressed NFTs (cNFT / Bubblegum + DAS) are out of scope and need a different path.
"""

import base64
from solders.pubkey import Pubkey
from solders.hash import Hash
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address

TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"   # classic SPL Token program
ATA_PROGRAM   = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"   # associated-token-account program
SYS_PROGRAM   = "11111111111111111111111111111111"


def build_nft_transfer(
    escrow_address: str,
    dest_address: str,
    mint: str,
    recent_blockhash: str,
    token_program: str = TOKEN_PROGRAM,
) -> str:
    """
    Return an unsigned legacy Solana transaction (base64-encoded) that transfers
    1 unit of `mint` (a non-fungible SPL token) from the escrow's ATA to the
    destination's ATA, creating the destination ATA idempotently if needed.

    Fee payer = escrow.  The escrow is the only required signer (fee payer,
    ATA-create payer, and transfer authority).

    Args:
        escrow_address:   Base58 pubkey of the escrow account.
        dest_address:     Base58 pubkey of the winner / destination wallet.
        mint:             Base58 pubkey of the NFT mint.
        recent_blockhash: Base58 blockhash string (e.g. from getLatestBlockhash).
        token_program:    Token program id (default = classic SPL Token).
                          Pass Token-2022 id for Token-2022 NFTs.

    Returns:
        Base64-encoded bytes of the unsigned transaction.
    """
    # -- Pubkeys --
    escrow_pk      = Pubkey.from_string(escrow_address)
    dest_pk        = Pubkey.from_string(dest_address)
    mint_pk        = Pubkey.from_string(mint)
    token_prog_pk  = Pubkey.from_string(token_program)
    ata_prog_pk    = Pubkey.from_string(ATA_PROGRAM)
    sys_prog_pk    = Pubkey.from_string(SYS_PROGRAM)
    blockhash      = Hash.from_string(recent_blockhash)

    # -- Derive ATAs --
    src_ata  = get_associated_token_address(escrow_pk, mint_pk, token_prog_pk)
    dest_ata = get_associated_token_address(dest_pk,   mint_pk, token_prog_pk)

    # -- Instruction 1: CreateIdempotent ATA for destination --
    # discriminator 1 = CreateIdempotent (0 = Create, raises if already exists)
    create_ix = Instruction(
        ata_prog_pk,
        bytes([1]),
        [
            AccountMeta(escrow_pk,    is_signer=True,  is_writable=True),   # payer
            AccountMeta(dest_ata,     is_signer=False, is_writable=True),   # ATA being created
            AccountMeta(dest_pk,      is_signer=False, is_writable=False),  # ATA owner
            AccountMeta(mint_pk,      is_signer=False, is_writable=False),
            AccountMeta(sys_prog_pk,  is_signer=False, is_writable=False),
            AccountMeta(token_prog_pk, is_signer=False, is_writable=False),
        ],
    )

    # -- Instruction 2: transfer_checked (discriminator 12) --
    # data: [12] + amount(u64 LE) + decimals(u8)
    transfer_data = bytes([12]) + (1).to_bytes(8, "little") + bytes([0])
    transfer_ix = Instruction(
        token_prog_pk,
        transfer_data,
        [
            AccountMeta(src_ata,      is_signer=False, is_writable=True),   # source = escrow's ATA
            AccountMeta(mint_pk,      is_signer=False, is_writable=False),
            AccountMeta(dest_ata,     is_signer=False, is_writable=True),
            AccountMeta(escrow_pk,    is_signer=True,  is_writable=False),  # transfer authority
        ],
    )

    # -- Assemble transaction --
    message = Message.new_with_blockhash([create_ix, transfer_ix], escrow_pk, blockhash)
    tx = Transaction.new_unsigned(message)
    return base64.b64encode(bytes(tx)).decode()
