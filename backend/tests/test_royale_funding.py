from app.services.royale_funding import royale_buyin, total_pulls

def test_total_pulls():
    assert total_pulls(4) == 9 and total_pulls(10) == 54 and total_pulls(2) == 2

def test_royale_buyin_rounds_up():
    assert royale_buyin(4, 50_000_000) == 112_500_000      # 9*50/4 = 112.5 USDC (exact)
    assert royale_buyin(10, 50_000_000) == 270_000_000     # 54*50/10 = 270 USDC
    assert royale_buyin(3, 50_000_000) == 83_333_334       # ceil(5*50/3)=83.333334 USDC
