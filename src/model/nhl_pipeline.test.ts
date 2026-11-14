import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nhlSeasonFor, selectTopSkaters, parseNhlTeamPayload, parseNhlTeamTable, parseNhlFactors,
  parseEspnInjuries, applyInjuries, parseNhlBoxscore, gradeNhlLedger, toiMinutes, normalizeNhlTeam
} from '../lib/nhl_data.ts';
import { collectLedgerRows, mergeLedger, inferNhlMarket } from '../lib/nhl_board.ts';
import { projectNhlSkater, NHL_CONFIG } from './nhl_engine.ts';
import { NhlLedgerRow, nhlOddsKey } from '../types/nhl.ts';
import { buildEstimatedNhlSkater } from '../data/nhl_seed.ts';

// Fixtures follow the documented api-web.nhle.com shapes (roster / club-stats / game-log / boxscore).
const roster = {
  forwards: [
    { id: 11, firstName: { default: 'Alex' }, lastName: { default: 'Center' } },
    { id: 12, firstName: { default: 'Bo' }, lastName: { default: 'Winger' } }
  ],
  defensemen: [{ id: 13, firstName: { default: 'Cy' }, lastName: { default: 'Blue' } }],
  goalies: [{ id: 99, firstName: { default: 'Gus' }, lastName: { default: 'Goalie' } }]
};
const stats = {
  skaters: [
    { playerId: 11, gamesPlayed: 6, shots: 21, goals: 3, assists: 4, points: 7, avgTimeOnIcePerGame: 1230 },
    { playerId: 13, gamesPlayed: 6, shots: 9, goals: 0, assists: 2, points: 2, avgTimeOnIcePerGame: 1500 }
  ]
};
const prior = {
  skaters: [
    { playerId: 11, gamesPlayed: 80, shots: 280, goals: 30, assists: 40, points: 70, avgTimeOnIcePerGame: 1200 },
    { playerId: 12, gamesPlayed: 70, shots: 150, goals: 12, assists: 20, points: 32, avgTimeOnIcePerGame: 960 }
  ]
};
const logs = {
  '11': { gameLog: [
    { gameDate: '2026-10-20', shots: 5, goals: 1, assists: 1, points: 2, toi: '20:41' },
    { gameDate: '2026-10-18', shots: 2, goals: 0, assists: 0, points: 0, toi: '19:50' }
  ] }
};

test('NHL data: season rolls over in September', () => {
  assert.deepEqual(nhlSeasonFor('2026-10-23'), { season: '20262027', prev: '20252026' });
  assert.deepEqual(nhlSeasonFor('2027-03-01'), { season: '20262027', prev: '20252026' });
  assert.equal(nhlSeasonFor('2026-09-15').season, '20262027');
});

test('NHL data: toi parsing handles seconds and mm:ss', () => {
  assert.ok(Math.abs(toiMinutes(1230) - 20.5) < 1e-9);
  assert.ok(Math.abs(toiMinutes('20:30') - 20.5) < 1e-9);
  assert.equal(toiMinutes(undefined), 0);
});

test('NHL data: top skaters by ice time, goalies excluded, falls back to last season', () => {
  const ids = selectTopSkaters({ roster, stats, prior }, 3);
  assert.deepEqual(ids, [13, 11, 12]);
  assert.ok(!ids.includes(99));
});

test('NHL data: team payload -> skater snapshots with real logs and priors', () => {
  const sk = parseNhlTeamPayload({ team: 'EDM', roster, stats, prior, logs });
  assert.equal(sk.length, 3);
  const c = sk.find(s => s.playerId === 11)!;
  assert.equal(c.name, 'Alex Center');
  assert.equal(c.gp, 6); assert.equal(c.shots, 21); assert.equal(c.points, 7);
  assert.equal(c.priorGp, 80); assert.equal(c.priorShots, 280);
  assert.deepEqual(c.recentShots, [5, 2]);
  assert.deepEqual(c.recentPoints, [2, 0]);
  assert.equal(c.inputsSource, 'REAL'); // 6 + 80 games
  const d = sk.find(s => s.playerId === 13)!;
  assert.equal(d.pos, 'D');
  assert.equal(d.inputsSource, 'ESTIMATED'); // 6 games, no prior season
  assert.deepEqual(d.recentShots, []); // no log => empty, never fabricated
});

