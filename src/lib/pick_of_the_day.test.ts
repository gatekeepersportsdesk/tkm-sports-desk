import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getNflPickOfTheDay,
  getMlbPickOfTheDay,
  getOverallBestPick,
  PickOfTheDay
} from './pick_of_the_day';
import { NflPropSnapshot } from '../types/nfl';
import { DEFAULT_BETTABLE } from './bettable';

test('pick_of_the_day: NFL returns null if no bettable snapshots', () => {
  const snaps: NflPropSnapshot[] = [
    {
      id: '1', season: 2026, week: 1, book: 'draftkings', kind: 'open', timestamp: '2026-11-03',
      player: 'Player A', pos: 'WR', team: 'KC', gameKey: 'KC-LAC', line: 4.5,
      overOdds: '-110', underOdds: '-110', mu: 4.0, muStructural: 4.0, muAdapted: 4.0,
      dropbacks: 35, shrunkTprr: 0.2, shrunkCatchRate: 0.65, seasonAvg: 4.0, alpha: 0.25,
      p_over: 0.45, p_under: 0.55, fair_over: 0.5, fair_under: 0.5, lean: 'UNDER',
      edge: 0.05, cardStatus: 'PASS', cardReason: 'Edge insufficient',
      oddsOffered: -110, ev: 0.05, hasMarket: true, inputsSource: 'REAL', availability: 'ACTIVE'
    }
  ];
  const pick = getNflPickOfTheDay(snaps, DEFAULT_BETTABLE);
  assert.equal(pick, null);
});

test('pick_of_the_day: NFL returns highest EV bettable row', () => {
  const snaps: NflPropSnapshot[] = [
    {
      id: '1', season: 2026, week: 1, book: 'draftkings', kind: 'open', timestamp: '2026-11-03',
      player: 'Player Moderate EV', pos: 'WR', team: 'KC', gameKey: 'KC-LAC', line: 4.5,
      overOdds: '-110', underOdds: '-110', mu: 6.0, muStructural: 6.0, muAdapted: 6.0,
      dropbacks: 38, shrunkTprr: 0.28, shrunkCatchRate: 0.70, seasonAvg: 5.5, alpha: 0.25,
      p_over: 0.62, p_under: 0.38, fair_over: 0.5, fair_under: 0.5, lean: 'OVER',
      edge: 0.12, cardStatus: 'BET', cardReason: 'Meets criteria',
      oddsOffered: -110, ev: 0.08, hasMarket: true, inputsSource: 'REAL', availability: 'ACTIVE'
    },
    {
      id: '2', season: 2026, week: 1, book: 'draftkings', kind: 'open', timestamp: '2026-11-03',
      player: 'Player Highest EV', pos: 'WR', team: 'CIN', gameKey: 'CIN-BAL', line: 5.5,
      overOdds: '+110', underOdds: '-130', mu: 7.2, muStructural: 7.0, muAdapted: 7.2,
      dropbacks: 40, shrunkTprr: 0.32, shrunkCatchRate: 0.72, seasonAvg: 6.5, alpha: 0.25,
      p_over: 0.60, p_under: 0.40, fair_over: 0.45, fair_under: 0.55, lean: 'OVER',
      edge: 0.15, cardStatus: 'BET', cardReason: 'Meets criteria',
      oddsOffered: 110, ev: 0.16, hasMarket: true, inputsSource: 'REAL', availability: 'ACTIVE'
    }
  ];

  const pick = getNflPickOfTheDay(snaps, DEFAULT_BETTABLE);
  assert.ok(pick !== null);
  // Must pick Highest EV (+16% EV) even though model probability was 60% vs 62%
  assert.equal(pick.player, 'Player Highest EV');
  assert.equal(pick.ev, 0.16);
  assert.equal(pick.line, 5.5);
  assert.equal(pick.side, 'over');
  assert.equal(pick.odds, 110);
});

test('pick_of_the_day: NFL excludes negative or zero EV rows', () => {
  const snaps: NflPropSnapshot[] = [
    {
      id: '1', season: 2026, week: 1, book: 'draftkings', kind: 'open', timestamp: '2026-11-03',
      player: 'Player Zero EV', pos: 'WR', team: 'KC', gameKey: 'KC-LAC', line: 4.5,
      overOdds: '-110', underOdds: '-110', mu: 4.0, muStructural: 4.0, muAdapted: 4.0,
      dropbacks: 35, shrunkTprr: 0.2, shrunkCatchRate: 0.65, seasonAvg: 4.0, alpha: 0.25,
      p_over: 0.50, p_under: 0.50, fair_over: 0.5, fair_under: 0.5, lean: 'OVER',
      edge: 0.0, cardStatus: 'BET', cardReason: '',
      oddsOffered: -110, ev: 0.0, hasMarket: true, inputsSource: 'REAL', availability: 'ACTIVE'
    }
  ];
  assert.equal(getNflPickOfTheDay(snaps, DEFAULT_BETTABLE), null);
});

