#!/usr/bin/env python3
"""Offline tests for odds writer + table parser."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class OddsToolsTests(unittest.TestCase):
    def test_sample_nba_json_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            r = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "write_gatekeep_json.py"),
                    "--in",
                    str(ROOT / "examples" / "sample_nba.json"),
                    "--out",
                    str(out),
                    "--date",
                    "2026-10-29",
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            path = out / "odds_nba_2026-10-29.json"
            self.assertTrue(path.exists())
            data = json.loads(path.read_text())
            self.assertGreaterEqual(len(data), 4)
            books = {row["book"] for row in data}
            self.assertIn("bet99", books)
            self.assertIn("bet365", books)
            markets = {row["market"] for row in data}
            self.assertIn("pts", markets)
            self.assertIn("tpm", markets)

    def test_csv_input(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            r = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "write_gatekeep_json.py"),
                    "--in",
                    str(ROOT / "examples" / "sample_table.csv"),
                    "--out",
                    str(out),
                    "--date",
                    "2026-10-29",
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            data = json.loads((out / "odds_nba_2026-10-29.json").read_text())
            self.assertTrue(any(x["player"] == "Bam Adebayo" for x in data))

    def test_parse_copied_table(self):
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "raw.json"
            r = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "parse_table.py"),
                    "--text",
                    str(ROOT / "examples" / "sample_copied_table.txt"),
                    "--book",
                    "bet99",
                    "--sport",
                    "nba",
                    "--out",
                    str(raw),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            rows = json.loads(raw.read_text())
            self.assertGreaterEqual(len(rows), 3)
            self.assertEqual(rows[0]["book"], "bet99")

    def test_rejects_no_prices(self):
        with tempfile.TemporaryDirectory() as td:
            bad = Path(td) / "bad.json"
            bad.write_text(
                json.dumps(
                    [
                        {
                            "book": "bet99",
                            "sport": "nba",
                            "player": "Nobody",
                            "market": "points",
                            "line": 10.5,
                        }
                    ]
                ),
                encoding="utf-8",
            )
            out = Path(td) / "out"
            r = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "write_gatekeep_json.py"),
                    "--in",
                    str(bad),
                    "--out",
                    str(out),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
