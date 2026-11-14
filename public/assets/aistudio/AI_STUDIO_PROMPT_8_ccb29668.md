# Gatekeep Sports Desk — Update 8: automatic daily card + self-grading for NHL, NFL and MLB

IMPORTANT — MERGE, DO NOT OVERWRITE. Your copy has things my zip does not. Apply this update as a patch on top of your current project: `update8.patch` (unified diff against Update 7) lists every changed file; new files are in the zip. Where a hunk does not apply, re-implement the same behaviour in your version. Do not change pricing, gates, joint logic or honesty rules: STAB / PLAY / FADE still need a real two-way price and EV > 0 at the offered price.

## What this adds (same pattern as the NBA card)
1. `src/lib/card_core.ts` — shared core (row type, never-overwrite merge, grading, reasons, summary, filters, storage prune). `nba_card.ts` and `types/nba.ts` now sit on it; keep your NBA behaviour and stored rows (`gatekeep_nba_card_v1`) as they are.
2. `src/lib/nhl_card.ts`, `nfl_card.ts`, `mlb_card.ts` — capture (pre-game only, skip Out/benched, REAL-model rows) and grade (official box score / nflverse finals; DNP = VOID).
3. `src/components/common/CardBoard.tsx` — one scoreboard used by all four sports; `src/lib/use_daily_card.ts` — persistence + automatic grading triggers (slate load, tab open, tab focus ≥5 min apart, "Grade now").
4. `App.tsx` — one block "AUTOMATIC DAILY CARD + SELF-GRADING: NHL / NFL / MLB" before the NBA section, plus the `CardBoard` above `NhlScoreboard`, `NflScoreboard` and `MlbLedger`. `MlbDesk.tsx` gets an optional `onAutoLogPriced` prop (silent, two-way price, game not started). `nflverse.ts` / `types/nfl.ts` add `kickoffAt` (Eastern kickoff as epoch ms; unknown = never treated as future).
5. Storage keys: `gatekeep_nhl_card_v1`, `gatekeep_nfl_card_v1`, `gatekeep_mlb_card_v1`; 120-day prune; "Export card JSON" on each board.

## Verify and report (short)
1. `npx tsc --noEmit` and `npm test` (144 tests when merged onto Update 7). Report type errors verbatim; fix type errors only.
2. Open each sport before its games start: the History / scoreboard tab shows rows logged with no click and a status line "Auto-logged N …". Come back after the games are final: rows grade themselves (or press "Grade now"); a player who did not play shows VOID.
3. Report a short status listing, for NBA / NHL / NFL / MLB, whether auto-snapshot and auto-grade are live, and anything blocked by missing data or a failing grader (say so explicitly; do not simulate results).
4. Do not tune any model on the first days of results.
