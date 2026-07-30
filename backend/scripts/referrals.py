"""CLI to manage Gimmighoul referral codes (no admin endpoint exists by design).

Usage (from backend/):
  PYTHONPATH=. .venv/bin/python3 scripts/referrals.py add CODE --name "Creator" \
      --boost 0.10 --referrer 0.10 --owner WALLET
  PYTHONPATH=. .venv/bin/python3 scripts/referrals.py list
"""
import argparse
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory, init_db
from app.models import ReferralCode
from app.services.referrals import create_referral_code, get_referral_code


def _session_factory():
    engine = make_engine(get_settings().database_url)
    init_db(engine)
    return make_session_factory(engine)


def cmd_add(args) -> int:
    Session = _session_factory()
    s = Session()
    try:
        if get_referral_code(s, args.code) is not None:
            print(f"error: code '{args.code}' already exists", file=sys.stderr)
            return 1
        rc = create_referral_code(s, args.code, args.name, boost_pct=args.boost,
                                  referrer_pct=args.referrer, owner_wallet=args.owner)
        rc.rake_share_pct = args.rake_share   # create_referral_code no acepta el campo aún
        s.commit()
        print(f"added {args.code} (name={args.name!r} boost={args.boost} "
              f"rake_share={args.rake_share} owner={args.owner})")
        return 0
    finally:
        s.close()


def cmd_list(args) -> int:
    Session = _session_factory()
    s = Session()
    try:
        rows = s.query(ReferralCode).order_by(ReferralCode.created_at).all()
        if not rows:
            print("(no referral codes)")
        from app.services.referral_earnings import referrer_summary
        for r in rows:
            line = (f"{r.code}\tname={r.name!r}\tboost={r.boost_pct}\t"
                    f"rake_share={r.rake_share_pct}\towner={r.owner_wallet}")
            if r.owner_wallet:
                sm = referrer_summary(s, r.owner_wallet)
                line += (f"\treferidos={sum(c['referred_count'] for c in sm['codes'])}"
                         f"\tunclaimed=${sm['unclaimed_base_units'] / 1e6:.2f}"
                         f"\tlifetime=${sm['lifetime_base_units'] / 1e6:.2f}")
            print(line)
        return 0
    finally:
        s.close()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Manage Gimmighoul referral codes")
    sub = p.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("add", help="create a referral code")
    pa.add_argument("code")
    pa.add_argument("--name", required=True)
    pa.add_argument("--boost", type=float, default=0.0, help="boost pct for the referred user (e.g. 0.10)")
    pa.add_argument("--referrer", type=float, default=0.0, help="cut pct for the code owner (e.g. 0.10)")
    pa.add_argument("--rake-share", type=float, default=0.25,
                    help="fracción del rake de sus referidos que cobra el dueño (0.25 = 25%%)")
    pa.add_argument("--owner", default=None, help="owner wallet to credit the referrer cut to")
    pa.set_defaults(func=cmd_add)

    pl = sub.add_parser("list", help="list all referral codes")
    pl.set_defaults(func=cmd_list)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
