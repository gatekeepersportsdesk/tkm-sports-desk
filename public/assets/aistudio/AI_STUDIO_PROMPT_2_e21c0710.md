# Update prompt #2 for Google AI Studio (apply on top of what you already have)

Attach the new `gatekeep-sports-desk-fixed.zip`, then paste everything below the line.

---

This is a follow-up update to the Gatekeep Sports Desk you already updated. The attached zip is the source of truth for ONLY the files listed here. Do not touch anything else, and keep the changes you made last time to `scripts/backtest_nfl.ts` (relative import paths) and `src/model/nfl_engine.test.ts` (the `assert.ok(devigged)` null check).

## Bugs being fixed
1. The app keeps jumping back to the NFL tab. Causes: the selected sport/tab was never persisted, and the screenshot scanner let the AI's guess of the sport override my selection and then switched the whole app to it.
2. The screenshot modal fabricated sample lines with fake odds whenever a scan failed (and when I clicked a sport pill). That must never happen. A failed scan must show an error and add nothing.

## Files
**Add:** `src/components/common/ErrorBoundary.tsx`, `src/lib/ocr_clean.ts`, `src/model/sampler.ts`, `src/model/sampler.test.ts`, `src/model/ocr_clean.test.ts`, `scripts/estimate_nfl_corr.ts`.

**Replace with the attached version:** `src/App.tsx`, `src/components/Header.tsx`, `src/components/common/ScreenshotUploadModal.tsx`, `src/components/nhl/NhlPlayerDrawer.tsx`, `src/components/nhl/NhlSettingsModal.tsx`, `src/model/nhl_engine.ts`, `src/model/nhl_engine.test.ts`, `CHANGELOG.md`, `README.md`.

**`server.ts`: do NOT replace the file.** Keep yours (including the Gemini model name and key handling) and change only the OCR prompt text inside `/api/ocr-lines` to match the attached one: the NHL line says "shots on goal / points", `propType` also allows `"points"`, each line gets `"prop": "receptions" | "hits" | "shots" | "points"`, and a new rule "Only report lines that are actually visible. Never guess or fill in a player, line or price you cannot read."

## Rules (unchanged, plus these)
- Never substitute placeholder, sample or default data for a failed or empty result anywhere. No fake lines, no pre-filled odds.
- The sport I selected is never overridden by the scanner's guess. A mismatch is only a warning banner.
- The model's marginal distributions stay exactly as they are. The sampler only adds dependence between legs.
- Correlation values: NFL teammate/opponent values are measured on real data; the NHL shots-to-points correlation (0.35) is a prior and must stay labelled as a prior.

## Verify, then report
1. `npx tsc --noEmit` has 0 errors. `npx tsx --test src/model/*.test.ts` passes (79 tests expected: 65 before plus the sampler, OCR-cleaning and tuning tests). Do not edit a test to make it pass.
2. In the running app, check and tell me the result of each:
   - Select NHL, switch to the Settings tab, reload the page: does it come back on NHL / Settings?
   - Upload a screenshot while on NHL: does the target stay NHL even if the scan says another sport?
   - Force a failed scan (e.g. block the request or use a non-slip image): does it show an error and add zero lines?
   - Open an NHL player's drawer: is the "Shots + points combo" panel there with a joint vs independent probability?
   - NHL Settings: are all 14 model parameters listed with a status label, and does Reset work?
3. Say plainly anything you could not check.

Do not summarise the code back to me; report only the results above and any file you changed beyond the list.