test('pick_of_the_day: MLB returns null when no plays have PLAY status', () => {
  const rows = [
    {
      batter: { id: 1, name: 'Pass Batter', team: 'NYY', slot: 5, isHome: true, hand: 'R', seasonBa: 0.250, oppSp: 'Cole', oppHand: 'R', confirmed: true, park: 1.0, gamePk: 100 },
      hit: { calP: 0.58, inputsReal: true, platoon: 'RvR' },
      gate: { call: 'PASS' as const, reasons: ['SLOT'], calP: 0.58, modelP: 0.58, fair: 0.55, edge: 3.0, quality: 'REAL', ev: 0.04, units: 1 },
      game: { gamePk: 100, away: 'BOS', home: 'NYY', awaySp: { name: 'Sale', hand: 'L', kPct: 0.28 }, homeSp: { name: 'Cole', hand: 'R', kPct: 0.30 }, park: 1.0, status: 'Final', confirmed: true },
      price: { over: '-140', under: '+110', line: 0.5 }
    }
  ];
  assert.equal(getMlbPickOfTheDay(rows as any), null);
});

test('pick_of_the_day: MLB picks top EV batter when PLAY', () => {
  const rows = [
    {
      batter: { id: 1, name: 'Batter A', team: 'NYY', slot: 2, isHome: true, hand: 'R', seasonBa: 0.300, oppSp: 'P1', oppHand: 'R', confirmed: true, park: 1.0, gamePk: 100 },
      hit: { calP: 0.72, inputsReal: true, platoon: 'RvR' },
      gate: { call: 'PLAY' as const, reasons: [], calP: 0.72, modelP: 0.72, fair: 0.65, edge: 7.0, quality: 'REAL', ev: 0.09, units: 1 },
      game: { gamePk: 100, away: 'BOS', home: 'NYY', awaySp: { name: 'P1', hand: 'L', kPct: 0.20 }, homeSp: { name: 'P2', hand: 'R', kPct: 0.25 }, park: 1.0, status: 'Pre-game', confirmed: true },
      price: { over: '-160', under: '+130', line: 0.5 }
    },
    {
      batter: { id: 2, name: 'Batter B Highest EV', team: 'LAD', slot: 1, isHome: false, hand: 'L', seasonBa: 0.320, oppSp: 'P3', oppHand: 'R', confirmed: true, park: 1.0, gamePk: 101 },
      hit: { calP: 0.75, inputsReal: true, platoon: 'LvR' },
      gate: { call: 'PLAY' as const, reasons: [], calP: 0.75, modelP: 0.75, fair: 0.66, edge: 9.0, quality: 'REAL', ev: 0.14, units: 1 },
      game: { gamePk: 101, away: 'LAD', home: 'SF', awaySp: { name: 'P4', hand: 'L', kPct: 0.22 }, homeSp: { name: 'P3', hand: 'R', kPct: 0.20 }, park: 1.0, status: 'Pre-game', confirmed: true },
      price: { over: '-150', under: '+120', line: 0.5 }
    }
  ];
  const pick = getMlbPickOfTheDay(rows as any);
  assert.ok(pick !== null);
  assert.equal(pick.player, 'Batter B Highest EV');
  assert.equal(pick.ev, 0.14);
  assert.equal(pick.line, 0.5);
});

test('pick_of_the_day: getOverallBestPick returns highest EV across all sports', () => {
  const pNfl: PickOfTheDay = {
    sport: 'nfl', sportLabel: 'NFL Receptions', player: 'CeeDee Lamb', team: 'DAL', opp: 'PHI',
    market: 'rec', marketLabel: 'Receptions', side: 'over', line: 6.5, odds: -110, modelProb: 0.62, edge: 9.5, ev: 0.11
  };
  const pNba: PickOfTheDay = {
    sport: 'nba', sportLabel: 'NBA Props', player: 'Stephen Curry', team: 'GSW', opp: 'LAL',
    market: 'tpm', marketLabel: '3-Pointers Made', side: 'over', line: 3.5, odds: +120, modelProb: 0.58, edge: 10.2, ev: 0.18
  };
  const pNhl: PickOfTheDay = {
    sport: 'nhl', sportLabel: 'NHL Shots+Points', player: 'Nathan MacKinnon', team: 'COL', opp: 'CBJ',
    market: 'sog', marketLabel: 'Shots on Goal', side: 'over', line: 3.5, odds: -115, modelProb: 0.56, edge: 6.0, ev: 0.06
  };

  const best = getOverallBestPick([pNfl, pNba, pNhl, null]);
  assert.ok(best !== null);
  assert.equal(best.sport, 'nba');
  assert.equal(best.player, 'Stephen Curry');
  assert.equal(best.ev, 0.18);
});

