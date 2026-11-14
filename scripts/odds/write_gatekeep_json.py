#!/usr/bin/env python3
"""
Normalize raw prop rows into Gatekeep Odds-import JSON.
No network calls. Rejects unreadable rows with reasons.

Usage:
  python write_gatekeep_json.py --in raw.json --out out
  python write_gatekeep_json.py --in a.json --in b.json --out out --date 2026-10-30
  python write_gatekeep_json.py --in table.csv --sport nba --book bet99 --out out
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BOOK_ALIASES = {
    "bet365": "bet365",
    "bet 365": "bet365",
    "bet99": "bet99",
    "bet 99": "bet99",
}

MARKETS: dict[str, dict[str, str]] = {
    "nba": {
        "pts": "pts", "points": "pts", "point": "pts",
        "reb": "reb", "rebs": "reb", "rebounds": "reb", "rebound": "reb",
        "ast": "ast", "assists": "ast", "assist": "ast",
        "tpm": "tpm", "3pm": "tpm", "3pt": "tpm", "threes": "tpm",
        "3-pointers": "tpm", "3-pointers made": "tpm", "3 pointers made": "tpm",
        "three pointers made": "tpm", "threes made": "tpm", "three-pointers": "tpm",
        "pra": "pra", "pts+reb+ast": "pra", "points + rebounds + assists": "pra",
        "stl": "stl", "steals": "stl", "steal": "stl",
        "blk": "blk", "blocks": "blk", "block": "blk",
    },
    "nhl": {
        "sog": "sog", "shots": "sog", "shots on goal": "sog",
        "player shots on goal": "sog", "shot": "sog",
        "pts": "pts", "points": "pts", "player points": "pts", "point": "pts",
    },
    "nfl": {
        "rec": "rec", "receptions": "rec", "player receptions": "rec",
        "receptions made": "rec", "reception": "rec",
    },
    "mlb": {
        "hit": "hit", "hits": "hit", "player hits": "hit",
        "to record a hit": "hit", "h": "hit",
    },
}


def norm_book(b: Any) -> str:
    s = str(b or "").strip().lower()
    return BOOK_ALIASES.get(s, s or "other")


def norm_market(sport: str, raw: Any) -> str | None:
    k = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    table = MARKETS.get(sport, {})
    if k in table:
        return table[k]
    k2 = re.sub(r"^(player|total)\s+", "", k)
    return table.get(k2)


def parse_american(raw: Any) -> int | None:
    if raw is None:
        return None
    s = str(raw).strip().upper().replace(",", "")
    if s in ("", "-", "—", "N/A", "NA", "NONE"):
        return None
    s = s.replace("−", "-")  # unicode minus
    m = re.match(r"^([+-]?)(\d+)$", s)
    if not m:
        # decimal odds → rough American (optional)
        try:
            dec = float(s)
            if dec <= 1.0:
                return None
            if dec >= 2.0:
                return int(round((dec - 1.0) * 100))
            return int(round(-100 / (dec - 1.0)))
        except ValueError:
            return None
    sign, digits = m.group(1), int(m.group(2))
    if digits == 0:
        return None
    if sign == "-":
        return -digits
    if sign == "+":
        return digits
    # bare number: convention >= 100 means plus money
    return digits if digits >= 100 else -digits


def _lower_keys(obj: dict) -> dict:
    return {re.sub(r"[\s_\-]", "", str(k).lower()): v for k, v in obj.items()}


def _pick(o: dict, keys: list[str]) -> Any:
    for k in keys:
        if k in o and o[k] is not None and str(o[k]).strip() != "":
            return o[k]
    return None


def load_raw(path: Path, default_sport: str | None, default_book: str | None) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return [], [f"{path}: empty file"]

    rows: list[dict] = []
    if text[0] in "[{":
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            return [], [f"{path}: invalid JSON: {e}"]
        if isinstance(data, dict):
            for key in ("lines", "props", "rows", "data"):
                if isinstance(data.get(key), list):
                    data = data[key]
                    break
            else:
                return [], [f"{path}: JSON must be an array or object with lines/props/rows/data"]
        if not isinstance(data, list):
            return [], [f"{path}: JSON root must be an array"]
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                errors.append(f"{path} row {i+1}: not an object")
                continue
            rows.append(_lower_keys(item))
    else:
        # CSV
        lines = text.splitlines()
        reader = csv.reader(lines)
        try:
            header = next(reader)
        except StopIteration:
            return [], [f"{path}: empty CSV"]
        head = [re.sub(r"[\s_\-]", "", h.lower()) for h in header]
        if "player" not in head and "name" not in head:
            return [], [f"{path}: CSV needs player/name column"]
        for i, cols in enumerate(reader, start=2):
            if not any(c.strip() for c in cols):
                continue
            row = {head[j]: cols[j] if j < len(cols) else "" for j in range(len(head))}
            rows.append(row)

    out: list[dict] = []
    for i, o in enumerate(rows):
        where = f"{path.name} row {i+1}"
        sport = str(_pick(o, ["sport", "league"]) or default_sport or "").strip().lower()
        if sport not in MARKETS:
            errors.append(f"{where}: sport missing or unsupported (use --sport)")
            continue
        player = str(_pick(o, ["player", "name", "playername"]) or "").strip()
        market = norm_market(sport, _pick(o, ["market", "prop", "stat"]))
        try:
            line = float(_pick(o, ["line", "point", "handicap", "total"]))
        except (TypeError, ValueError):
            line = float("nan")
        over = parse_american(_pick(o, ["over", "overodds", "o", "overprice"]))
        under = parse_american(_pick(o, ["under", "underodds", "u", "underprice"]))
        book = norm_book(_pick(o, ["book", "sportsbook", "source"]) or default_book or "other")
        asof = _pick(o, ["asof", "timestamp", "time"])
        if not player:
            errors.append(f"{where}: no player")
            continue
        if not market:
            errors.append(f"{where} ({player}): bad market")
            continue
        if line != line or line < 0:  # NaN check
            errors.append(f"{where} ({player}): bad line")
            continue
        if over is None and under is None:
            errors.append(f"{where} ({player}): no readable over/under price")
            continue
        rec = {
            "book": book,
            "sport": sport,
            "player": player,
            "market": market,
            "line": line if line != int(line) else float(line),
            "over": over,
            "under": under,
        }
        if asof:
            rec["asOf"] = str(asof)
        out.append(rec)
    return out, errors


def dedupe(rows: list[dict]) -> list[dict]:
    """Keep last occurrence of book|sport|player|market|line."""
    seen: dict[str, dict] = {}
    for r in rows:
        key = f"{r['book']}|{r['sport']}|{r['player'].lower()}|{r['market']}|{r['line']}"
        seen[key] = r
    return list(seen.values())


def main() -> int:
    ap = argparse.ArgumentParser(description="Write Gatekeep odds JSON from raw rows")
    ap.add_argument("--in", dest="inputs", action="append", required=True, help="Input JSON/CSV (repeatable)")
    ap.add_argument("--out", required=True, help="Output directory")
    ap.add_argument("--sport", default=None, help="Default sport when not in file")
    ap.add_argument("--book", default=None, help="Default book when not in file")
    ap.add_argument("--date", default=None, help="YYYY-MM-DD for filenames (default: today UTC)")
    ap.add_argument("--combined", action="store_true", help="Single odds_all_DATE.json instead of per-sport")
    args = ap.parse_args()

    all_rows: list[dict] = []
    all_errors: list[str] = []
    for p in args.inputs:
        path = Path(p)
        if not path.exists():
            all_errors.append(f"missing file: {path}")
            continue
        rows, errs = load_raw(path, args.sport, args.book)
        all_rows.extend(rows)
        all_errors.extend(errs)

    all_rows = dedupe(all_rows)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    date = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for r in all_rows:
        r.setdefault("asOf", now)
        # normalize line display: keep .5 ends as float
        if float(r["line"]) == int(float(r["line"])):
            r["line"] = int(float(r["line"])) if float(r["line"]) == int(float(r["line"])) and abs(float(r["line"]) - int(float(r["line"]))) < 1e-9 else float(r["line"])

    written: list[str] = []
    if args.combined:
        path = out_dir / f"odds_all_{date}.json"
        path.write_text(json.dumps(all_rows, indent=2), encoding="utf-8")
        written.append(str(path))
    else:
        by_sport: dict[str, list] = {}
        for r in all_rows:
            by_sport.setdefault(r["sport"], []).append(r)
        if not by_sport and args.sport:
            by_sport[args.sport] = []
        for sport, rows in sorted(by_sport.items()):
            path = out_dir / f"odds_{sport}_{date}.json"
            path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
            written.append(f"{path} ({len(rows)} lines)")

    print(f"Wrote {len(all_rows)} unique posted line(s):")
    for w in written:
        print(f"  {w}")
    if all_errors:
        print(f"\n{len(all_errors)} row issue(s):", file=sys.stderr)
        for e in all_errors[:50]:
            print(f"  {e}", file=sys.stderr)
        if len(all_errors) > 50:
            print(f"  … {len(all_errors) - 50} more", file=sys.stderr)
    return 0 if all_rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
