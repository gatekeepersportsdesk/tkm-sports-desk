#!/usr/bin/env python3
"""
Turn a copied props table or simple HTML table into raw JSON rows for write_gatekeep_json.py.

Usage:
  python parse_table.py --text copied.txt --book bet99 --sport nba --out raw.json
  python parse_table.py --html saved.html --book bet365 --sport nba --market points --out raw.json
"""
from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t == "table":
            self._table = []
        elif t == "tr" and self._table is not None:
            self._row = []
        elif t in ("td", "th") and self._row is not None:
            self._cell = []
            self._in_cell = True

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("td", "th") and self._in_cell:
            text = re.sub(r"\s+", " ", "".join(self._cell or [])).strip()
            self._row.append(text)  # type: ignore
            self._cell = None
            self._in_cell = False
        elif t == "tr" and self._row is not None and self._table is not None:
            if any(self._row):
                self._table.append(self._row)
            self._row = None
        elif t == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None

    def handle_data(self, data: str) -> None:
        if self._in_cell and self._cell is not None:
            self._cell.append(data)


def split_text_table(text: str) -> list[list[str]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    rows: list[list[str]] = []
    for ln in lines:
        if "\t" in ln:
            rows.append([c.strip() for c in ln.split("\t")])
        elif "," in ln and re.search(r",\s*[+-]?\d+", ln):
            # crude CSV split respecting simple quotes
            parts: list[str] = []
            cur = ""
            q = False
            for ch in ln:
                if ch == '"':
                    q = not q
                elif ch == "," and not q:
                    parts.append(cur.strip())
                    cur = ""
                else:
                    cur += ch
            parts.append(cur.strip())
            rows.append(parts)
        else:
            # multi-space
            rows.append(re.split(r"\s{2,}", ln))
    return rows


def map_header(cells: list[str]) -> dict[str, int]:
    idx: dict[str, int] = {}
    for i, c in enumerate(cells):
        k = re.sub(r"[\s_\-]", "", c.lower())
        if k in ("player", "name", "athlete", "selection"):
            idx.setdefault("player", i)
        elif k in ("market", "prop", "stat", "category"):
            idx.setdefault("market", i)
        elif k in ("line", "point", "handicap", "total", "points"):
            idx.setdefault("line", i)
        elif k in ("over", "overodds", "o", "yes"):
            idx.setdefault("over", i)
        elif k in ("under", "underodds", "u", "no"):
            idx.setdefault("under", i)
        elif "player" in k and "player" not in idx:
            idx["player"] = i
        elif "over" in k and "over" not in idx:
            idx["over"] = i
        elif "under" in k and "under" not in idx:
            idx["under"] = i
        elif "line" in k and "line" not in idx:
            idx["line"] = i
    return idx


def rows_to_records(
    grid: list[list[str]],
    book: str,
    sport: str,
    default_market: str | None,
) -> list[dict[str, Any]]:
    if not grid:
        return []
    header = grid[0]
    idx = map_header(header)
    body = grid[1:] if idx else grid
    if not idx:
        # no header — try positional: player, line, over, under
        out = []
        for r in body:
            if len(r) < 3:
                continue
            rec: dict[str, Any] = {
                "book": book,
                "sport": sport,
                "player": r[0],
                "line": r[1],
                "over": r[2] if len(r) > 2 else "",
                "under": r[3] if len(r) > 3 else "",
            }
            if default_market:
                rec["market"] = default_market
            elif len(r) > 4:
                rec["market"] = r[4]
            out.append(rec)
        return out

    out = []
    for r in body:
        def cell(key: str) -> str:
            i = idx.get(key)
            if i is None or i >= len(r):
                return ""
            return r[i]

        player = cell("player")
        if not player:
            continue
        rec = {
            "book": book,
            "sport": sport,
            "player": player,
            "market": cell("market") or default_market or "",
            "line": cell("line"),
            "over": cell("over"),
            "under": cell("under"),
        }
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", help="Path to copied table text")
    ap.add_argument("--html", help="Path to saved HTML")
    ap.add_argument("--book", required=True)
    ap.add_argument("--sport", required=True, choices=["nba", "nhl", "nfl", "mlb"])
    ap.add_argument("--market", default=None, help="Default market if column missing")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    records: list[dict] = []
    if args.text:
        text = Path(args.text).read_text(encoding="utf-8", errors="replace")
        grid = split_text_table(text)
        records.extend(rows_to_records(grid, args.book, args.sport, args.market))
    elif args.html:
        html = Path(args.html).read_text(encoding="utf-8", errors="replace")
        parser = _TableParser()
        parser.feed(html)
        # use largest table
        tables = sorted(parser.tables, key=lambda t: len(t), reverse=True)
        if not tables:
            # fallback: strip tags lightly and split lines
            plain = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
            plain = re.sub(r"<[^>]+>", " ", plain)
            plain = re.sub(r"[ \t]+", " ", plain)
            grid = split_text_table(plain)
            records.extend(rows_to_records(grid, args.book, args.sport, args.market))
        else:
            records.extend(rows_to_records(tables[0], args.book, args.sport, args.market))
    else:
        ap.error("Provide --text or --html")

    Path(args.out).write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"Wrote {len(records)} raw rows → {args.out}")
    return 0 if records else 1


if __name__ == "__main__":
    raise SystemExit(main())
