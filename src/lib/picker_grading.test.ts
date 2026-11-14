import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freezePickerSnapshot,
  gradePickerWithCardRows,
  getPickerPerformance,
  normalizePlayerName,
  normalizeMarketKey,
  clearDailyPickerSnapshot,
  getDailyPickerSnapshot,
  gradeNbaPickerWithBoxLines,
  getPickerPlaysForInspection
} from './picker_grading';
import { PlayItem } from '../components/common/TodaysPlaysSection';
import { CardRow } from './card_core';

test('picker_grading: Normalization helpers', () => {
  assert.strictEqual(normalizePlayerName('Connor McDavid Jr.'), 'connor mcdavid');
  assert.strictEqual(normalizePlayerName('T.J. Watt'), 'tj watt');
  assert.strictEqual(normalizeMarketKey('sog'), 'shots');
  assert.strictEqual(normalizeMarketKey('Points'), 'points');
  assert.strictEqual(normalizeMarketKey('rec'), 'receptions');
  assert.strictEqual(normalizeMarketKey('tpm'), 'threes');
});

test('picker_grading: Freezing snapshot classifies buckets and protects historical immutability', () => {
  // Clear any mock
  const plays: PlayItem[] = [
    {
      id: 'p1',
      player: 'Connor McDavid',
      team: 'EDM',
      opp: 'CGY',
      market: 'shots',
      side: 'OVER',
      line: 3.5,
      odds: -115,
      prob: 0.62,
      edge: 7.5,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'p2',
      player: 'Leon Draisaitl',
      team: 'EDM',
      opp: 'CGY',
      market: 'points',
      side: 'OVER',
      line: 1.5,
      odds: +110,
      prob: 0.52,
      edge: 2.1,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'p3',
      player: 'Unpriced Rookie',
      team: 'EDM',
      opp: 'CGY',
      market: 'shots',
      side: 'OVER',
      line: 1.5,
      odds: null,
      prob: 0.60,
      edge: 0,
      hasOdds: false,
      hasMarket: false
    }
  ];

  const date = '2026-11-09';
  const snap1 = freezePickerSnapshot('nhl_test', date, plays, 0.58);
  assert.ok(snap1 !== null);
  assert.strictEqual(snap1.plays.length, 3);

  // McDavid has edge 7.5% & prob 62% -> both Edge and Safe
  const mcdavid = snap1.plays.find(p => p.player === 'Connor McDavid');
  assert.strictEqual(mcdavid?.isEdge, true);
  assert.strictEqual(mcdavid?.isSafe, true);
  assert.strictEqual(mcdavid?.isAvoid, false);

  // Unpriced rookie -> Avoid (no odds)
  const rookie = snap1.plays.find(p => p.player === 'Unpriced Rookie');
  assert.strictEqual(rookie?.isAvoid, true);
  assert.strictEqual(rookie?.isEdge, false);
  assert.strictEqual(rookie?.isSafe, false);

  // Re-freezing same date with different plays must return frozen snapshot without mutating
  const mutatedPlays: PlayItem[] = [];
  const snap2 = freezePickerSnapshot('nhl_test', date, mutatedPlays, 0.58);
  assert.strictEqual(snap2?.plays.length, 3, 'Historical membership must stay frozen');
});

test('picker_grading: Grading against card rows settles outcomes and computes hit rates', () => {
  const cardRows: CardRow[] = [
    {
      id: 'c1',
      date: '2026-11-09',
      capturedAt: Date.now(),
      gameId: 'g1',
      market: 'shots',
      playerId: 101,
      name: 'Connor McDavid',
      team: 'EDM',
      opp: 'CGY',
      mu: 4.2,
      r: 10,
      line: 3.5,
      lean: 'OVER',
      pOver: 0.62,
      pm: 22,
      avg: 3.8,
      inputs: 'REAL',
      avail: 'ACTIVE',
      result: 'HIT',
      actual: 5,
      minutes: 23,
      err: 0.8
    }
  ];

  gradePickerWithCardRows('nhl_test', cardRows);

  const perf = getPickerPerformance('nhl_test', 'today', '2026-11-09');
  assert.strictEqual(perf.edge.hits, 1);
  assert.strictEqual(perf.edge.decided, 1);
  assert.strictEqual(perf.edge.hitRate, 100);

  assert.strictEqual(perf.safe.hits, 1);
  assert.strictEqual(perf.safe.decided, 1);
  assert.strictEqual(perf.safe.hitRate, 100);
});

