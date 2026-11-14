# Gatekeep Sports Desk — FINAL merge package (Updates 8 + 9 + 10 + local odds producer)

IMPORTANT — MERGE, DO NOT OVERWRITE. Your copy is at Update 7 plus changes of your own (multi-screenshot upload, "Snapshot All Predictions", etc.). Keep all of that working. Apply this package as ONE patch on top of your current project: `final.patch` is the unified diff against Update 7 (every changed file); new files are in the zip. Where a hunk does not apply, re-implement the same behaviour in your version of the file. Read `CHANGELOG.md` (top section "FINAL PACKAGE") first.

Hard rules: do not change μ / r, gates (STAB / FADE / PLAY / BET need REAL inputs, known availability, a real two-way price and EV > 0 at the offered price), joint correlations, or grading rules. **The web app and server must contain no scraping**: no Playwright / Puppeteer / headless browser, no credentials, no stealth, nothing that contacts a sportsbook. Odds enter only by pasted / uploaded JSON or CSV (primary) or the existing screenshot upload (fallback).

## What the package contains
1. **Update 8 — automatic daily card + self-grading for NHL, NFL, MLB** (same pattern as NBA): `card_core.ts`, `nhl_card.ts`, `nfl_card.ts`, `mlb_card.ts`, `use_daily_card.ts`, `common/CardBoard.tsx`; NFL games gain `kickoffAt`; MLB desk gains an optional `onAutoLogPriced`. NBA runs on the shared core (keep `gatekeep_nba_card_v1` rows and ids).
2. **Update 9 — Parlay Lab** for NBA, NHL, NFL (new `parlays` tab) and under MLB's Parlay Sim tab; automatic paper tickets graded from the daily cards; cross-sport `BaselineStrip` above each scoreboard: `parlay_core.ts`, `common/ParlayLab.tsx`, `common/BaselineStrip.tsx`.
3. **Update 10 — bettable filter, best line, odds import**: `bettable.ts`, `desk_rank.ts`, `odds_ingest.ts`, `common/BettableSettings.tsx`, `common/OddsImportPanel.tsx`, desk changes in `NbaDesk.tsx` / `NhlDesk.tsx`, App adapters for NBA / NHL / MLB (0.5) / NFL (main line). Config saved at `gatekeep_bettable_v1`.
4. **`scripts/odds/`** — local Python tools, not imported by the app: `write_gatekeep_json.py`, `parse_table.py`, `fetch_template.py` (optional template, no selectors), `schema.md`, `README.md`, examples, `test_odds_tools.py`.

## Verify and report (short)
1. `npx tsc --noEmit` and `npm test` (161 tests when merged onto Update 7); `cd scripts/odds && python -m unittest test_odds_tools` (6 tests). Report type errors verbatim; fix type errors only.
2. Open each sport before its games: History / scoreboard shows rows logged with no click; after the games, rows grade themselves (VOID for DNP).
3. NBA desk: low-usage 3PM hidden by default ("Full model" shows it with the reason); a real shooter at −110 / −110 stays and sorts by EV; two pasted lines for one player's PTS both appear with a BEST LINE chip.
4. Parlay Lab: same-player Pts + 3PM shows joint above the product; Edge / Safe offer only bettable legs; typing a book price shows EV, clearing it shows "fair price only".
5. `python scripts/odds/write_gatekeep_json.py --in scripts/odds/examples/sample_nba.json --out out` produces a file the Odds import panel accepts.
6. Confirm `grep -ri "playwright\|puppeteer\|selenium\|headless" src server.ts package.json` returns nothing.
7. Status table (sport × bettable filter / best line / JSON import / daily card auto-snapshot + auto-grade / Parlay Lab / local script → JSON; screenshot fallback = existing). Do not tune any model on the first days of results.