test('NHL data: no feed at all -> everything ESTIMATED, no points', () => {
  const sk = parseNhlTeamPayload({ team: 'EDM', roster });
  assert.ok(sk.every(s => s.inputsSource === 'ESTIMATED' && s.points === null));
});

test('NHL data: team table joins standings + shots-against by full name', () => {
  const standings = { standings: [
    { teamAbbrev: { default: 'EDM' }, teamName: { default: 'Edmonton Oilers' }, gamesPlayed: 40, goalAgainst: 120 },
    { teamAbbrev: { default: 'MTL' }, teamName: { default: 'Montréal Canadiens' }, gamesPlayed: 40, goalAgainst: 160 }
  ] };
  const summary = { data: [
    { teamFullName: 'Edmonton Oilers', shotsAgainstPerGame: 26 },
    { teamFullName: 'Montréal Canadiens', shotsAgainstPerGame: 32 }
  ] };
  const t = parseNhlTeamTable(standings, summary);
  assert.equal(t.EDM.goalsAgainstPerGame, 3);
  assert.equal(t.MTL.shotsAgainstPerGame, 32);
  const f = parseNhlFactors(standings, summary);
  assert.ok(f.MTL.sog > 1 && f.EDM.sog < 1);
  assert.ok(f.MTL.pts > 1 && f.EDM.pts < 1);
});

test('NHL data: injuries map to statuses; feed failure -> UNKNOWN, listed -> status, unlisted -> ACTIVE', () => {
  const inj = parseEspnInjuries({ injuries: [{ displayName: 'Oilers', injuries: [
    { status: 'Out', athlete: { displayName: 'Alex Center' }, shortComment: 'upper body' },
    { status: 'Day-To-Day', athlete: { displayName: 'Cy Blue' } }
  ] }] });
  assert.equal(inj.length, 2);
  const sk = parseNhlTeamPayload({ team: 'EDM', roster, stats, prior, logs });
  const withInj = applyInjuries(sk, inj);
  assert.equal(withInj.find(s => s.playerId === 11)!.availability, 'OUT');
  assert.equal(withInj.find(s => s.playerId === 13)!.availability, 'QUESTIONABLE');
  assert.equal(withInj.find(s => s.playerId === 12)!.availability, 'ACTIVE');
  assert.ok(applyInjuries(sk, null).every(s => s.availability === 'UNKNOWN'));
});

const box = (state: string, extra: any = {}) => ({
  gameState: state, ...extra,
  playerByGameStats: {
    awayTeam: { forwards: [{ playerId: 11, sog: 4, goals: 1, assists: 1, toi: '20:00' }, { playerId: 12, sog: 0, goals: 0, assists: 0, toi: '00:00' }], defense: [] },
    homeTeam: { forwards: [], defense: [{ playerId: 13, sog: 2, goals: 0, assists: 0, points: 0, toi: '22:10' }] }
  }
});

const row = (o: Partial<NhlLedgerRow>): NhlLedgerRow => ({
  id: 'x', date: '2026-10-23', gameId: 1, market: 'sog', playerId: 11, playerName: 'Alex Center', team: 'EDM', opp: 'TOR',
  line: 3.5, modelMu: 3.2, r: 15.13, probOver: 0.45, overOdds: -110, underOdds: -110, pMarketOver: 0.5, tag: 'PASS', side: null,
  edge: 0, ev: null, inputsSource: 'REAL', availability: 'ACTIVE', actual: null, result: null, ...o
});

