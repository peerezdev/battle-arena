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
