import base64, pathlib
from solders.pubkey import Pubkey
from app.services.nft_transfer import (
    metadata_pda, master_edition_pda, token_record_pda, read_pnft_ruleset)

MINT = Pubkey.from_string("EFGeHr1UUhADShi7shtW9Ds1VgiRYZRE4wfpoqNKGgyp")
ESCROW_ATA = Pubkey.from_string("F5UvNqVnrcPKLAbqAHrPoEHStHwU8DBAJRrmp71o6HeB")
_FIXT = pathlib.Path(__file__).parent / "fixtures" / "pnft_metadata.b64"

def test_pda_helpers_match_live_values():
    assert str(metadata_pda(MINT)) == "6oLXjYugRV1zMUK7pV3HmnMjbdhY4nzC9tSwW1oNL9Qz"
    assert str(master_edition_pda(MINT)) == "6NacVi5reTpcSU9nhGDcvxUkvm8FGMUsjY3YfoPjyEBM"
    assert str(token_record_pda(MINT, ESCROW_ATA)) == "CcPSaXEbBSAZzjnAvB93Hsz7VUR8pbg5tgzKjtsf1Hi4"

def test_read_pnft_ruleset_from_live_metadata():
    data = base64.b64decode(_FIXT.read_text())
    rs = read_pnft_ruleset(data)
    assert str(rs) == "eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9"


import base64 as _b64
from solders.transaction import Transaction
from solders.token.associated import get_associated_token_address
from app.services.nft_transfer import build_pnft_transfer, METADATA_PROGRAM

ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
WINNER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
MINTS = "EFGeHr1UUhADShi7shtW9Ds1VgiRYZRE4wfpoqNKGgyp"
RULESET = "eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9"
BLOCKHASH = "11111111111111111111111111111111"

def test_build_pnft_transfer_accounts_and_data():
    out = build_pnft_transfer(ESCROW, WINNER, MINTS, BLOCKHASH, ruleset=RULESET)
    tx = Transaction.from_bytes(_b64.b64decode(out))
    keys = tx.message.account_keys
    assert keys[0] == Pubkey.from_string(ESCROW)                  # fee payer
    meta_ix = next(ix for ix in tx.message.instructions
                   if keys[ix.program_id_index] == METADATA_PROGRAM)
    assert bytes(meta_ix.data) == bytes([49, 0]) + (1).to_bytes(8, "little") + bytes([0])
    assert len(meta_ix.accounts) == 17
    a = [str(keys[i]) for i in meta_ix.accounts]
    mint = Pubkey.from_string(MINTS)
    esc_ata = str(get_associated_token_address(Pubkey.from_string(ESCROW), mint))
    win_ata = str(get_associated_token_address(Pubkey.from_string(WINNER), mint))
    assert a[0] == esc_ata                                        # source
    assert a[1] == ESCROW                                         # token_owner
    assert a[2] == win_ata                                        # destination
    assert a[3] == WINNER                                         # destination_owner
    assert a[4] == MINTS                                          # mint
    assert a[5] == "6oLXjYugRV1zMUK7pV3HmnMjbdhY4nzC9tSwW1oNL9Qz" # metadata
    assert a[6] == "6NacVi5reTpcSU9nhGDcvxUkvm8FGMUsjY3YfoPjyEBM" # edition
    assert a[7] == "CcPSaXEbBSAZzjnAvB93Hsz7VUR8pbg5tgzKjtsf1Hi4" # escrow token record
    win_ata_pk = get_associated_token_address(Pubkey.from_string(WINNER), mint)
    assert a[8] == str(token_record_pda(mint, win_ata_pk))        # winner token record (derived from winner ATA)
    assert a[9] == ESCROW and a[10] == ESCROW                     # authority + payer
    assert a[16] == RULESET                                       # ruleset