test('picker_grading: clearDailyPickerSnapshot removes frozen snapshot and allows re-freezing', () => {
  const plays: PlayItem[] = [
    {
      id: 'p_clear',
      player: 'Jalen Brunson',
      team: 'NYK',
      opp: 'MIL',
      market: 'pts',
      side: 'OVER',
      line: 26.5,
      odds: -110,
      prob: 0.65,
      edge: 12.0,
      hasOdds: true,
      hasMarket: true
    }
  ];

  freezePickerSnapshot('nba_test', '2026-11-10', plays, 0.58);
  assert.ok(getDailyPickerSnapshot('nba_test', '2026-11-10') !== null);

  clearDailyPickerSnapshot('nba_test', '2026-11-10');
  assert.strictEqual(getDailyPickerSnapshot('nba_test', '2026-11-10'), null);

  // Now we can re-freeze with corrected plays
  const correctedPlays: PlayItem[] = [
    {
      id: 'p_clear_corr',
      player: 'Jalen Brunson',
      team: 'NYK',
      opp: 'MIL',
      market: 'pts',
      side: 'OVER',
      line: 27.5,
      odds: -105,
      prob: 0.61,
      edge: 8.5,
      hasOdds: true,
      hasMarket: true
    }
  ];
  const snap = freezePickerSnapshot('nba_test', '2026-11-10', correctedPlays, 0.58);
  assert.strictEqual(snap?.plays[0].line, 27.5);
});

test('picker_grading: gradeNbaPickerWithBoxLines grades NBA plays directly from box lines', () => {

  const plays: PlayItem[] = [
    {
      id: 'nba_p1',
      player: 'Giannis Antetokounmpo',
      team: 'MIL',
      opp: 'NYK',
      market: 'pts',
      side: 'OVER',
      line: 31.5,
      odds: -115,
      prob: 0.60,
      edge: 6.5,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'nba_p2',
      player: 'Karl-Anthony Towns',
      team: 'NYK',
      opp: 'MIL',
      market: 'reb',
      side: 'UNDER',
      line: 12.5,
      odds: -110,
      prob: 0.59,
      edge: 6.0,
      hasOdds: true,
      hasMarket: true
    }
  ];

  freezePickerSnapshot('nba', '2026-11-10', plays, 0.58);

  const boxLines = [
    {
      playerId: 201,
      name: 'Giannis Antetokounmpo',
      team: 'MIL',
      opp: 'NYK',
      date: '2026-11-10',
      minutes: 35,
      dnp: false,
      actual: { pts: 34, reb: 12, ast: 7, tpm: 1 }
    },
    {
      playerId: 202,
      name: 'Karl-Anthony Towns',
      team: 'NYK',
      opp: 'MIL',
      date: '2026-11-10',
      minutes: 32,
      dnp: false,
      actual: { pts: 21, reb: 10, ast: 3, tpm: 2 }
    }
  ];

  const gradedCount = gradeNbaPickerWithBoxLines(boxLines);
  assert.ok(gradedCount >= 2);

  const inspected = getPickerPlaysForInspection('nba', 'today', '2026-11-10');
  const giannis = inspected.find((p: any) => p.player === 'Giannis Antetokounmpo');
  const kat = inspected.find((p: any) => p.player === 'Karl-Anthony Towns');

  assert.strictEqual(giannis?.result, 'HIT');
  assert.strictEqual(giannis?.actual, 34);

  assert.strictEqual(kat?.result, 'HIT'); // under 12.5 and actual was 10
  assert.strictEqual(kat?.actual, 10);
});

