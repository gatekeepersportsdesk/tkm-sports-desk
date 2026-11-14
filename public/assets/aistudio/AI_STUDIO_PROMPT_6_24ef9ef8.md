# Gatekeep Sports Desk — Update 6 (apply on top of Update 5): NBA v2

Replace the project with the attached zip's files. Do not change pricing, gating or honesty logic in NFL, MLB or NHL. NBA follows the same rule as the rest: nothing is BET / PLAY / STAB without real inputs, a known-available player, a posted two-way price, and EV > 0 at the offered price.

## What changed
1. `src/model/nba_engine.ts` (nba_v2) + generated `src/data/nba_fit.ts` (do not hand-edit): three player groups (veteran / team changer / new), rookies REAL after `minGamesNew` = 3 games, less reliance on last season for changers and new players, seven markets (Points, Rebounds, Assists, 3-Pointers, PRA, Steals, Blocks), absence slope.
2. `src/model/nba_joint.ts`, `src/components/nba/NbaJointPanel.tsx`: up to 3-leg same-game joints, copula with measured correlations (same player clearly dependent; teammates/opponents ~ 0). PRA with its own parts is refused.
3. `src/lib/nba_data.ts`, `nba_board.ts`, the NBA components, `App.tsx`: new markets, previous-team detection, OCR market inference (PRA / steals / blocks).
4. `scripts/nba/fit_nba.py`: syntax error fixed; whole fit re-run and reproduced.
5. Tests: 130 passing in total. `npm run fit:nba` regenerates the fit.

## Do this
1. Apply the files; run `npx tsc --noEmit` and `npm test`. Report type errors verbatim; fix type errors only, not behaviour or numbers.
2. Open the NBA tab and paste the status lines back verbatim (schedule, players loaded, injury report). If a feed says "unreachable", paste the server console error. Do not add fallback or invented data; with no injury feed every player is availability UNKNOWN and nothing can qualify, which is intended.
3. Find a player with fewer than 20 games last season: he should show EST for his first 2 games this season and be priced normally from game 3.
4. Open a drawer, build Points + 3-Pointers for one player: the joint should be well above the independent product. Two different teammates should come out close to the product.
5. Do not add NBA possession simulation, home-court or back-to-back features, or hand-set correlations: measured or tested and not adopted.
