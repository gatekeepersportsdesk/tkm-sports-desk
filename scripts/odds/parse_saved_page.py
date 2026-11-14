#!/usr/bin/env python3
"""Manual path (no network): turn a saved HTML page or a pasted table into raw rows, then Gatekeep JSON.

Save the prop page from your own browser (File > Save Page As, HTML only) or copy the table into a .csv / .txt.
Two table layouts are supported:
  columns : one row per line      -> player | line | over | under
  grid    : one row per player    -> player | line1 | over1 | under1 | line2 | over2 | under2 | ...   (Bet365-style several lines)
Column positions are 0-based and given on the command line, because every site lays tables out differently.
"""
from __future__ import annotations
import argparse, re, sys
from html.parser import HTMLParser
from pathlib import Path
import write_gatekeep_json as W


class _Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(c for c in self._row):
                self.rows.append(self._row)
            self._row = None


def table_rows(path: Path) -> list[list[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() in (".html", ".htm"):
        p = _Tables()
        p.feed(text)
        return p.rows
    import csv
    return [r for r in csv.reader(text.splitlines(), delimiter="\t" if "\t" in text.splitlines()[0] else ",") if any(c.strip() for c in r)]


_NUM = re.compile(r"^[ou]?\s*([+\-−]?\d+(?:\.\d+)?)$", re.I)


def _line(cell: str):
    m = _NUM.match(cell.strip().replace("O", "").replace("U", "").replace("o", "").replace("u", "").strip()) if cell else None
    try:
        return float(cell.strip().lower().lstrip("ou ").strip())
    except ValueError:
        return float(m.group(1)) if m else None


def to_raw(rows: list[list[str]], layout: str, sport: str, market: str, book: str, player_col=0, skip_header=1, first=1) -> list[dict]:
    out = []
    for r in rows[skip_header:]:
        if len(r) <= player_col or not r[player_col].strip():
            continue
        player = r[player_col].strip()
        cells = r[first:] if layout == "grid" else None
        if layout == "columns":
            idx = [player_col + 1, player_col + 2, player_col + 3]
            if len(r) <= idx[2]:
                continue
            out.append({"sport": sport, "book": book, "player": player, "market": market, "line": r[idx[0]], "over": r[idx[1]], "under": r[idx[2]]})
        else:
            for i in range(0, len(cells) - 2, 3):
                if cells[i].strip():
                    out.append({"sport": sport, "book": book, "player": player, "market": market, "line": cells[i], "over": cells[i + 1], "under": cells[i + 2]})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("--sport", required=True, choices=W.SPORTS)
    ap.add_argument("--market", required=True, help="the market this page shows, e.g. points / shots on goal")
    ap.add_argument("--book", required=True)
    ap.add_argument("--layout", choices=("columns", "grid"), default="columns")
    ap.add_argument("--player-col", type=int, default=0)
    ap.add_argument("--skip-header", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--date")
    a = ap.parse_args(argv)
    raw = to_raw(table_rows(a.input), a.layout, a.sport, a.market, a.book, a.player_col, a.skip_header, a.player_col + 1)
    rows, errors = W.normalize(raw)
    for e in errors:
        print("skipped:", e, file=sys.stderr)
    paths = W.write_files(rows, a.out, a.date)
    print(f"{len(rows)} line(s) kept, {len(errors)} skipped -> " + (", ".join(str(p) for p in paths) or "nothing written"))
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
