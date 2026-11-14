# Gatekeep Sports Desk — Update 3 (apply on top of Update 2)

Replace/add the files from the attached project zip. Do not change pricing, gating or honesty logic.

## Files that changed or are new
- `src/data/nhl_fit.ts` (NEW, GENERATED from real MoneyPuck 2025+2026 files; do not hand-edit)
- `src/model/nhl_engine.ts` (adds `applyNhlFit`, `NHL_FITTED_KEYS`, status `'fitted from data'`; fitted values overlay the old priors in-bounds only)
- `src/model/nhl_engine.test.ts` (one new test)
- `src/components/nhl/NhlSettingsModal.tsx` (green "fitted from data" badge; intro text depends on `NHL_FITTED_KEYS`)
- `src/App.tsx` (NHL tuning now persists OVERRIDES ONLY under `gatekeep_nhl_tuning_v2`; the old v1 key stored every default and would pin the old priors over the fitted ones)
- `scripts/fit_nhl_moneypuck.py`, `scripts/nhl_opp_factor_test.py`, `scripts/make_nhl_fixture_SYNTHETIC.py`, `scripts/nfl_experiments/*` (NEW; not part of the app bundle)
- `CHANGELOG.md`, `README.md`

## Do this
1. Apply the files, run `tsc` and the tests (expect 80 passing). Report any type error exactly; fix only type errors, not behaviour.
2. Do NOT alter the numbers in `src/data/nhl_fit.ts`. Fitted values now in force: shots r 16, points r 36, shots shrink K 20 / prior K 10, points shrink K 30 / prior K 10, position priors F/D shots 1.896/1.299, points 0.592/0.35, shots-points rho 0.276. Everything else (opponent K, stale-table weight, sims) is unchanged.
3. In NHL Settings, those 11 values must show a green "fitted from data" badge and the intro line "11 of these were fitted on real game logs (green)…". Overriding a value must still work and Reset must return to the fitted value.
4. NFL is unchanged on purpose (v1.5). EPA, success rate, sack+hit rate, blitz rate, play-action, pace, teammate absence and recency were each tested out of sample and none helped consistently, so none is wired into pricing. Do not add them.
5. Honest limits to keep visible: 2026 has ~1 week of games, so part of the fit comes from a first-half/second-half split of 2025; re-run the script as 2026 fills in.
