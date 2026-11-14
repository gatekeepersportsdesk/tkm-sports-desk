# Gatekeep Sports Desk — Multi-Sport Props Terminal

A quantitative, small-bankroll player propositions desk designed for serious sports analytics:
1. **NFL Receptions Props (Engine v1.5)** — WR/TE only, OLS dropbacks, Bayesian shrinkage, Negative Binomial discrete pricing, strict -150 chalk ceiling.
2. **MLB 0.5-Hit Desk (Engine v5.9)** — 11-step Bayesian engine, starter K% suppression, park factors, reference anchor centering, and Monte Carlo Gaussian copula parlay simulator.
3. **NHL Shots + Points Desk (Engine sog_v2)** — shrunk skater rates, live opponent factors, Negative Binomial pricing for SOG ($r = 15.13$) and points ($r = 12$, a prior), two-way de-vigged EV, real box-score grading.
4. **NBA Player Props (Engine nba_v1)** — points, rebounds, assists, threes made; per-minute shrunk rates, minutes-aware Negative Binomial, fitted opponent and teammate-absence factors, live injury gate, de-vigged EV, real box-score grading.

See **CHANGELOG.md** for what changed and what could not be verified from the build sandbox.

---

## 1. NFL Receptions Props (Engine v1.5)

### The Projection Pipeline for Expected Receptions $\mu$
1. **Dropbacks (Game Script OLS):**  
   $$\text{Dropbacks} = 36.697 + 0.3075 \times \text{spread} + 0.3562 \times (\text{implied\_total} - 22.0)$$
2. **Route Participation:** Trailing offense snap share (proxy for routes).
3. **TPRR (Targets Per Route Run):** Bayesian shrinkage toward prior ($K = 100$ routes):
   $$\text{TPRR}_{\text{shrunk}} = \frac{\text{Routes} \times \text{TPRR}_{\text{season}} + 100 \times \text{TPRR}_{\text{prior}}}{\text{Routes} + 100}$$
4. **Catch Rate:** Bayesian shrinkage toward league prior ($0.68$, $K = 30$ targets):
   $$\text{CatchRate}_{\text{shrunk}} = \frac{\text{Receptions} + 30 \times 0.68}{\text{Targets} + 30}$$
5. **Structural $\mu$:**  
   $$\mu_{\text{structural}} = \text{Dropbacks} \times \text{RoutePct} \times \text{TPRR}_{\text{shrunk}} \times \text{CatchRate}_{\text{shrunk}}$$
6. **Walk-Forward Position Ratio:** Position-specific actual/predicted, shrunk toward 1.0, clipped to $[0.85, 1.15]$.
7. **v1.4 Blend:**  
   $$\mu = 0.60 \times \mu_{\text{adapted}} + 0.40 \times \text{SeasonAvg}$$
8. **Negative Binomial Pricing:** Position dispersion $\alpha_{\text{WR}} = 0.100$, $\alpha_{\text{TE}} = 0.125$ ($r = 1/\alpha$). Discrete PMF computed via Lanczos log-gamma approximation.
9. **Two-Way De-vigging:** Converts American odds to fair market win probabilities.
   $$\text{Edge} = P_{\text{model}}(\text{side}) - P_{\text{market\_fair}}(\text{side})$$

### The 4 BET Qualification Card Rules
A proposition is tagged **`BET`** only if **all 4 conditions** hold:
1. **Edge $\ge 3.0$ percentage points.**
2. **Recommended side price $\ge -150$** ($-151$ and steeper chalk favorites are automatically demoted to `PASS`).
3. **Historical Form Agreement:** $|\mu - \text{SeasonAvg}| \le 1.5$ receptions. If deviation exceeds $1.5$, row displays **`OFF`**.
4. **Game Card Cap:** Maximum 3 `BET` suggestions per game (ranked strictly by descending edge).
* Suggested stake: **1.0 unit**.

---

## 2. MLB 0.5-Hit Desk (Engine v5.9)

* **Locked TUNE Parameters:**
  - `baseTop3HitRate: 0.673`, `compressionSlope: 0.85`, `calLo: 0.5`, `calHi: 0.8`
  - `lgBa: 0.255`, `seasonPriorPa: 500`, `xbaPriorPa: 120`, `kPriorBf: 150`, `kLeague: 22`, `kCoef: 2.0`
  - `recentWeight: 0.1`, `recentPriorAb: 120`, `platoonPrior: 0.003`, `splitPriorAb: 300`
  - `parkDamp: 0.5`, `marketWeight: 0.5`, `edgeMinPts: 1.5`, `oneSidedHold: 1.07`
* **Card Rules:**
  - **`PLAY`:** Lineup confirmed by MLB, batting in slots 1–3, juice inside $[-140, -220]$ window, edge $\ge +1.5$ percentage points.
  - **`PASS`:** Fails any of the above (with slot-only explanation when order is the sole violation).
* **Monte Carlo Parlay Simulator:**
  - Latent Gaussian copula with team covariance ($0.07$) and game factor ($0.03$), evaluated over 6,000 trial draws with book 5% SGP haircut.

---

## 3. NHL Shots + Points Desk (Engine sog_v2)

* **Skater rate (shrunk, never raw):**
  $$\text{prior} = \frac{\text{prior-season total} + K_0\,\pi_{pos}}{\text{prior GP} + K_0},\qquad
  \mu_0 = \frac{\text{total} + K\,\text{prior}}{\text{GP} + K}$$
  SOG: $K = K_0 = 20$, $\pi$ = 2.0 (F) / 1.6 (D). Points: $K = K_0 = 40$, $\pi$ = 0.45 / 0.25. Position priors are priors, not fitted values.
