# Gatekeep Sports Desk — Update 3 (apply on top of Update 2)

Replace/add the files from the attached project zip. Do not change any pricing, gating or honesty logic.

## Files that changed or are new
- `src/data/nhl_fit.ts` (NEW, generated; currently `NHL_FIT = null`)
- `src/model/nhl_engine.ts` (adds `applyNhlFit`, `NHL_FITTED_KEYS`, status `'fitted from data'`)
- `src/model/nhl_engine.test.ts` (one new test)
- `src/components/nhl/NhlSettingsModal.tsx` (green "fitted from data" badge; intro text depends on `NHL_FITTED_KEYS`)
- `scripts/fit_nhl_moneypuck.py`, `scripts/make_nhl_fixture_SYNTHETIC.py`, `scripts/nfl_experiments/*` (NEW, not part of the app bundle)
- `CHANGELOG.md`, `README.md`

## Do this
1. Apply the files, run `tsc` and the tests (expect 80 passing). Report any type error exactly; fix only type errors, not behaviour.
2. Do NOT invent NHL fitted values. `NHL_FIT` stays `null` until `scripts/fit_nhl_moneypuck.py` is run on real MoneyPuck files. Every NHL parameter must still show its prior label in Settings.
3. If a real MoneyPuck file is available in the project, run: `python3 -I scripts/fit_nhl_moneypuck.py --out src/data/nhl_fit.ts <files>` and paste the full console output back (held-out LL vs defaults, PIT coverage, the 5v5+PP split result, measured rho). If the script stops on a missing column, paste the column list it prints; do not guess a mapping.
4. NFL is unchanged on purpose (v1.5). Tested EPA, success rate, sack+hit rate, blitz rate, play-action, pace, teammate absence and recency out of sample — none improved the receptions likelihood consistently, so none is wired in. Do not add them to pricing.
5. Confirm in the UI: NHL Settings shows the amber/blue prior badges and the line "None of these were fitted on NHL data yet…"; nothing else about NFL/MLB/NHL screens should have changed.
