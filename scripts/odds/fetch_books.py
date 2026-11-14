#!/usr/bin/env python3
"""
Optional local fetcher for Bet99 / Bet365 prop pages → Gatekeep JSON.

IMPORTANT
- Runs on YOUR machine only. Not part of the Gatekeep web app.
- No login, no credentials, no stealth/anti-bot features.
- Pre-match only. Hard page cap from config (default 12).
- Automated access may violate a book's terms of use — you accept that risk.
- Selectors for live sites must be filled in config.local.json after you inspect pages.
  Until then, use parse_table.py on a saved page (always works).

Usage:
  cp config.example.json config.local.json   # edit URLs + selectors
  python fetch_books.py --sport nba --book both --out out
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent


def load_config() -> dict:
    local = ROOT / "config.local.json"
    example = ROOT / "config.example.json"
    path = local if local.exists() else example
    data = json.loads(path.read_text(encoding="utf-8"))
    if path == example:
        print(
            "NOTE: using config.example.json — copy to config.local.json and set real URLs/selectors.",
            file=sys.stderr,
        )
    return data


def heuristic_extract(page_text: str, book: str, sport: str) -> list[dict[str, Any]]:
    """
    Very conservative regex pass for lines that look like:
      Player Name  21.5  -115  -105
    Not a full site parser — useful when selectors are unset.
    """
    rows: list[dict[str, Any]] = []
    # Name-like token(s), line, two american prices
    pat = re.compile(
        r"([A-Z][a-zA-Z.'\-]+(?:\s+[A-Z][a-zA-Z.'\-]+)+)\s+"
        r"(\d+(?:\.\d+)?)\s+"
        r"([+-]\d{3,4})\s+"
        r"([+-]\d{3,4})"
    )
    for m in pat.finditer(page_text):
        rows.append(
            {
                "book": book,
                "sport": sport,
                "player": m.group(1).strip(),
                "market": "",  # must be filled by selector path or --market
                "line": m.group(2),
                "over": m.group(3),
                "under": m.group(4),
            }
        )
    return rows


def fetch_with_playwright(
    urls: list[str],
    book: str,
    sport: str,
    selectors: dict[str, Any],
    headed: bool,
    timeout_ms: int,
    max_pages: int,
    default_market: str | None,
) -> list[dict[str, Any]]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Playwright not installed. Run: pip install playwright && playwright install chromium\n"
            "Or use parse_table.py on a saved HTML file (no Playwright required).",
            file=sys.stderr,
        )
        raise SystemExit(2)

    rows: list[dict[str, Any]] = []
    urls = urls[:max_pages]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(timeout_ms)

        for url in urls:
            if "REPLACE_WITH" in url:
                print(f"Skip placeholder URL: {url}", file=sys.stderr)
                continue
            print(f"Open {book} {sport}: {url}")
            try:
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_timeout(2500)
            except Exception as e:
                print(f"  navigation failed: {e}", file=sys.stderr)
                continue

            sel_row = selectors.get("row")
            if sel_row:
                try:
                    page.wait_for_selector(sel_row, timeout=min(timeout_ms, 30000))
                except Exception:
                    print(f"  selector not found: {sel_row}", file=sys.stderr)

                elements = page.query_selector_all(sel_row)
                for el in elements:
                    def text(sel_key: str) -> str:
                        s = selectors.get(sel_key)
                        if not s:
                            return ""
                        node = el.query_selector(s) if s else None
                        return (node.inner_text() if node else "").strip()

                    player = text("player")
                    market = text("market") or (default_market or "")
                    line = text("line")
                    over = text("over")
                    under = text("under")
                    if not player or not line:
                        continue
                    rows.append(
                        {
                            "book": book,
                            "sport": sport,
                            "player": player,
                            "market": market,
                            "line": line,
                            "over": over,
                            "under": under,
                        }
                    )
            else:
                # No selectors: dump visible text and heuristic-parse
                body = page.inner_text("body")
                found = heuristic_extract(body, book, sport)
                if default_market:
                    for r in found:
                        r["market"] = default_market
                print(
                    f"  no selectors configured — heuristic found {len(found)} candidate row(s). "
                    "Set selectors in config.local.json for reliable parses.",
                    file=sys.stderr,
                )
                rows.extend(found)

            # Always save a debug snapshot for selector work
            debug_dir = ROOT / "debug_pages"
            debug_dir.mkdir(exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            snap = debug_dir / f"{book}_{sport}_{stamp}.html"
            try:
                snap.write_text(page.content(), encoding="utf-8")
                print(f"  saved page snapshot → {snap}")
            except Exception as e:
                print(f"  could not save snapshot: {e}", file=sys.stderr)

        browser.close()
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Local Bet99/Bet365 → raw rows → Gatekeep JSON")
    ap.add_argument("--sport", required=True, choices=["nba", "nhl", "nfl", "mlb"])
    ap.add_argument("--book", default="both", choices=["bet99", "bet365", "both"])
    ap.add_argument("--out", required=True, help="Output directory for odds_*.json")
    ap.add_argument("--market", default=None, help="Default market if pages are single-prop")
    ap.add_argument("--headed", action="store_true", help="Force visible browser")
    ap.add_argument("--headless", action="store_true", help="Force headless (may be blocked more often)")
    args = ap.parse_args()

    cfg = load_config()
    max_pages = int(cfg.get("max_pages_per_run") or 12)
    headed = True if args.headed else (False if args.headless else bool(cfg.get("headed", True)))
    timeout_ms = int(cfg.get("timeout_ms") or 60000)
    books_cfg = cfg.get("books") or {}
    selectors_root = cfg.get("selectors") or {}

    book_list = ["bet99", "bet365"] if args.book == "both" else [args.book]
    all_raw: list[dict] = []

    for book in book_list:
        urls = (books_cfg.get(book) or {}).get(args.sport) or []
        if not urls:
            print(f"No URLs for {book}/{args.sport} in config", file=sys.stderr)
            continue
        sel = selectors_root.get(book) or {}
        try:
            raw = fetch_with_playwright(
                urls=urls,
                book=book,
                sport=args.sport,
                selectors=sel,
                headed=headed,
                timeout_ms=timeout_ms,
                max_pages=max_pages,
                default_market=args.market,
            )
        except SystemExit:
            raise
        except Exception as e:
            print(f"Fetch failed for {book}: {e}", file=sys.stderr)
            continue
        all_raw.extend(raw)
        print(f"{book}: {len(raw)} raw row(s)")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / f"raw_{args.sport}_{args.book}.json"
    raw_path.write_text(json.dumps(all_raw, indent=2), encoding="utf-8")
    print(f"Raw rows → {raw_path}")

    if not all_raw:
        print(
            "No rows parsed. Use parse_table.py on a saved page, or set selectors in config.local.json.\n"
            "Snapshots (if any) are under scripts/odds/debug_pages/",
            file=sys.stderr,
        )
        return 1

    # Normalize via writer
    import subprocess

    cmd = [
        sys.executable,
        str(ROOT / "write_gatekeep_json.py"),
        "--in",
        str(raw_path),
        "--out",
        str(out_dir),
        "--sport",
        args.sport,
    ]
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
