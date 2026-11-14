# FINAL PACKAGE (Updates 8 + 9 + 10 + local odds producer)

* **Daily cards + auto-grade:** NBA, NHL, NFL, MLB (shared `card_core`).
* **Parlay Lab + paper tickets + BaselineStrip** across sports; NFL priced legs feed Edge/Safe from snapshots.
* **Bettable filter, best-line chip, JSON/CSV odds import** (`bettable`, `odds_ingest`).
* **`scripts/odds/`:** local writer / table parser / optional Playwright fetch for Bet99 + Bet365 only. The web app never scrapes sportsbooks; odds enter via import or screenshot OCR.
* **Product boundary:** server outbound calls are public stats feeds only.

---

# Update 6 — NBA v2: early season, PRA / steals / blocks, measured joints

## 1. Early season, rookies, team changers (the complaint: "20 games is too strict, last season counts too much")
* The 20-game rule is gone. Veterans and team changers are REAL from game 0; a player with fewer than 20 games last season ("new") is REAL after 3 games this season (`minGamesNew`, editable in NBA Settings). Held-out evidence for new players: at 0-2 games coverage 29/54/66% and actual/expected 0.55 (badly off, stays ESTIMATED); at 3-4 games 51/78/89% and 0.96 (on target).
* Last season is down-weighted for players whose situation changed: the weight on last season is multiplied by 0.5-1.0 for team changers and 0.1-0.5 for new players (fitted per market, see `nba_fit.ts`), plus a fitted level factor (0.9-1.0) that fades out over the first 20 games and a dispersion scale of 0.8-1.0 on r (below 1 = wider intervals, because these groups are more uncertain). Held-out log-lik improves in every group and market, most for new players (points -3.0977 vs -3.1142, threes -1.2678 vs -1.2884).

## 2. More markets: PRA, steals, blocks
Each fitted with its own shrinkage, opponent, absence and dispersion constants. Held-out log-lik/row v2 / Update-5 model / naive season average: PRA -3.4970 / -3.5026 / -3.6404; steals -1.1989 / -1.1994 / -1.2456; blocks -0.8733 / -0.8748 / -0.9038. Coverage 50/80/90 within about 1 point of nominal for all seven markets (e.g. PRA 51/80/90, blocks 50/80/90).

