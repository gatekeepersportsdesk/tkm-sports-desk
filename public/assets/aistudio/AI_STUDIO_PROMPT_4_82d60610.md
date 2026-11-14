# Gatekeep Sports Desk — Update 4 (apply on top of Update 3)

Replace the project with the attached zip's files. Do not change pricing, gating or honesty logic. Anything BET / PLAY / STAB still requires real inputs, a known-available player, a posted two-way price, and EV > 0 at the offered price. The simulator only DISPLAYS joint probabilities and fair prices; it never produces a bet signal.

## What changed
1. `server.ts` — respects `DISABLE_HMR=true` (the old code forced HMR/file watching on, so every file edit pushed a full page reload to the browser = the "random refresh"). Keep this behaviour.
2. `src/App.tsx` — logs `App mounted (#n)` per tab session; shows a banner saying WHY the page reloaded (`src/lib/session_diag.ts`). Navigation stays persisted (`gatekeep_nav_v1`). NHL tuning is stored as overrides only (`gatekeep_nhl_tuning_v2`).
3. `src/model/gamesim.ts` + `gamesim_params.ts` — calibrated game simulator (team volume → Dirichlet shares → outcomes). New exports used by the UI: `simulateNhlTeam`, `simulateNflTeam`, `simJoint`, `DrawLeg`. `SimJointBuilder` and the NFL / NHL player drawers use them.
4. `src/model/nfl_engine.ts` + `src/lib/nflverse.ts` — NFL v1.6: teammate absence from the official injury report (Out/Doubtful), `mu *= exp(0.60 * -ln(1-L))`, factor capped at 1.5. Recent form is deliberately NOT included.
5. `src/data/nhl_fit.ts` — generated, auto-weighted fit (SOG r 16, points r 33, rho 0.275, etc.). Do not hand-edit.
6. Tests: `gamesim.test.ts` (12), `nfl_absence.test.ts` (6), `session_diag.test.ts`.
7. `package.json` scripts: `npm run fit:nhl:check -- 2025.csv 2026.csv`, `npm run fit:nhl -- 2025.csv 2026.csv`.

8. Late fixes: stale "v1.4 / v1.5" labels in the NFL drawer, header and App now say v1.6; the joint builder (`SimJointBuilder`, via a new optional `caution` on each leg) shows an amber warning when any selected player has estimated inputs or unconfirmed availability, and says the fair price is indicative, not a bet signal.

## Do this
1. Apply the files; run `npx tsc --noEmit` and `npm test`. Expect 103 passing (the `npx tsc` run should be clean; if it reports only React `key`-prop or missing-module errors from your tooling, send them verbatim). Report type errors verbatim; fix type errors only, not behaviour or numbers.
2. Open the NHL desk, then a player drawer: the "Game simulation joint" panel should appear when the team has 9+ priced skaters (otherwise the old shots+points panel). Open an NFL receiver drawer: "Same-game receptions stack".
3. Say whether a "Page was reloaded" banner ever appears while you work, and what it says. If it says the dev server reloaded the page, paste the `[gatekeep] HMR/file-watching is ...` line the server now prints at startup (or open /api/health and read `hmr`).
4. Do not add EPA / success rate / pressure / pace / recent-form features to NFL pricing; they were tested and did not help consistently.
