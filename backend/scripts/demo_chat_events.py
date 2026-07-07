#!/usr/bin/env python3
"""Fire sample chat announcements so the hit / winner / created render can be
iterated without waiting for real events.

Posts to the dev-gated endpoint POST /dev/announce, so the backend must run with
DEV_ENDPOINTS_ENABLED=true:

    DEV_ENDPOINTS_ENABLED=true ./.venv/bin/uvicorn app.main:app --port 9090

Usage (from repo root or anywhere):

    python backend/scripts/demo_chat_events.py                # fire the whole set
    python backend/scripts/demo_chat_events.py --event hit    # only big-pull examples
    python backend/scripts/demo_chat_events.py --delay 2      # slower cadence
    python backend/scripts/demo_chat_events.py --persist      # also store in history

Tweak EXAMPLES below to try different copy/values, re-run, and watch the chat.
Each dict maps 1:1 to the /dev/announce body.
"""
import argparse
import json
import time
import urllib.request
import urllib.error

# Each entry maps directly to the DevAnnounceBody. Edit freely to iterate on the design.
EXAMPLES = [
    # ── big pulls — machine chip + user + "pulled {card}" + gold value + (xN) multiple, no button ──
    {"event": "hit", "user": "neo", "text": "pulled Charizard VMAX (PSA 10)", "amountUsd": 2400, "machine": "TCG Prime", "mult": 30},
    {"event": "hit", "user": "luna", "text": "pulled Umbreon Gold Star", "amountUsd": 860, "machine": "TCG Neo", "mult": 17.2},
    {"event": "hit", "user": "0xF3a…9bd", "text": "pulled Lugia 1st Edition", "amountUsd": 512, "machine": "TCG Base", "mult": 25.6},

    # ── winners (🏆) — user + "won a {mode}" + gold take + View button ──
    {"event": "winner", "user": "mole", "text": "won a Pack Battle", "amountUsd": 1240,
     "mode": "pack", "action_label": "View", "battle_id": "demo-pack"},
    {"event": "winner", "user": "kappa", "text": "won a Battle Royale", "amountUsd": 4800,
     "mode": "royale", "action_label": "View", "battle_id": "demo-royale"},

    # ── created — user + "created a {mode}" + gold stake + Join button ──
    {"event": "created", "user": "prueba2", "text": "created a Battle Royale", "amountUsd": 50,
     "mode": "royale", "action_label": "Join", "battle_id": "demo-royale"},
    {"event": "created", "user": "shalev", "text": "created a Pack Battle", "amountUsd": 100,
     "mode": "pack", "action_label": "Join", "battle_id": "demo-pack"},
]


def post(url: str, body: dict) -> None:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        resp.read()


def main() -> int:
    ap = argparse.ArgumentParser(description="Fire sample chat announcements into the lobby chat.")
    ap.add_argument("--url", default="http://localhost:9090", help="backend base URL")
    ap.add_argument("--event", choices=["hit", "winner", "created"], help="only fire this event type")
    ap.add_argument("--delay", type=float, default=1.2, help="seconds between messages")
    ap.add_argument("--persist", action="store_true", help="also persist to chat history (default: live-only)")
    args = ap.parse_args()

    endpoint = args.url.rstrip("/") + "/dev/announce"
    items = [e for e in EXAMPLES if not args.event or e["event"] == args.event]
    if not items:
        print("No examples match --event", args.event)
        return 1

    print(f"Firing {len(items)} announcement(s) → {endpoint}")
    for i, ex in enumerate(items):
        body = {**ex, "persist": args.persist}
        try:
            post(endpoint, body)
            print(f"  [{ex['event']:7}] {ex['user']} {ex['text']} "
                  f"${ex.get('amountUsd', ''):,}".rstrip())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                print("\n404 from /dev/announce — the backend is not running with dev endpoints enabled.")
                print("Restart it with:  DEV_ENDPOINTS_ENABLED=true ./.venv/bin/uvicorn app.main:app --port 9090")
                return 1
            print(f"  HTTP {e.code}: {e.read().decode(errors='ignore')[:200]}")
            return 1
        except urllib.error.URLError as e:
            print(f"\nCould not reach {endpoint}: {e.reason}\nIs the backend running?")
            return 1
        if i < len(items) - 1:
            time.sleep(args.delay)
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