test('NHL grading: real box score, over / under / push / DNP void / pending / postponed', () => {
  const finalBox = parseNhlBoxscore(box('OFF'));
  assert.equal(finalBox.final, true);
  assert.equal(finalBox.players['11'].points, 2); // goals + assists when points missing
  const boxes = { '1': finalBox, '2': parseNhlBoxscore(box('LIVE')), '3': parseNhlBoxscore(box('FUT', { gameScheduleState: 'PPD' })) };
  const rows = [
    row({ id: 'a', line: 3.5 }),                                   // 4 sog > 3.5 OVER
    row({ id: 'b', line: 4.5 }),                                   // UNDER
    row({ id: 'c', line: 4 }),                                     // PUSH
    row({ id: 'd', market: 'pts', line: 1.5 }),                    // 2 pts OVER
    row({ id: 'e', playerId: 12 }),                                // 0:00 TOI -> VOID
    row({ id: 'f', playerId: 777 }),                               // absent -> VOID
    row({ id: 'g', gameId: 2 }),                                   // game still live -> pending
    row({ id: 'h', gameId: 3 }),                                   // postponed -> VOID
    row({ id: 'i', gameId: 4 }),                                   // no box -> pending
    row({ id: 'z', demo: true })                                   // demo untouched
  ];
  const out = gradeNhlLedger(rows, boxes);
  const by = Object.fromEntries(out.rows.map(r => [r.id, r]));
  assert.equal(by.a.result, 'OVER'); assert.equal(by.a.actual, 4);
  assert.equal(by.b.result, 'UNDER');
  assert.equal(by.c.result, 'PUSH');
  assert.equal(by.d.result, 'OVER'); assert.equal(by.d.actual, 2);
  assert.equal(by.e.result, 'VOID'); assert.equal(by.f.result, 'VOID'); assert.equal(by.h.result, 'VOID');
  assert.equal(by.g.result, null); assert.equal(by.i.result, null);
  assert.equal(by.z.result, null);
  assert.equal(out.graded, 4); assert.equal(out.voided, 3); assert.equal(out.pending, 2);
  // idempotent: re-grading changes nothing
  assert.deepEqual(gradeNhlLedger(out.rows, boxes).rows, out.rows);
});

test('NHL board: collects priced rows only; graded rows are never overwritten', () => {
  const p = parseNhlTeamPayload({ team: 'EDM', roster, stats, prior, logs }).map(s => ({ ...s, availability: 'ACTIVE' as const }));
  const proj = p.map(s => ({ ...projectNhlSkater(s, 'TOR'), gameId: 7 }));
  const settings = { edgeThreshold: 5, maxJuice: -200, showStabsOnly: false };
  const odds = {
    [nhlOddsKey('sog', 11, 2.5)]: { over: -110, under: -110 },
    [nhlOddsKey('pts', 11, 0.5)]: { over: -150 },
    [nhlOddsKey('sog', 13, 1.5)]: {} // empty entry ignored
  };
  const rows = collectLedgerRows(proj, odds, settings, '2026-10-23');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.gameId === 7 && r.result === null));
  assert.equal(rows[0].id, '2026-10-23:sog:11:2.5');
  const graded = { ...rows[0], result: 'OVER' as const, actual: 4 };
  const merged = mergeLedger([graded], [{ ...rows[0], edge: 99 }, rows[1]]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(r => r.id === graded.id)!.edge, graded.edge);
});

test('NHL: screenshot players not on a roster are ESTIMATED and can never qualify', () => {
  const est = buildEstimatedNhlSkater('Some Rookie', 'EDM');
  const proj = projectNhlSkater(est, 'TOR');
  assert.equal(proj.pts, null);
  assert.equal(proj.inputsSource, 'ESTIMATED');
  // rate comes from the position prior, not from any book line
  assert.ok(Math.abs(proj.sog.mu0 - NHL_CONFIG.sog.posPrior.F) < 1e-9);
});

test('NHL: market inferred from OCR text; team codes normalised', () => {
  assert.equal(inferNhlMarket('Player Points', 1.5), 'pts');
  assert.equal(inferNhlMarket('Shots on Goal', 2.5), 'sog');
  assert.equal(inferNhlMarket(undefined, 0.5), 'pts');
  assert.equal(inferNhlMarket(undefined, 2.5), 'sog');
  assert.equal(normalizeNhlTeam('sj'), 'SJS');
});
