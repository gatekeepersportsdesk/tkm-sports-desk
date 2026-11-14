import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreMlbHit,
  scoreMlbCore,
  devigMlb,
  gateMlbRow,
  MLB_DEFAULT_TUNE,
  MLB_PARK_FACTORS
} from './mlb_engine.ts';

const baseBatter = (o = {}) => ({
  slot: 2,
  isHome: false,
  hand: "",
  seasonBa: 0.255,
  seasonPa: 600,
  xba: 0.255,
  xbaPa: 600,
  recentBa: 0.255,
  recentAb: 40,
  bbPct: 0.085,
  recentReal: true,
  ...o
});

const basePitcher = (o = {}) => ({
  hand: "",
  kPct: 22,
  kBf: 600,
  recentIp: 5.2,
  ...o
});

test('MLB: Reference Top-3 hitter scores locked anchor (0.673)', () => {
  const res = scoreMlbHit(baseBatter(), basePitcher(), 1.0);
  assert.ok(Math.abs(res.calP - MLB_DEFAULT_TUNE.baseTop3HitRate) < 0.002, `Scored ${res.calP}`);
});

test('MLB: Starter K% suppression moves probability > 6 points between K14 and K36', () => {
  const pLowK = scoreMlbHit(baseBatter(), basePitcher({ kPct: 14 }), 1.0).calP;
  const pHighK = scoreMlbHit(baseBatter(), basePitcher({ kPct: 36 }), 1.0).calP;
  const gap = pLowK - pHighK;
  assert.ok(gap > 0.06 && gap < 0.14, `Gap was ${gap.toFixed(4)}`);
});

test('MLB: Coors Field (COL) beats Seattle (SEA) by > 4 points', () => {
  const pCol = scoreMlbHit(baseBatter(), basePitcher(), MLB_PARK_FACTORS.COL).calP;
  const pSea = scoreMlbHit(baseBatter(), basePitcher(), MLB_PARK_FACTORS.SEA).calP;
  const gap = pCol - pSea;
  assert.ok(gap > 0.04, `Gap was ${gap.toFixed(4)}`);
});

test('MLB: Devigging invariant to hold on two-way lines', () => {
  const devig1 = devigMlb('-150', '+120', 1.05);
  const devig2 = devigMlb('-150', '+120', 1.15);
  assert.ok(devig1 && devig2);
  assert.ok(Math.abs(devig1.fair - devig2.fair) < 1e-6);
});

test('MLB: Gate logic rejects non-confirmed, bad slot, or excessive juice', () => {
  const hit = scoreMlbHit(baseBatter({ hand: 'L' }), basePitcher({ hand: 'R' }), 1.0);
  assert.equal(hit.inputsReal, true);

  // Slot 4 -> PASS (slot only)
  const slot4 = gateMlbRow({ confirmed: true, slot: 4, over: '-150', hit });
  assert.equal(slot4.call, 'PASS');
  assert.ok(slot4.slotOnly);

  // Unconfirmed lineup -> PASS
  const unconf = gateMlbRow({ confirmed: false, slot: 2, over: '-150', hit });
  assert.equal(unconf.call, 'PASS');
  assert.ok(unconf.reasons.includes('NOT_CONFIRMED'));

  // Juice past -220 -> PASS
  const heavyJuice = gateMlbRow({ confirmed: true, slot: 2, over: '-250', hit });
  assert.equal(heavyJuice.call, 'PASS');
  assert.ok(heavyJuice.reasons.includes('JUICE'));
});
