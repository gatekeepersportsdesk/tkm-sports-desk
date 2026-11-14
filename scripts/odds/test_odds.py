import json, tempfile, unittest
from pathlib import Path
import write_gatekeep_json as W
import parse_saved_page as P

EX = Path(__file__).parent / "examples"


class OddsTests(unittest.TestCase):
    def test_sample_nba(self):
        rows, errs = W.normalize(json.loads((EX / "sample_nba.json").read_text()))
        self.assertEqual(len(rows), 4)
        self.assertTrue(any("Dunks" in e for e in errs))
        mur = [r for r in rows if r["player"] == "Jamal Murray" and r["line"] == 24.5]
        self.assertEqual({r["book"] for r in mur}, {"bet99", "bet365"})
        r = [r for r in rows if r["market"] == "tpm"][0]
        self.assertEqual((r["over"], r["under"], r["line"]), (-110, -110, 1.5))
        self.assertTrue(all(set(r) == {"book", "sport", "player", "market", "line", "over", "under", "asOf"} for r in rows))

    def test_prices_never_invented(self):
        rows, errs = W.normalize([{"sport": "nhl", "player": "A", "market": "shots", "line": 2.5, "over": "-110"},
                                  {"sport": "nhl", "player": "B", "market": "shots", "line": 2.5},
                                  {"sport": "nhl", "player": "", "market": "shots", "line": 2.5, "over": "-110"},
                                  {"sport": "mlb", "player": "C", "market": "hits", "line": 1.5, "over": "-110", "under": "-110"}])
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["under"])
        self.assertEqual(len(errs), 3)

    def test_idempotent_and_files(self):
        raw = json.loads((EX / "sample_nhl.json").read_text())
        a, _ = W.normalize(raw, as_of="2026-10-29T00:00:00Z")
        b, _ = W.normalize(raw + raw, as_of="2026-10-29T00:00:00Z")
        self.assertEqual(a, b)
        with tempfile.TemporaryDirectory() as d:
            p1 = W.write_files(a, Path(d), "2026-10-29")
            t1 = p1[0].read_text()
            W.write_files(a, Path(d), "2026-10-29")
            self.assertEqual(t1, p1[0].read_text())
            self.assertEqual(p1[0].name, "odds_nhl_2026-10-29.json")

    def test_parse_html_and_grid(self):
        raw = P.to_raw(P.table_rows(EX / "sample_columns.html"), "columns", "nba", "points", "bet99")
        rows, errs = W.normalize(raw)
        self.assertEqual([(r["player"], r["line"], r["over"], r["under"]) for r in rows], [("Jamal Murray", 22.5, -115, -105), ("Nikola Jokic", 26.5, -110, -110)])
        self.assertEqual(len(errs), 1)
        g = P.to_raw(P.table_rows(EX / "sample_grid.csv"), "grid", "nba", "points", "bet365")
        rows, errs = W.normalize(g)
        self.assertEqual(len(rows), 4)
        self.assertEqual([r["line"] for r in rows if r["player"] == "Jamal Murray"], [22.5, 24.5])

    def test_odds_parsing(self):
        self.assertEqual(W.parse_american("−115"), -115)
        self.assertEqual(W.parse_american("+130"), 130)
        self.assertEqual(W.parse_american("1.91"), -110)
        self.assertIsNone(W.parse_american(""))
        self.assertIsNone(W.parse_american("abc"))


if __name__ == "__main__":
    unittest.main()
