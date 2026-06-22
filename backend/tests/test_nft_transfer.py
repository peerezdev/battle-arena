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


def test_read_pnft_ruleset_returns_none_on_truncated():
    # A truncated/old-format buffer must yield None (caller voids), not raise.
    assert read_pnft_ruleset(b"\x04" + b"\x00" * 12) is None


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


# ---------------------------------------------------------------------------
# Task 3: detect_standard, build_transfer, submit_signed_tx
# ---------------------------------------------------------------------------
import json, pytest, respx
from httpx import Response
from app.services.nft_transfer import (
    detect_standard, build_transfer, submit_signed_tx,
    UnsupportedNftStandard, _token_standard)

RPC = "https://rpc.test"
MPL_CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"

# Load fixture bytes once for mocking pNFT metadata
_PNFT_B64 = _FIXT.read_text().strip()


def _acct_info(value):
    return Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": value}})


# --- _token_standard unit test (against live fixture) ---

def test_token_standard_fixture():
    """_token_standard returns 4 (ProgrammableNonFungible) for the live pNFT metadata fixture."""
    import base64 as _b
    raw = _b.b64decode(_FIXT.read_text())
    assert _token_standard(raw) == 4


# --- detect_standard tests ---

@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_pnft():
    """Mint owned by TOKEN_PROGRAM + metadata with token_standard=4 → 'pnft'."""
    def handler(request):
        body = json.loads(request.content)
        if body["method"] == "getAccountInfo":
            acct = body["params"][0]
            if acct == MINTS:
                return _acct_info({"owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                                   "data": ["", "base64"]})
            # metadata PDA → return the real pNFT fixture bytes so _token_standard returns 4
            return _acct_info({"owner": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
                               "data": [_PNFT_B64, "base64"]})
        return _acct_info(None)
    respx.post(RPC).mock(side_effect=handler)
    assert await detect_standard(RPC, MINTS) == "pnft"


@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_standard():
    """Mint owned by TOKEN_PROGRAM + no metadata account → 'standard'."""
    def handler(request):
        body = json.loads(request.content)
        acct = body["params"][0]
        if acct == MINTS:
            return _acct_info({"owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                               "data": ["", "base64"]})
        return _acct_info(None)  # metadata missing → standard
    respx.post(RPC).mock(side_effect=handler)
    assert await detect_standard(RPC, MINTS) == "standard"


@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_cnft():
    """No mint account → 'cnft'."""
    respx.post(RPC).mock(return_value=_acct_info(None))
    assert await detect_standard(RPC, MINTS) == "cnft"


@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_core():
    """Mint owned by MPL Core program → 'core'."""
    respx.post(RPC).mock(return_value=_acct_info({"owner": MPL_CORE, "data": ["", "base64"]}))
    assert await detect_standard(RPC, MINTS) == "core"


@respx.mock
@pytest.mark.asyncio
async def test_detect_standard_unknown():
    """Mint owned by unrecognised program → 'unknown'."""
    respx.post(RPC).mock(return_value=_acct_info({"owner": "SomeUnknownProgramXXXXXXXXXXXXXXXXXXXXXXXXX",
                                                   "data": ["", "base64"]}))
    assert await detect_standard(RPC, MINTS) == "unknown"


# --- build_transfer tests ---

@respx.mock
@pytest.mark.asyncio
async def test_build_transfer_pnft_returns_base64():
    """build_transfer for pNFT calls build_pnft_transfer and returns a b64 tx."""
    import base64 as _b
    def handler(request):
        body = json.loads(request.content)
        if body["method"] == "getAccountInfo":
            acct = body["params"][0]
            if acct == MINTS:
                return _acct_info({"owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                                   "data": ["", "base64"]})
            return _acct_info({"owner": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
                               "data": [_PNFT_B64, "base64"]})
        return _acct_info(None)
    respx.post(RPC).mock(side_effect=handler)
    result = await build_transfer(RPC, ESCROW, WINNER, MINTS, BLOCKHASH)
    _b.b64decode(result)  # must be valid base64


@respx.mock
@pytest.mark.asyncio
async def test_build_transfer_core_returns_base64():
    """build_transfer for MPL Core NFTs calls build_core_transfer and returns a b64 tx."""
    respx.post(RPC).mock(return_value=_acct_info({"owner": MPL_CORE, "data": ["", "base64"]}))
    result = await build_transfer(RPC, ESCROW, WINNER, MINTS, BLOCKHASH)
    _b64.b64decode(result)  # must be valid base64


@respx.mock
@pytest.mark.asyncio
async def test_build_transfer_raises_for_cnft():
    """build_transfer raises UnsupportedNftStandard for compressed NFTs."""
    respx.post(RPC).mock(return_value=_acct_info(None))
    with pytest.raises(UnsupportedNftStandard):
        await build_transfer(RPC, ESCROW, WINNER, MINTS, BLOCKHASH)


# --- submit_signed_tx tests ---

@respx.mock
@pytest.mark.asyncio
async def test_submit_signed_tx_returns_signature():
    """submit_signed_tx returns the transaction signature on success."""
    respx.post(RPC).mock(return_value=Response(
        200, json={"jsonrpc": "2.0", "id": 1, "result": "SIG"}))
    assert await submit_signed_tx(RPC, "TX") == "SIG"


@respx.mock
@pytest.mark.asyncio
async def test_submit_signed_tx_raises_on_rpc_error():
    """submit_signed_tx raises RuntimeError when the RPC returns an error field."""
    respx.post(RPC).mock(return_value=Response(
        200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32002, "message": "bad tx"}}))
    with pytest.raises(RuntimeError, match="sendTransaction failed"):
        await submit_signed_tx(RPC, "TX")


# --- nft_in_owner tests ---

from app.services.nft_transfer import nft_in_owner

@respx.mock
@pytest.mark.asyncio
async def test_nft_in_owner_returns_true_when_holding():
    """Returns True when a token account holds amount >= 1."""
    def handler(request):
        return Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": [
            {"account": {"data": {"parsed": {"info": {"tokenAmount": {"uiAmountString": "1"}}}}}}
        ]}})
    respx.post(RPC).mock(side_effect=handler)
    assert await nft_in_owner(RPC, ESCROW, MINTS) is True


@respx.mock
@pytest.mark.asyncio
async def test_nft_in_owner_returns_false_when_empty():
    """Returns False when the value list is empty (no token accounts found)."""
    respx.post(RPC).mock(return_value=Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"value": []}}))
    assert await nft_in_owner(RPC, ESCROW, MINTS) is False