## 3. Measured NBA correlations and Monte Carlo joints
* Correlations are fitted on real box-score residuals (held-out marginals, matched on the copula scale at each player's own median-ish line, game-clustered bootstrap errors). Same player: points-threes 0.72, points-rebounds 0.32, points-assists 0.23, rebounds-assists 0.24, assists-threes 0.15. Teammates and opponents: every pair within about 0.05 of zero (pairs inside 2 standard errors are set to exactly 0).
* Joint check at each leg's own line (Brier summed over the four over/under corners, copula vs independence): points+threes -7.8%, points+rebounds -1.4%, points+assists -0.6%, rebounds+assists -0.9%; teammate and opponent pairs 0.00% (a stack of different players really does price like the product, and the panel says so). Correlations were fitted on the same data they are checked on, one parameter per pair, so the gains are slightly optimistic.
* **I did not build a possession simulator for NBA.** Teammate dependence measured at zero, so a Dirichlet share simulator would only add structure the data does not show. Same-game joints use the copula.
* PRA already contains points, rebounds and assists: PRA together with one of its parts on the same player is refused (a copula cannot represent an exact sum).

## 4. Absent-player redistribution
Handled empirically rather than by a rule: the fitted absence lift has a slope (bench players gain more in percent than starters) and the implied lift on the listed teammates absorbs a median 50% of the lost rotation minutes; the rest goes to players off the board, so team totals do not inflate.

## 5. Repairs and verification
* `scripts/nba/fit_nba.py` as left on disk had a syntax error (an apostrophe inside a quoted string), so the committed fit could not be regenerated. Fixed, re-ran the whole fit from the raw box scores: parameters, priors and the 300 parity rows reproduce exactly; the correlation table came out up to 0.05 different from the previous copy (bootstrap-based zeroing), so the regenerated one is the one shipped. It also now carries the joint-check evidence.
* Tests: 130 pass (NFL, NHL, MLB and NBA, including Python-vs-TypeScript parity at 1e-9, gate tests, joint tests). Engine/lib/server typecheck strict-clean; UI typechecks apart from my sandbox stubs.

## Not verified from the build sandbox
* The live ESPN schedule and injury endpoints (a reviewer reported both returned 200 from their environment; your running instance's reachability is what the NBA status line shows).
* UI rendering, grading on live games, screenshot OCR.
* The absence coefficients were fitted on realized DNPs and are an upper bound for a live injury report; NBA Settings has a scale.

---

# Update 5 — NBA player props (nba_v1) and 15,000 default simulations

## NBA desk (Points, Rebounds, Assists, 3-Pointers Made)
* **Data layer** (`src/lib/nba_data.ts`, `server.ts`): game logs from the sportsdataverse ESPN box-score releases (same source as the fit); schedule + injuries from ESPN. DNP is never a zero. A missing injury feed marks every player UNKNOWN, which cannot qualify.
* **Rate engine** (`src/model/nba_engine.ts`): per-minute shrinkage (season -> last season -> G/F/C prior), projected minutes (last 5 + shrunk season average), shrunk opponent factor, teammate-absence factor, minutes-dependent Negative Binomial r. Python reference and TypeScript agree to 1e-9 on 300 exported rows.
* **Fit evidence** (`scripts/nba/*`, walk-forward, leave-one-season-out on 2023-24 to 2025-26): held-out log-lik per row, new vs single-r vs naive season average: points -3.2930 / -3.3217 / -3.3506; rebounds -2.2815 / -2.2859 / -2.3139; assists -1.9850 / -1.9922 / -2.0247; threes -1.5159 / -1.5184 / -1.5460. Held-out interval coverage near nominal (points 52/81/90 for the 50/80/90 bands). Opponent factor and injury absence adopted; home court marginal and back-to-back null, both left out.
* **Desk / scoreboard / settings** mirror NHL: market toggle, per-game filter, price entry at the actual offered price, qualifying-only filter, row drawer (rate, minutes, opponent, absence, sd, EV both sides), ledger with real-box-score grading (did-not-play = VOID, integer-line push refunded, game never played = VOID after 7 days), Brier model vs market, 50/80/90% coverage per market, settings with scales on every fitted value and a read-only fitted table.
* **Screenshot import** accepts NBA (points/rebounds/assists/threes); an off-ladder line is added and priced rather than dropped; combo markets (PRA etc.) are skipped and reported.
* **No NBA joints yet** (Phase 2): there is no measured NBA teammate correlation and none is invented. The drawer says so.

## Default Monte Carlo draws 10,000 -> 15,000
`gamesim`, the copula sampler, `NHL_CONFIG.sims` and the NFL receptions stack. NHL Settings still lets you override it. NFL/NHL pricing paths are unchanged (closed form); 123 tests pass including all earlier NFL/NHL tests.

## Not verified from the build sandbox
* ESPN NBA schedule and injury endpoints (hosts blocked here): the parsers follow the documented shape and are tested on fixtures of that shape; if either feed fails the desk shows it in the status line.
* UI rendering (typechecked only), box-score grading on live games, screenshot OCR.
* The absence coefficient was fitted on players who actually missed games; a live injury report also lists players who then play, so the true effect may be milder (use the Absence scale in NBA Settings).
* The free box-score release can lag the games by hours, so grading may show PENDING until it updates.
* Early season: with 2-3 games played the priors dominate on purpose; players with fewer than 20 games across this and last season are ESTIMATED and cannot qualify.

---

# Update 4b — independent verification of Update 4 (nothing taken on trust)

Re-ran everything rather than relying on the notes above:
* **Simulator, fresh code:** simulated marginals match the closed-form negative binomial (P(over) within 0.001-0.007; NFL means within 0.01, NHL P(over) within 0.003), teammate correlation 0.027 (NFL) / 0.018 (NHL shots), deterministic for a fixed seed. Per-player variance is matched in aggregate per team, so an individual receiver can sit up to about 10% off his own target variance (WR1 -6%, WR3 +10% in the test roster).
* **NHL real games, 1,293 team-games NOT used to solve the points loading:** team points inside the simulated 80% band 79.2% (independence 56.5%), team shots 80.9% (75.2%). Same-skater SOG>=3 & PTS>=1: simulated 14.04%, actual 13.58%, independence 11.08%. Teammates both SOG>=3 is a tie with independence.
* **NFL real games (7,964 player-games):** marginal coverage 50.4/80.3/90.2; teammate-stack Brier tie with independence (the measured dependence is only +0.027).
* **NFL absence (injury-report Out/Doubtful) reproduced:** positive in 2024 (+0.011), 2025 (+0.007) and 2026 (+0.003) with a clustered-bootstrap interval above zero; actual/mu rises with lost target share (1.13 -> 1.41) in line with the implied factor (1.06 -> 1.45). My earlier "absence doesn't work" result was wrong: 97.9% of injury-Out players have no snap row at all, so treating unmatched players as present hid the real absences. **Recent form still fails** (+0.0018 pooled, but -0.0027 in 2026 and coefficient +0.40 vs -0.07), so it stays out; re-test around week 12.
* **Scoreboard coverage** still uses the closed form on purpose: the simulator's marginals equal it (checked above), so routing the scoreboard through simulated draws would only add sampling noise.
* **Fixes made:** stale v1.4/v1.5 labels now v1.6; the joint builder warns when a leg has estimated inputs or unconfirmed availability (it never emits BET/PLAY/STAB and never computes EV).
* **Tests:** 103 pass; engine/lib typecheck strict-clean; UI typechecks apart from my sandbox stubs (React `key` prop, icon names, a CSS import).
* **Still not verified:** UI rendering, whether AI Studio really sets `DISABLE_HMR` (the project's own vite.config.ts says it does), box-score grading on live games, screenshot OCR.

---

# Update 4 — game simulator, refresh fix, NHL auto-weighting, NFL teammate absence

## 1. The refresh / kick-back problem
Root cause found in `server.ts`: it forced Vite HMR and file watching ON regardless of `DISABLE_HMR=true`. AI Studio sets that flag because its agent edits files while you work, so every file touch made the dev server push a FULL PAGE RELOAD, which looked like random refreshes while you analyzed NHL. The server now respects the flag (same rule as `vite.config.ts`).
Also audited: every NHL `useEffect` (schedule, rosters, factors, injuries, odds, ledger, tuning) only sets local state or storage; none can remount the tree. The ErrorBoundary resets only its own error when you change tab and never touches navigation. No `location.reload`, no changing `key` props.
New visible trace: a banner says why the page reloaded (dev-server reload / server restarted / browser reload), the console logs each App mount (`App mounted #n`), and window errors / unhandled rejections are logged without leaving the tab. Not verifiable from here: whether AI Studio really sets `DISABLE_HMR` in your session; if the banner still appears with "dev server reloaded", that tells us it does not.

## 2. Game-level Monte Carlo simulator (`src/model/gamesim.ts`)
* Per team per simulated game: team volume (gamma-Poisson, so over-dispersed) → Dirichlet shares across players → each player's outcome (NFL: targets thinned by catch rate into receptions; NHL: shots, then points tied to the same skater's shots and a shared team scoring factor).
* **Nothing is eyeballed.** For each team the volume dispersion and Dirichlet concentration are SOLVED so every player's marginal variance equals the validated closed-form negative binomial and the mean teammate correlation equals the MEASURED value (NFL receptions +0.027; NHL shots +0.018, points +0.096; opponents ≈ 0, so teams are simulated independently). Constants and where each came from: `gamesim_params.ts`.
* Closed form is still the path for single-leg prices. The simulator prices joints: same-skater shots+points, teammate stacks, any up-to-3-leg combination (`SimJointBuilder` in the NFL and NHL player drawers).
* Configurable draws (NHL Settings, default 10,000). Deterministic for the same inputs and seed.
* **Checked on real games** (not on the data it was solved from, except where noted):
  * NHL, 1,500 real 2025-26 team-games: actual team point totals fell inside the simulator's 80% band 79.1% of the time (independence: 56.0%); team shots 81.0% (independence 75.1%). Real-2026-only: 78.7% / 82.0%. (The points-factor loading was solved on a 120-game subset of the same data.)
  * Same-skater SOG≥3 & PTS≥1: simulated 14.0%, actual 13.6%, independence 11.0%; SOG≤1 & PTS=0: 38.7 / 40.0 / 35.1. Teammates both with a point: 16.4 / 16.1 / 14.6. Brier better than independence on all three.
  * **Teammates both SOG≥3: a tie with independence (6.4 / 5.9 / 6.2).** Teammate shots are essentially independent, and the simulator does not pretend otherwise.
  * NFL, 7,964 real player-games 2024-26: simulated marginals cover 50.4 / 80.3 / 90.2% at the 50/80/90 levels. Teammate receptions pairs: simulated 15.6%, actual 16.4%, independence 15.3%; **Brier a tie**. A receptions stack prices close to the product of its legs, because the measured dependence is small (+0.027). It is NOT strongly negative, as the Dirichlet idea suggests: negative competition for targets is cancelled by shared game volume.
* Scripts: `validate_gamesim.ts` (team totals), `validate_gamesim_joints.ts`, `validate_gamesim_nfl.ts`, `calibrate_gamesim.ts`, `measure_nhl_dependence.py`.
* Limits: NHL absent players' shots are not redistributed to teammates; scoreboard interval coverage still uses the closed form (the simulator's marginals match it by construction and were checked above); no play-by-play state machine.

## 3. NHL fit now moves to real 2026 data by itself
`scripts/fit_nhl_moneypuck.py` weights the first-half/second-half split of 2025 by `max(0, 1 - real_rows / pseudo_rows)` (0.75 today), compares equal / auto / real-only schemes on held-out REAL 2026 rows only, and has `--check` to see drift without writing. `npm run fit:nhl:check -- 2025.csv 2026.csv` then `npm run fit:nhl -- 2025.csv 2026.csv`. Today the three schemes are within 0.0006 LL/row, so the choice barely matters yet; as 2026 fills in, points shrink K can move toward the ~60 that real-only data prefers. Shipped fit (auto): SOG r 16, K 20/5; points r 33, K 30/10; rho 0.275.

## 4. NFL
* **Teammate absence is now IN (engine v1.6).** The first test failed because inactive players have no snap rows, so "absent" was misdetected. Rebuilt from the official pre-game injury report (Out/Doubtful), proportional target redistribution: `mu *= exp(0.60 · -ln(1-L))`, L = lost trailing target share, clipped at 0.6, factor capped at 1.5. Pooled blocked CV over 6,529 WR/TE player-games: +0.0087 log-lik/row, 95% CI [+0.0049, +0.0125], positive in 2024 (+0.0114), 2025 (+0.0074), 2026 (+0.0026). Through the real engine: affected rows (about 21%) go from actual/mu 1.18 / 1.13 / 1.04 to 1.01 / 0.97 / 0.89. Other analyses with different populations gave smaller sizes (+0.0016 to +0.0046); all positive in every season. Caution: 2026 now slightly over-corrects (0.89 on 122 rows), so watch it. The coefficient is deliberately shrunk (0.60 vs about 0.9 fitted). 6 new tests.
* **Recent form stays OUT, with the exact test.** Trailing 3-game receptions shrunk toward mu: +0.0018 pooled (CI +0.0007 to +0.0031) and positive in 2024 and 2025, but −0.0027 in 2026 (CI −0.0055 to +0.0003), and its coefficient is +0.40 on 2024-25 vs −0.07 on 2026 alone. Fails the rule "positive in every season". Re-test around week 12 of 2026 (`scripts/nfl_experiments/nfl_absence_form_v2.py`).
* Earlier findings stand: EPA, success rate, sack+hit rate, blitz, play-action and pace added nothing.

## Verified here
103 tests pass (12 simulator, 6 absence added), project-wide typecheck clean apart from my stub's `useRef(null)` limitation, server and app entry bundle. Not verified: UI rendering, box-score grading, screenshot OCR, whether AI Studio sets `DISABLE_HMR`.

---

# Update 3b — NHL fitted on your MoneyPuck files

The files arrived. `scripts/fit_nhl_moneypuck.py` was run on `2025.csv` (47,212 skater-games) + `2026.csv` (6,011; only ~167 games so far this season). Population = skaters averaging 12+ min (the app prices ~top-16 per team); regular season only. Because 2026 is a week old, the larger share of rows is a first-half/second-half split of 2025 (first half acts as "last season"). All numbers below are walk-forward and scored on held-out skaters.

| Parameter | Was | Now | Evidence |
|---|---|---|---|
| Shots r | 15.13 (frozen) | 16 | held-out LL +0.0014/row; coverage 50.0/80.2/90.0 (was 50.1/80.4/90.5) — the old value was already close |
| Shots shrink K / prior K | 20 / 20 | 20 / 10 | |
| Points r | 12 (prior) | **36** | LL +0.0038/row; 80% coverage 79.8 (was 80.6); the old r was too fat |
| Points shrink K / prior K | 40 / 40 | 30 / 10 | |
| Forward / Defense shots per game prior | 2.0 / 1.6 | 1.90 / **1.30** | defense was overstated by ~19% |
| Forward / Defense points per game prior | 0.45 / 0.25 | **0.59 / 0.35** | |
| Shots↔points correlation (copula ρ) | 0.35 (guess) | 0.28 | matched to observed residual correlation 0.218 on the app's own copula scale |

Also tested on this data:
* **5v5 + power-play split rate vs all-situations rate:** adds nothing (best blend weight 0). Not wired in.
* **Live opponent shots-against factor:** real signal. +0.0015 to +0.0022 LL/row in both seasons, pass-through exponent about 1 at K 10–20, so the app's K = 15 stands. (`scripts/nhl_opp_factor_test.py`)

Fix that matters: tuning is now stored as overrides only (`gatekeep_nhl_tuning_v2`). The old key stored every default and would have pinned the old priors on top of the fitted ones.

Limits, plainly: the gains are small except for points dispersion and the defense prior; 2026 has only ~5k scorable rows so far, and 2025 rows come from a pseudo-split rather than a true prior season. Re-run the script every few weeks as 2026 fills in. xGoals/corsi were not used (no measured gain was tested). Fitted values are still overridable in Settings.

---

# Update 3 — NHL calibration pipeline, NFL feature evidence

## NHL: fitted from your MoneyPuck files (2025 full season + 2026 to date)
`scripts/fit_nhl_moneypuck.py` ran on `2025.csv` (1,312 games) and `2026.csv` (167 games so far), regular season only, skaters averaging 12+ min (the population the app prices). Walk-forward only; held-out = player cross-fit (fit on half the skaters, score the other half).

| Parameter | Was | Now | Evidence |
|---|---|---|---|
| SOG dispersion r | 15.13 (frozen) | **16** | held-out LL +0.0014/row; real-2026-only run gives 17 and no gain: the old value was essentially right |
| SOG shrink K / prior K | 20 / 20 | **20 / 10** | same |
| Points dispersion r | 12 (prior) | **36** | held-out LL +0.0038/row; real-2026-only run gives 24. Points were far less over-dispersed than assumed |
| Points shrink K / prior K | 40 / 40 | **30 / 10** | real-2026-only run prefers 60: treat as 30-60 |
| Position priors (per game) | F 2.0 / D 1.6 SOG; F .45 / D .25 pts | **F 1.90 / D 1.30 SOG; F .59 / D .35 pts** | league means for 12+ min skaters |
| Shots↔points ρ | 0.35 (prior) | **0.276** | matched on the app's own copula scale; real-2026-only run gives 0.258 |
* Held-out PIT coverage 50/80/90: SOG 50.0/80.2/90.0, points 50.0/79.8/89.9 (defaults were 50.1/80.4/90.5 and 50.7/80.6/90.6, so coverage was already fine; the gain is sharper probabilities, not new calibration).
* **5v5 + power-play split rate did not beat the all-situations rate** (best blend weight 0). Not adopted.
* Caveats: 80% of the fitted rows come from a first-half/second-half split of 2025 (less than a full prior season, so the Ks are approximate); 2026 is only ~17 games per team, so re-run the script every few weeks. Gains are small per row. The big corrections are points r and the position priors.
* The app overlays these (bounds-checked) and shows them green "fitted from data" in NHL Settings. Opponent-factor K, stale-table weight and Monte Carlo draws are still settings/priors. `skaters-5.csv` is a season summary and was not needed.
* The script originally checked itself on synthetic data with known answers (ρ recovered 0.403 vs 0.40).

## NFL: tested every suggested feature; none earned a place
Free data only (nflverse play-by-play + FTN charting for blitzers). Each feature uses games before the week, shrunk to league mean, fit on one season and scored on the next (`scripts/nfl_experiments/`).
| Feature | Result (log-lik per row, + = better) |
|---|---|
| EPA/play, success rate, sack+QB-hit rate, blitz rate, play-action, pace (all) | −0.0003 (2025), +0.0001 (2026) |
| Best single features | under 0.002 and sign flips between seasons |
| Teammate absence / target redistribution | first run looked like +0.0011 — that was **a name-matching bug creating phantom absences**; fixed it was −0.0002 |
| Trailing 3-game receptions / targets | +0.0012 (2025), −0.0053 (2026) |
So v1.5 stays as is. The mean already sits on spread, total, routes and trailing production, and these add noise rather than signal at this sample. Re-test around week 12 of 2026. (Note: real pressure and coverage-vs-route data is paid charting; sack+hit rate is only a proxy, and FTN blitz data is free but CC-BY-SA.)

## Honest limits
* The Monte Carlo layer is still a copula over validated marginals, not a snap-by-snap or Dirichlet-multinomial game simulator. Nothing measured so far says it would improve single-leg prices; it would matter for correlated NFL props. Not built this round.
* Not verified: UI rendering, box-score grading on live games, screenshot OCR on a real slip.
* Tests: 80 passing (added the fit-overlay test). `tsc` clean on engine/tests; the Settings modal only shows stub-type noise in my sandbox.

---

# Update 2 — tab reset, OCR integrity, sampling layer, NHL tuning

## Bugs found and fixed
* **"Kicked back to NFL"** — two causes. (1) `activeSport` lived only in React state, so any reload / hot reload / remount reset it to NFL; it is now persisted (`gatekeep_nav_v1`) and validated on load. (2) The screenshot scanner let Gemini's guess at the sport (`detectedSport`) override the target you picked, and Apply then switched the whole app to that sport (often NFL). The guess is now only a hint banner; your selection is never overridden.
* **Fabricated lines in the scanner (missed in the first pass).** On any OCR failure — and whenever you clicked a sport pill with lines loaded — the modal injected hard-coded sample lines with fake odds (JSN, Matthews, Judge…), and "Try Sample Slip" fed a fake slip through OCR. All removed. A failed scan now says so and adds nothing; manual rows start blank (no pre-filled -115/-115); Apply requires a player and at least one price.
* A render error in one desk can no longer blank the app: an error boundary wraps the content area (the sport switcher stays alive) and resets when you change tab.
* OCR prompt now returns a per-line `prop` (shots / points), tells the model not to guess unreadable values; NHL rows get a SOG/PTS market selector in the review table.

## Sampling layer (`src/model/sampler.ts`)
* Seeded Gaussian copula over the existing, validated negative-binomial marginals. Marginals stay exactly as priced (tested: sampled mean/variance/P(over) match the closed form); only the dependence between legs is added. Deterministic (same inputs → same answer).
* Why a copula rather than a from-scratch game simulator: the NFL marginals were validated by backtest and interval coverage; a game simulator would have to re-earn that calibration. Joint questions are where simulation matters, so that is where it is used. Closed form remains the path for single-leg prices.
* **Measured on real data** (`scripts/estimate_nfl_corr.ts`, nflverse 2025 wk3-18 + 2026 wk3-6, walk-forward residuals): WR/TE teammates ρ = +0.027 (±0.016), WR-WR +0.040, WR-TE +0.028, opposing receivers −0.001 (±0.015). So teammate receptions are NOT meaningfully negatively correlated once game script is in the mean, and an NFL stack is close to independent. The sampler's NFL priors use these numbers.
* **NHL same-skater shots↔points ρ = 0.35 is a PRIOR (not measured)** — the NHL feed could not be reached to measure it. Editable in Settings.
* UI: NHL player drawer has a shots + points combo panel (over/under any SOG line + any points line, joint vs independent, fair price, ±MC error). NFL has the library (`jointProbability`, `teamCorrelation`) but no screen yet.

## NHL Settings now expose every prior / frozen value
SOG r (frozen from sog_v1), points r, shrink Ks, position priors, opponent-factor K, stale-table weight, shots↔points ρ, Monte Carlo draws — each labelled "frozen" / "prior — not fitted" / "prior — not measured" / "setting", persisted, with Reset. Ledger rows keep the r they were priced with.

## Verified here
`tsc` clean, **79 tests** passing (sampler, OCR cleaning, tuning added), server + app bundle with esbuild.
Not verified: UI rendering, and the browser behaviour of the error boundary / persistence (logic only).

---

# Gatekeep Sports Desk — audit & fix pass (NFL v1.5 · MLB v5.9 · NHL sog_v2)

Benchmark in mind: RotoBot-style honesty — distributions not point guesses, calibration you can check,
injury/availability awareness, and no number on screen that did not come from data.

## What was wrong everywhere (and is now fixed in all three sports)
| Problem | Fix |
|---|---|
| "Edge" measured against the de-vigged line was treated as a bet signal, but you pay the vig | Every sport now requires **EV > 0 at the price offered** (shared `src/lib/odds.ts`) |
| Blank / garbage odds silently became +100 (fake 50% market, fake two-way) | Parsers return `null`; unpriced rows are model-only and can never qualify |
| Estimated / guessed inputs could still show BET / PLAY / STAB | One universal gate (availability → input quality → edge). ESTIMATED can never qualify |
| Hand-typed injury / roster lists | Removed. Availability comes from live feeds; no feed = UNKNOWN = cannot qualify |
| Random "settle demo" results flattered the scoreboards | Removed. Grading is from official box scores / nflverse. Legacy rows are tagged DEMO and excluded from every metric |
| Odds saved in localStorage with no date (yesterday's price on today's line) | Odds maps are date-stamped and discarded on another day |
| No way to tell if the model is calibrated | Shared calibration lib: Brier vs market, reliability bins, randomized-PIT 50/80/90% interval coverage |

## NFL receptions (v1.4 → v1.5) — validated on real nflverse data
* Real ingestion (`stats_player_week`, `snap_counts`, `injuries`, `games`): routes proxy = team dropbacks × snap %, TPRR shrunk to prior season, walk-forward (week W sees only weeks < W).
* Backtest reproduced the 2025 WR over-prediction; fixed with an in-season **decay-weighted** position ratio (actual/mu 0.935 → 0.991). Carrying the prior-season ratio made 2026 worse, so it is off.
* Early-season dispersion inflation α·(1 + 2.5/games). WR α .10 / TE α .125 re-validated.
* Game cap (3 BETs/game), one-sided price can never be BET, no fabricated -115/-115 baseline rows, receiver/team resolution bug fixed, schedule from nflverse (no hard-coded week, no ESPN spread guessing), real grades from nflverse.

## MLB hits (v5.8 → v5.9)
* Line probabilities from the PA model's hit-count distribution (Poisson-binomial), not a Poisson shortcut, so 1.5 / 2.5 lines are priced correctly (still not PLAY until you opt in).
* Real batter/pitcher inputs from statsapi (season, game log, platoon splits, K%, recent IP). Missing pieces → EST → PASS.
* PLAY requires confirmed lineup, slot 1–3, price window, **EV > 0**, REAL inputs.
* Ledger grades from official box scores (DNP = void, postponed = void); no random grading.
* Parlay picker: EV at the offered price; same-game haircut applied only when no quoted price; deterministic simulation.
* Reference-cache key now includes the tune (changing a setting no longer returns stale numbers).

## NHL (sog_v1 → sog_v2) — and the points market you asked for
* **Points market added** (NB, r = 12 is a prior to calibrate; lines 0.5 / 1.5 / 2.5). Shots / Points toggle on the desk.
* Skater rates are **shrunk** toward last season and a position prior (a 4-game 6.0 shots/game start is no longer priced as a 6.0 shooter).
* Real game logs (last 10 games) replace the fake `[round(mu) ×5]` form chips.
* Opponent factor from live shots-against / goals-against, shrunk by games played; the old hand-typed table is a labelled half-weight fallback.
* **FADE** now needs a real under price and +EV; over/under entered separately and de-vigged together.
* Removed: the 2024 hand-typed roster (players on teams they no longer play for), seeded odds, the fake fallback slate, ESPN game ids (can't be graded), `mu from the line` for screenshot players (now ESTIMATED from the position prior, cannot qualify), mutation of the seed array.
* Ledger: log priced rows → grade from the official box score; scoreboard shows per-market calibration, interval coverage, W-L and units for STAB/FADE only.

## Verified here
* `tsc` clean, **65 / 65 tests** (NFL 17, MLB 19, NHL 29) incl. fixtures for every parser and grader; `server.ts` and the whole app bundle with esbuild.
* NFL pipeline run end-to-end on real nflverse 2024-2026 files.

## NOT verified (be straight about it)
* The sandbox cannot reach the NHL, MLB or ESPN hosts. Those fetchers/parsers are tested against fixtures that follow the documented JSON shapes, **not live responses**. First run on your machine: open each tab and read the status chips (they say exactly which feed failed).
* The UI was typechecked and bundled, **not rendered** (React isn't installable offline here).
* NHL has no historical backtest here: shrinkage K (20 / 40), position priors, the points `r = 12`, and the opponent clamp are sensible priors, not fitted values. Let the ledger's reliability bins and interval coverage tell you what to move; don't trust them before ~200+ graded rows per market.
* ESPN's injury JSON shape was written defensively but is the least certain parser.

## Setup
`npm install && npm run dev` (needs Node 20+; `GEMINI_API_KEY` for screenshot OCR). Tests: `npx tsx --test src/model/*.test.ts`.