import { calculateEdgePp, calculateEv } from './odds';
import { recordOddsImport, hasOddsImport, clearCachedPickOfTheDay } from './pick_of_the_day';

test('pick_of_the_day: Kartye-type row (+110 and 57% model) produces edge ~+9.4pp, never 1000pp', () => {
  // SOG Under 1.5 at +110 with model win ~57%
  // implied_prob = 100 / (110 + 100) = 0.47619
  // edge_pp = (0.57 - 0.47619) * 100 = 9.381 percentage points
  const edgePp = calculateEdgePp(0.57, '+110');
  assert.ok(edgePp !== null);
  assert.ok(edgePp >= 8.5 && edgePp <= 10.5, `Expected ~9.4pp but got ${edgePp}`);
  assert.ok(edgePp < 50, 'Edge must never be inflated');

  const evVal = calculateEv(0.57, '+110');
  assert.ok(evVal !== null && evVal > 0);
  // Payout at +110 is 2.10 * 0.57 - 1 = 0.197
  assert.ok(Math.abs(evVal - 0.197) < 0.01);
});

test('pick_of_the_day: hard sanity check rejects impossible edge > 50pp', () => {
  // If model is 95% and price is -110 (52.4%), edge is ~42.6pp (in bounds)
  const validEdge = calculateEdgePp(0.95, -110);
  assert.ok(validEdge !== null && validEdge < 50);

  // If impossible calculation yields > 50pp or corrupted input
  const impossibleEdge = calculateEdgePp(0.95, '+300'); // (0.95 - 0.25) * 100 = 70pp -> exceeds 50
  assert.equal(impossibleEdge, null, 'Edges exceeding 50pp on standard props must be rejected as invalid');
});

test('pick_of_the_day: strict odds gate: cold load with no import returns null, import unlocks POTD', () => {
  const slateDate = '2026-11-10';
  clearCachedPickOfTheDay('nfl', slateDate);

  const snaps: NflPropSnapshot[] = [
    {
      id: 'kartye-test', season: 2026, week: 1, book: 'draftkings', kind: 'open', timestamp: slateDate,
      player: 'Tye Kartye', pos: 'WR', team: 'SEA', gameKey: 'SEA-SF', line: 1.5,
      overOdds: '-130', underOdds: '+110', mu: 1.2, muStructural: 1.2, muAdapted: 1.2,
      dropbacks: 30, shrunkTprr: 0.15, shrunkCatchRate: 0.65, seasonAvg: 1.2, alpha: 0.25,
      p_over: 0.43, p_under: 0.57, fair_over: 0.52, fair_under: 0.48, lean: 'UNDER',
      edge: 0.09, cardStatus: 'BET', cardReason: 'Meets criteria',
      oddsOffered: 110, ev: 0.12, hasMarket: true, inputsSource: 'REAL', availability: 'ACTIVE'
    }
  ];

  // 1. Cold load before import -> returns null
  assert.equal(hasOddsImport('nfl', slateDate), false);
  const coldPick = getNflPickOfTheDay(snaps, DEFAULT_BETTABLE, slateDate);
  assert.equal(coldPick, null, 'Must return null before odds are imported');

  // 2. User imports odds at tImport
  const tImport = Date.now();
  recordOddsImport('nfl', slateDate, 1, tImport);
  assert.equal(hasOddsImport('nfl', slateDate), true);

  // 3. Recompute POTD post-import
  const postImportPick = getNflPickOfTheDay(snaps, DEFAULT_BETTABLE, slateDate);
  assert.ok(postImportPick !== null);
  assert.equal(postImportPick.player, 'Tye Kartye');
  assert.equal(postImportPick.side, 'under');
  assert.equal(postImportPick.odds, 110);
  assert.ok(postImportPick.capturedAt !== undefined && postImportPick.capturedAt >= tImport);
  assert.ok(postImportPick.edge >= 8.5 && postImportPick.edge <= 10.5, `Edge should be ~9.4pp, got ${postImportPick.edge}`);
});

