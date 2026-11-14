import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlayerCardForm, getEdgeColorClass, isFormFightingLean } from './player_card_form';

test('Player Card Form: Computes L5 and L10 hit rates and averages correctly', () => {
  // Logs ordered newest first: [32, 28, 25, 22, 30, 20, 24, 27, 29, 31]
  const logs = [32, 28, 25, 22, 30, 20, 24, 27, 29, 31];
  const form = computePlayerCardForm(logs, 24.5, 'OVER', {
    oppFactor: 1.08,
    edge: 6.2,
    seasonMinAvg: 32.0,
    recentMinutes: [36, 35, 34, 35, 36]
  });

  // L5 is [32, 28, 25, 22, 30] -> > 24.5 is 4 of 5 (80%)
  assert.strictEqual(form.l5.games, 5);
  assert.strictEqual(form.l5.hits, 4);
  assert.strictEqual(form.l5.hitRatePct, 80);
  assert.strictEqual(form.l5.avgStat, 27.4);

  // L10 has 10 games: 32, 28, 25, 30, 27, 29, 31 are > 24.5 -> 7 of 10 (70%)
  assert.strictEqual(form.l10.games, 10);
  assert.strictEqual(form.l10.hits, 7);
  assert.strictEqual(form.l10.hitRatePct, 70);

  // Opponent tier
  assert.strictEqual(form.oppTier, 'bottom10_soft');
  assert.strictEqual(form.oppBadge, 'DEF B10 (Soft)');

  // Minutes trend
  assert.ok(form.minutesTrend);
  assert.strictEqual(form.minutesTrend?.direction, 'up');

  // Why this lean
  assert.ok(form.whyThisLean.includes('High edge'));
  assert.ok(form.whyThisLean.includes('L10 hit rate 70%'));
  assert.ok(form.whyThisLean.includes('soft opponent'));
});

test('Player Card Form: Edge color styling rules', () => {
  // Green > 5%, Yellow 2-5%, Gray < 2%
  assert.ok(getEdgeColorClass(5.5, true).includes('text-emerald-400'));
  assert.ok(getEdgeColorClass(3.2, true).includes('text-amber-300'));
  assert.ok(getEdgeColorClass(1.5, true).includes('text-[#8b97ac]'));
  assert.ok(getEdgeColorClass(null, false).includes('text-[#556277]'));
});

test('Player Card Form: isFormFightingLean correctly flags opposing form', () => {
  // Case 1: Lean is UNDER 2.5 SOG, but recent shots are high [4, 3, 4, 3, 5] -> avg 3.8 > 2.5 and 0/5 hits
  const underFightingForm = computePlayerCardForm([4, 3, 4, 3, 5], 2.5, 'UNDER');
  assert.strictEqual(isFormFightingLean(underFightingForm, 'UNDER', 2.5), true);

  // Case 2: Lean is UNDER 2.5 SOG, and recent shots are low [1, 2, 1, 2, 2] -> avg 1.6 < 2.5 and 5/5 hits (100%)
  const underGoodForm = computePlayerCardForm([1, 2, 1, 2, 2], 2.5, 'UNDER');
  assert.strictEqual(isFormFightingLean(underGoodForm, 'UNDER', 2.5), false);

  // Case 3: Lean is OVER 24.5 pts, but recent pts are low [18, 20, 22, 19, 21] -> avg 20.0 < 24.5 and 0/5 hits
  const overFightingForm = computePlayerCardForm([18, 20, 22, 19, 21], 24.5, 'OVER');
  assert.strictEqual(isFormFightingLean(overFightingForm, 'OVER', 24.5), true);

  // Case 4: Insufficient games / empty logs -> does not flag warning
  const emptyForm = computePlayerCardForm([], 2.5, 'OVER');
  assert.strictEqual(isFormFightingLean(emptyForm, 'OVER', 2.5), false);
  assert.strictEqual(isFormFightingLean(undefined, 'OVER', 2.5), false);
});

