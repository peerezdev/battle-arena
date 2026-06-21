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


def build_token_transfer(
    source_address: str,
    dest_address: str,
    mint: str,
    recent_blockhash: str,
    *,
    amount: int = 1,
    decimals: int = 0,
    fee_payer: str = None,
    token_program: str = TOKEN_PROGRAM,
) -> str:
    """
    Return an unsigned legacy Solana transaction (base64-encoded) that transfers
    `amount` units of `mint` from the source's ATA to the destination's ATA,
    creating the destination ATA idempotently if needed.

    Fee payer = fee_payer if given, else source.  When fee_payer != source,
    both are marked is_signer=True (2-signer tx).

    Args:
        source_address:   Base58 pubkey of the source (token authority) account.
        dest_address:     Base58 pubkey of the destination wallet.
        mint:             Base58 pubkey of the token mint.
        recent_blockhash: Base58 blockhash string (e.g. from getLatestBlockhash).
        amount:           Number of base units to transfer (default=1 for NFTs).
        decimals:         Mint decimals for transfer_checked (default=0 for NFTs).
        fee_payer:        Fee payer pubkey (default=source).
        token_program:    Token program id (default = classic SPL Token).

    Returns:
        Base64-encoded bytes of the unsigned transaction.
    """
    src_pk         = Pubkey.from_string(source_address)
    dest_pk        = Pubkey.from_string(dest_address)
    mint_pk        = Pubkey.from_string(mint)
    token_prog_pk  = Pubkey.from_string(token_program)
    ata_prog_pk    = Pubkey.from_string(ATA_PROGRAM)
    sys_prog_pk    = Pubkey.from_string(SYS_PROGRAM)
    payer_pk       = Pubkey.from_string(fee_payer) if fee_payer else src_pk
    blockhash      = Hash.from_string(recent_blockhash)

    # -- Derive ATAs --
    src_ata  = get_associated_token_address(src_pk,  mint_pk, token_prog_pk)
    dest_ata = get_associated_token_address(dest_pk, mint_pk, token_prog_pk)

    # -- Instruction 1: CreateIdempotent ATA for destination --
    # discriminator 1 = CreateIdempotent (0 = Create, raises if already exists)
    create_ix = Instruction(
        ata_prog_pk,
        bytes([1]),
        [
            AccountMeta(payer_pk,      is_signer=True,  is_writable=True),   # payer
            AccountMeta(dest_ata,      is_signer=False, is_writable=True),   # ATA being created
            AccountMeta(dest_pk,       is_signer=False, is_writable=False),  # ATA owner
            AccountMeta(mint_pk,       is_signer=False, is_writable=False),
            AccountMeta(sys_prog_pk,   is_signer=False, is_writable=False),
            AccountMeta(token_prog_pk, is_signer=False, is_writable=False),
        ],
    )

    # -- Instruction 2: transfer_checked (discriminator 12) --
    # data: [12] + amount(u64 LE) + decimals(u8)
    transfer_data = bytes([12]) + amount.to_bytes(8, "little") + bytes([decimals])
    transfer_ix = Instruction(
        token_prog_pk,
        transfer_data,
        [
            AccountMeta(src_ata,  is_signer=False, is_writable=True),   # source ATA
            AccountMeta(mint_pk,  is_signer=False, is_writable=False),
            AccountMeta(dest_ata, is_signer=False, is_writable=True),
            AccountMeta(src_pk,   is_signer=True,  is_writable=False),  # source owner = transfer authority
        ],
    )

    # -- Assemble transaction --
    message = Message.new_with_blockhash([create_ix, transfer_ix], payer_pk, blockhash)
    tx = Transaction.new_unsigned(message)
    return base64.b64encode(bytes(tx)).decode()


def build_nft_transfer(
    escrow_address: str,
    dest_address: str,
    mint: str,
    recent_blockhash: str,
    token_program: str = TOKEN_PROGRAM,
) -> str:
    """
    Thin wrapper around build_token_transfer for NFT (amount=1, decimals=0).
    Fee payer = escrow.
    """
    return build_token_transfer(
        escrow_address, dest_address, mint, recent_blockhash,
        amount=1, decimals=0, token_program=token_program,
    )
