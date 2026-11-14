# NFL feature experiments (Update 3)

Question: do free nflverse / FTN-charting team-context features make the v1.5 receptions model more accurate?

Method: every feature for week W uses only games before W of the same season (shrunk 4 pseudo-games toward the
league mean). Each is a multiplicative adjustment on the v1.5 walk-forward `mu`, fit with a ridge on one
season and scored on the NEXT season by negative-binomial log-likelihood per row.

Order to run (data in /home/claude/data, see header of each file):
1. `dump_nfl_rows.ts`        baseline walk-forward predictions (7,964 WR/TE player-games, 2024-2026 wk 3+)
2. `nfl_features_exp.py`     team-game aggregates from play-by-play + FTN charting (EPA, success, sack+hit rate, blitz rate, play-action, pace)
3. `nfl_features_test.py`    out-of-sample test of each feature
4. `nfl_absence_test.py`     teammate-absence (target redistribution)
5. `nfl_recency_test.py`     trailing 3-game receptions / targets

Result (see CHANGELOG Update 4 for the numbers):
- team EPA / success / pressure / blitz / pace / play-action: nothing (|delta| < 0.002, sign flips)
- teammate absence: first test (snap-count based) failed because inactive players have no snap rows; rebuilt from the pre-game
  injury report (`nfl_absence_form_v2.py`, `verify_absence_ts.ts`) -> ADOPTED in engine v1.6, positive in every season
- recent form: positive 2024-25, negative 2026 -> NOT adopted; re-test around week 12