* **Opponent factor:** live team shots-against (SOG) / goals-against (points) ratio vs league, shrunk toward 1 by games played ($K=15$), clamped to $[0.80, 1.25]$. If the live team table is down, the old hand-typed table is used at half weight and the drawer says so.
* **Distribution:** Negative Binomial, SOG $r = 15.13$ (frozen from sog_v1), points $r = 12$ (**prior — calibrate it on the ledger**). Lines: SOG 1.5–5.5, points 0.5–2.5.
* **Price:** over and under are de-vigged together; one-sided prices assume a 7% hold and are labelled. EV is computed at the price actually offered.
* **Card:**
  - **`STAB`:** over side, edge $\ge 5.0$pp vs the de-vigged price, EV $> 0$, price no worse than $-200$.
  - **`FADE`:** under side, same tests, and requires a real **under** price.
  - **`PASS`:** everything else, including ESTIMATED inputs, UNKNOWN/unavailable players, no price.
* **Joint pricing:** `src/model/sampler.ts` is a seeded Gaussian copula over the same NB marginals (used for the same-skater shots + points combo; ρ is a prior). All priors / frozen values are editable in NHL Settings.
* **Ledger:** "Log priced rows" snapshots model P and the market price before the game; "Grade from box scores" settles from the official NHL box score (scratched = VOID, integer-line push refunded). Calibration (Brier vs market, reliability bins, 50/80/90% interval coverage) excludes demo rows.

---

## 3b. NBA Player Props (Engine nba_v2)
* **Markets:** Points, Rebounds, Assists, 3-Pointers Made, PRA, Steals, Blocks (each a full Negative Binomial).
* **Data:** sportsdataverse ESPN player box scores (free GitHub releases; the SAME source the model was fitted on). The server downloads and aggregates them (`/api/nba/state`, cached), so the browser never parses the 17 MB prior-season file. Schedule and injuries come from ESPN's public site API (`/api/nba/schedule`, `/api/nba/injuries`).
* **Rates:** per-minute, shrunk current season -> last season -> guard/forward/center prior. Projected minutes blend the last five games with a shrunk season average. Every market has its own fitted constants (`src/data/nba_fit.ts`, generated by `npm run fit:nba`).
* **Early season / rookies / team changers:** three fitted groups. *veteran* (20+ games last season, same team) is REAL from game 0. *changer* (new team) leans on last season 0.5-1.0x as hard (fitted per market) with wider intervals (r x0.8). *new* (fewer than 20 games last season) leans on last season 0.1-0.5x as hard and becomes REAL after `minGamesNew` = 3 games this season (configurable). Held-out: new players were badly miscalibrated at 0-2 games (actual/expected 0.55) and on target from 3.
* **Distribution:** Negative Binomial whose dispersion r grows with projected minutes (`r = A*(min/30)^B`).
* **Adopted only if positive in every held-out season with a clustered-bootstrap interval above zero:** opponent allowed-per-game factor (shrunk, K=10) and teammate absence (lost rotation minutes of Out/Doubtful teammates, with a slope so a bench player gains more in % than a starter). Home court and back-to-back are not adopted.
* **Gate:** the same universal gate as the other sports: Out/Doubtful/unknown availability, estimated inputs or no price can never become STAB/FADE; EV is at the offered price; a one-sided price assumes a 7% hold.
* **Joints (drawer):** up to three legs from one game, Gaussian copula over the NB marginals with correlations MEASURED on real box scores (held-out marginals, game-clustered bootstrap). Same-player legs are clearly dependent (points-threes 0.72, points-rebounds 0.32, points-assists 0.23); teammates and opponents measured within a few hundredths of zero, so those legs price close to the product. PRA with one of its own parts is refused. Display only, never a bet signal.
* **Calibration:** the scoreboard shows Brier (model vs market) and 50/80/90% interval coverage per market once rows are graded.

## 4. Sample Import Block (NFL Week 6)

To test the NFL import parser and card engine, copy and paste this block into **Import Lines**:

```text
Jaxon Smith-Njigba, 6.5, -110, -120
AJ Barner, 2.5, -115, -115
Cooper Kupp, 2.5, -105, -125
Courtland Sutton, 3.5, +130, -175
Evan Engram, 2.5, -130, -105
Jaylen Waddle, 4.5, +100, -130
Marvin Mims Jr., 1.5, +110, -150
Rashid Shaheed, 1.5, -175, +130
Tory Horton, 0.5, -140, +105
Troy Franklin, 1.5, -135, +100
```


## Refreshing the NHL fit (every couple of weeks)
1. Download the latest MoneyPuck game-by-game skater files (prior season + current season) and unzip them.
2. See whether a refresh is even needed (writes nothing):
   `npm run fit:nhl:check -- 2025.csv 2026.csv`
3. Refit and write `src/data/nhl_fit.ts`:
   `npm run fit:nhl -- 2025.csv 2026.csv`
   It prints held-out log-likelihood and PIT coverage for three weighting schemes (all rows equal / automatic / real rows only), scored only on REAL current-season rows. The automatic rule down-weights the first-half/second-half split of last season as real rows accumulate (`pseudo_weight = max(0, 1 - real/pseudo)`), so the fit moves to real data on its own. Points shrink K and every other value can move; nothing is hand-set.
4. Restart the app. Fitted values show green "fitted from data" in NHL Settings; your own overrides still win.
