"""OPTIONAL local template. NOT part of the Gatekeep web app and never imported by it.

What it does: for each page listed in a LOCAL config file (config.local.json, not committed), open the page once in a normal
visible Chromium, wait for you to confirm it has loaded, take the page HTML, hand it to parse_table.py's table reader, and write
Gatekeep JSON through write_gatekeep_json.py.

What it deliberately does NOT do: log in, store credentials, hide that it is automated, rotate addresses, solve challenges, or poll.
Run it a few times a day before games (e.g. when lines open and once near lock), never continuously.

Automated access may violate a book's terms of use; if you run this you accept that risk. Prefer an official feed or a manual export
(save the page, run parse_table.py) wherever you can. Selectors / table layouts change without notice: this file ships with NO
site-specific selectors on purpose. Anything marked TODO is yours to maintain.

config.local.json:
{ "pages": [ {"url": "https://...", "book": "bet365", "sport": "nba", "market": "points"} ],
  "pause_seconds": 20 }
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from parse_table import parse_html
from write_gatekeep_json import normalize_rows, write_files

MAX_PAGES = 12  # hard ceiling per run: this is a few-times-a-day tool


def run(config_path: str = "config.local.json", out_dir: str = "out") -> int:
    try:
        from playwright.sync_api import sync_playwright  # pip install playwright && playwright install chromium
    except ImportError:
        print("Playwright is not installed. Either `pip install playwright` or use the manual path: save the page, run parse_table.py.", file=sys.stderr)
        return 2
    cfg = json.loads(Path(config_path).read_text(encoding="utf-8"))
    pages = cfg.get("pages", [])[:MAX_PAGES]
    pause = max(10, int(cfg.get("pause_seconds", 20)))
    raw: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # visible on purpose: you watch it and can stop it
        ctx = browser.new_context()
        for n, pg in enumerate(pages):
            page = ctx.new_page()
            page.goto(pg["url"], wait_until="domcontentloaded")
            # TODO (yours): open the right market tab / expand the table if the site needs it. Left manual on purpose.
            input(f"[{n + 1}/{len(pages)}] {pg['book']} {pg['sport']} {pg['market']}: when the prop table is visible, press Enter... ")
            rows = parse_html(page.content(), pg["book"], pg["sport"], pg["market"])
            print(f"  {len(rows)} raw row(s)")
            raw.extend(rows)
            page.close()
            if n < len(pages) - 1:
                time.sleep(pause)
        browser.close()
    rows, rejected = normalize_rows(raw)
    for path in write_files(rows, out_dir):
        print("wrote", path)
    print(f"{len(rows)} line(s), {len(rejected)} rejected")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(run(*sys.argv[1:3]))
