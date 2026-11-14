# Gatekeep Sports Desk — Update 9: Parlay Lab, paper-ticket tracker, cross-sport baseline strip

IMPORTANT — MERGE, DO NOT OVERWRITE. Apply on top of your current project (Update 8): `update9.patch` is the unified diff against Update 8; new files are in the zip. Where a hunk does not apply, re-implement the same behaviour. Do not change single-leg μ / r, gates, daily-card capture / grading, joint correlations or honesty rules. A parlay ticket is NEVER tagged STAB / FADE / PLAY / BET; EV exists only when the user types a real book parlay price.

## What this adds
1. `src/lib/parlay_core.ts` — leg builders (daily-card rows; priced NBA / NHL ledger rows that qualified), eligibility (estimated / unknown availability never in Edge or Safe), ticket rules (same-game vs cross-game, PRA conflict, ≤ 2 legs per team in Edge / Safe), pricing (NBA copula with measured ρ; NHL same-skater copula + measured teammate ρ; NFL teammates 0.03; MLB `simMlbCard`; different games multiply), fair American price, EV from a typed book price, deterministic suggestions, fixed daily paper-ticket menu, grading (any miss = MISS, all hit = HIT, void / push leg = VOID), calibration summary.
2. `src/components/common/ParlayLab.tsx` — the UI (modes, 2–6 legs, presets, suggestions, candidate list with ineligibility reasons, ticket with joint vs product vs fair price, book price → EV, warnings, paper-ticket table).
3. `src/components/common/BaselineStrip.tsx` — one table of model win % vs always-UNDER / always-OVER for every sport, above each scoreboard.
4. `App.tsx` — one block "PARLAY LAB" after the NBA card code (paper tickets storage `gatekeep_parlay_paper_v1`, auto-build 4 s after the board changes, auto-grade from the card rows, baseline rows), a `parlays` tab for NBA / NHL / NFL (`VALID_TABS`, `Header.tsx`), and the Lab under MLB's existing Parlay Sim tab. `use_daily_card.ts` generic bound relaxed to `{id, date}`.

## Verify and report (short)
1. `npx tsc --noEmit` and `npm test` (154 tests when merged onto Update 8). Report type errors verbatim; fix type errors only.
2. Open NBA → Parlay Lab: same-player Pts + 3PM preset shows joint above the product; a 3-leg cross-game ticket shows joint = product; an estimated leg is greyed out in Safe / Edge; typing a book price shows EV, clearing it shows "fair price only".
3. After a game day: the Paper tickets table shows graded tickets; the baseline strip shows model vs both baselines per sport.
4. Report which sports have same-game dependence pricing (NBA, NHL, NFL, MLB) and which have edge tickets (NBA, NHL only). Do not tune anything on the first days of results.
