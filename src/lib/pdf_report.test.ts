import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mlbLedgerToReportRows,
  nbaLedgerToReportRows,
  nhlLedgerToReportRows,
  nflSnapshotsToReportRows,
  aggregateDailyPerformance
} from './pdf_report';
import { MlbLedgerRow } from '../types/mlb';
import { NbaLedgerRow } from '../types/nba';
import { NhlLedgerRow } from '../types/nhl';
import { NflPropSnapshot, NflActualRecord } from '../types/nfl';

test('pdf_report: mlbLedgerToReportRows correctly adapts MLB ledger rows', () => {
  const mlbRows: MlbLedgerRow[] = [
    {
      id: 101,
      date: '2026-05-10',
      gamePk: 712001,
      name: 'Aaron Judge',
      team: 'NYY',
      slot: 2,
      call: 'PLAY',
      over: '-135',
      under: '+105',
      hold: 1.05,
      dec: 1.74,
      modelP: 0.65,
      fairP: 0.57,
      blendedP: 0.62,
      edge: 7.5,
      quality: 'STRONG',
      hit: 1,
      result: 'HIT',
      void: false,
      line: 0.5,
      modelLean: 'OVER'
    },
    {
      id: 102,
      date: '2026-05-10',
      gamePk: 712001,
      name: 'Juan Soto',
      team: 'NYY',
      slot: 3,
      call: 'PASS',
      over: '-150',
      under: '+120',
      hold: 1.05,
      dec: 1.67,
      modelP: 0.58,
      fairP: 0.60,
      blendedP: 0.59,
      edge: -1.0,
      quality: 'NEUTRAL',
      hit: 0,
      result: 'MISS',
      void: false,
      line: 0.5
    },
    {
      id: 999,
      date: '2026-05-10',
      gamePk: 712001,
      name: 'Demo Player',
      team: 'NYY',
      slot: 1,
      call: 'PLAY',
      over: '-110',
      under: '-110',
      hold: 1.05,
      dec: 1.91,
      modelP: 0.55,
      fairP: 0.50,
      blendedP: 0.52,
      edge: 2.0,
      quality: 'FAIR',
      hit: 1,
      result: 'HIT',
      void: false,
      demo: true
    }
  ];

  const reportRows = mlbLedgerToReportRows(mlbRows);
  // Demo row should be filtered out
  assert.equal(reportRows.length, 2);

  const row1 = reportRows[0];
  assert.equal(row1.id, '101');
  assert.equal(row1.player, 'Aaron Judge');
  assert.equal(row1.sport, 'MLB');
  assert.equal(row1.market, 'HITS');
  assert.equal(row1.result, 'HIT');
  assert.equal(row1.qualifying, true);
  assert.ok(row1.units > 0);

  const row2 = reportRows[1];
  assert.equal(row2.result, 'MISS');
  assert.equal(row2.qualifying, false);
  assert.equal(row2.units, -1);
});

test('pdf_report: nbaLedgerToReportRows correctly adapts NBA rows and settles hits/misses', () => {
  const nbaRows: NbaLedgerRow[] = [
    {
      id: 'nba-1',
      date: '2026-03-01',
      gameId: '0022500123',
      market: 'pts',
      playerId: 203999,
      playerName: 'Nikola Jokic',
      team: 'DEN',
      opp: 'LAL',
      line: 26.5,
      modelMu: 29.2,
      r: 12.0,
      probOver: 0.64,
      overOdds: -110,
      underOdds: -110,
      pMarketOver: 0.50,
      tag: 'STAB',
      side: 'over',
      edge: 14.0,
      ev: 0.22,
      inputsSource: 'REAL',
      availability: 'ACTIVE',
      actual: 31,
      result: 'OVER'
    },
    {
      id: 'nba-2',
      date: '2026-03-01',
      gameId: '0022500123',
      market: 'ast',
      playerId: 203999,
      playerName: 'Nikola Jokic',
      team: 'DEN',
      opp: 'LAL',
      line: 9.5,
      modelMu: 7.8,
      r: 8.0,
      probOver: 0.35,
      overOdds: -110,
      underOdds: -110,
      pMarketOver: 0.50,
      tag: 'FADE',
      side: 'under',
      edge: 15.0,
      ev: 0.24,
      inputsSource: 'REAL',
      availability: 'ACTIVE',
      actual: 12,
      result: 'OVER' // Jokic got 12 ast, so under lost
    }
  ];

  const reportRows = nbaLedgerToReportRows(nbaRows);
  assert.equal(reportRows.length, 2);

  const r1 = reportRows[0];
  assert.equal(r1.result, 'HIT');
  assert.equal(r1.qualifying, true);
  assert.ok(r1.units > 0);

  const r2 = reportRows[1];
  assert.equal(r2.result, 'MISS');
  assert.equal(r2.qualifying, true);
  assert.equal(r2.units, -1);
});

test('pdf_report: aggregateDailyPerformance computes daily record, win rate, and ROI', () => {
  const rows = [
    {
      id: '1',
      date: '2026-05-10',
      player: 'Player A',
      team: 'BOS',
      sport: 'MLB' as const,
      market: 'HITS',
      line: 0.5,
      side: 'OVER' as const,
      odds: '-110',
      modelP: 0.60,
      result: 'HIT' as const,
      units: 0.91,
      qualifying: true
    },
    {
      id: '2',
      date: '2026-05-10',
      player: 'Player B',
      team: 'BOS',
      sport: 'MLB' as const,
      market: 'HITS',
      line: 0.5,
      side: 'OVER' as const,
      odds: '-110',
      modelP: 0.60,
      result: 'MISS' as const,
      units: -1.0,
      qualifying: true
    },
    {
      id: '3',
      date: '2026-05-10',
      player: 'Player C',
      team: 'BOS',
      sport: 'MLB' as const,
      market: 'HITS',
      line: 0.5,
      side: 'OVER' as const,
      odds: '-110',
      modelP: 0.60,
      result: 'HIT' as const,
      units: 0.91,
      qualifying: true
    },
    {
      id: '4',
      date: '2026-05-09',
      player: 'Player D',
      team: 'NYY',
      sport: 'MLB' as const,
      market: 'HITS',
      line: 0.5,
      side: 'OVER' as const,
      odds: '-110',
      modelP: 0.60,
      result: 'HIT' as const,
      units: 0.91,
      qualifying: true
    }
  ];

  const summaries = aggregateDailyPerformance(rows);
  assert.equal(summaries.length, 2);

  const day1 = summaries[0]; // 2026-05-10 (sorted newest first)
  assert.equal(day1.date, '2026-05-10');
  assert.equal(day1.totalPlays, 3);
  assert.equal(day1.wins, 2);
  assert.equal(day1.losses, 1);
  assert.equal(Math.round(day1.winRate), 67);
  assert.equal(Number(day1.netUnits.toFixed(2)), 0.82);

  const day2 = summaries[1]; // 2026-05-09
  assert.equal(day2.date, '2026-05-09');
  assert.equal(day2.totalPlays, 1);
  assert.equal(day2.wins, 1);
  assert.equal(day2.winRate, 100);
});
