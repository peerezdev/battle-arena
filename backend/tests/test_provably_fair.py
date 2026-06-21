from app.services.provably_fair import (
    gen_server_seed, seed_hash, client_seed_from_nfts, pick_index, verify_commit)


def test_seed_hash_and_verify():
    seed, h = gen_server_seed()
    assert len(bytes.fromhex(seed)) == 32
    assert seed_hash(seed) == h and verify_commit(seed, h)
    assert not verify_commit(seed, "00" * 32)


def test_client_seed_is_order_independent():
    a = client_seed_from_nfts(["m2", "m1", "m3"])
    b = client_seed_from_nfts(["m1", "m3", "m2"])
    assert a == b and len(bytes.fromhex(a)) == 32


def test_pick_index_deterministic_and_bounded():
    seed, _ = "ab" * 32, None
    cs = client_seed_from_nfts(["x", "y"])
    i1 = pick_index(seed, cs, 3)
    i2 = pick_index(seed, cs, 3)
    assert i1 == i2 and 0 <= i1 < 3
    # golden: anchors the HMAC draw formula (changing it breaks Provably-Fair verification)
    assert pick_index("ab" * 32, "00" * 32, 5) == 2


def test_client_seed_round_order_independent_and_round_sensitive():
    from app.services.provably_fair import client_seed_round
    a = client_seed_round(2, ["m2", "m1"]); b = client_seed_round(2, ["m1", "m2"])
    assert a == b
    assert client_seed_round(1, ["m1", "m2"]) != client_seed_round(2, ["m1", "m2"])
