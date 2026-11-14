import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseNbaBox, buildNbaState, boxLinesFor } from './nba_data.ts';
import { buildNbaSlate } from './nba_board.ts';
import { captureDailyCard, mergePredictions, gradePredictions, reasonFor, summarizePredictions, filterPredictions, edgeKeys, isHeadline, predictionId } from './nba_card.ts';
import { NBA_MARKETS, NbaPrediction } from '../types/nba.ts';

const rd = (n: string) => fs.readFileSync(new URL(`../model/fixtures/${n}`, import.meta.url), 'utf8');
const cur = parseNbaBox(rd('nba_box_cur.csv'));
const st = buildNbaState(cur, parseNbaBox(rd('nba_box_prior.csv')));
const game = (state = 'pre') => [{ gameId: 'G1', date: '2026-10-26', home: 'BOS', away: 'NY', state, completed: state === 'post', postponed: false, label: 'NY @ BOS' }];
const slate = buildNbaSlate(st, game(), []);

test('capture: every priced player-market, pre-game only, idempotent, never rewrites', () => {
  const rows = captureDailyCard(slate, game(), st.players, new Set(), '2026-10-26', 1);
  const playing = slate.filter(p => p.availability !== 'OUT');
  assert.equal(rows.length, playing.length * NBA_MARKETS.length);
  const r = rows[0];
  assert.ok(r.id === predictionId('2026-10-26', r.market, r.playerId) && r.result === null && r.line % 1 === 0.5);
  assert.ok(r.lean === (r.pOver >= 0.5 ? 'OVER' : 'UNDER') && r.pm > 0 && r.mu > 0);
  // second call adds nothing; merge never overwrites
  const again = captureDailyCard(slate, game(), st.players, new Set(rows.map(x => x.id)), '2026-10-26', 2);
  assert.equal(again.length, 0);
  const graded = [{ ...rows[0], result: 'HIT' as const }, ...rows.slice(1)];
  assert.equal(mergePredictions(graded, rows)[0].result, 'HIT');
  assert.equal(mergePredictions(graded, rows).length, rows.length);
  // games already started / finished are not captured
  assert.equal(captureDailyCard(slate, game('in'), st.players, new Set(), '2026-10-26').length, 0);
  assert.equal(captureDailyCard(slate, game('post'), st.players, new Set(), '2026-10-26').length, 0);
});

test('capture: OUT players are skipped; unknown availability is kept but flagged and not headline', () => {
  const star = slate[0];
  const out = buildNbaSlate(st, game(), [{ name: star.name, status: 'OUT', detail: 'knee' }]);
  const rows = captureDailyCard(out, game(), st.players, new Set(), '2026-10-26');
  assert.ok(!rows.some(r => r.playerId === star.playerId));
  const unk = captureDailyCard(buildNbaSlate(st, game(), null), game(), st.players, new Set(), '2026-10-26');
  assert.ok(unk.length > 0 && unk.every(r => r.avail === 'UNKNOWN' && !isHeadline(r)));
});

test('grade: HIT/MISS follow the lean, push, DNP is VOID, absent game stale = VOID else pending, error and reason filled', () => {
  const base = (o: Partial<NbaPrediction>): NbaPrediction => ({ id: 'a', date: '2026-10-20', capturedAt: 0, gameId: 'g', market: 'pts', playerId: 1, name: 'A', team: 'X', opp: 'Y', mu: 25.1, r: 8, line: 25.5, lean: 'OVER', pOver: 0.5, pm: 31, rate: 0.8, oppF: 1, absF: 1, lvl: 1, avg: 24, inputs: 'REAL', avail: 'ACTIVE', result: null, actual: null, minutes: null, err: null, ...o });
  const box = (id: number, actual: number, minutes: number, dnp = false) => ({ gameId: 'g', date: '2026-10-20', playerId: id, minutes, dnp, actual: { pts: actual, reb: 0, ast: 0, tpm: 0, pra: actual, stl: 0, blk: 0 } });
  const rows = [base({ id: '1' }), base({ id: '2', playerId: 2, lean: 'UNDER' }), base({ id: '3', playerId: 3, line: 31 }), base({ id: '4', playerId: 4 }), base({ id: '5', gameId: 'zz', date: '2026-10-01' }), base({ id: '6', gameId: 'zz', date: '2026-10-25' }), base({ id: '7', playerId: 7, lean: 'UNDER', line: 21.5, mu: 21.5, pm: 31 })];
  const lines = [box(1, 31, 36), box(2, 31, 36), box(3, 31, 30), box(4, 0, 0, true), box(7, 28, 34)];
  const g = gradePredictions(rows, lines, '2026-10-26', 7, 5);
  const by = Object.fromEntries(g.rows.map(r => [r.id, r]));
  assert.equal(by['1'].result, 'HIT'); assert.equal(by['1'].actual, 31); assert.ok(Math.abs(by['1'].err! - 5.9) < 1e-9); assert.match(by['1'].reason!, /^WON \(OVER\): Model 25.1 vs 25.5. Actual 31 in 36m — cleared\.$/);
  assert.equal(by['2'].result, 'MISS'); assert.match(by['2'].reason!, /^LOST \(UNDER\)/);
  assert.equal(by['3'].result, 'PUSH');
  assert.equal(by['4'].result, 'VOID'); assert.equal(by['4'].err, null);
  assert.equal(by['5'].result, 'VOID'); assert.equal(by['6'].result, null);
  assert.match(by['7'].reason!, /minutes higher than projected \(34 vs 31\)|per-minute production higher/);
  assert.deepEqual([g.graded, g.pending, g.voided], [4, 1, 2]);
  // already graded rows are untouched
  assert.equal(gradePredictions(g.rows, [], '2026-10-26').rows[0], g.rows[0]);
});

test('reason: a loss that is just variance says so; minutes explanation only when the direction fits', () => {
  const m = { mu: 20, r: 10, line: 20.5, lean: 'OVER' as const, pm: 30 };
  assert.match(reasonFor(m, 18, 30, 'MISS'), /within normal variance/);
  assert.match(reasonFor(m, 15, 30, 'MISS'), /per-minute production lower/);
  assert.match(reasonFor(m, 8, 18, 'MISS'), /minutes lower than projected \(18 vs 30\)/);
  assert.doesNotMatch(reasonFor(m, 15, 38, 'MISS'), /minutes higher/); // more minutes but a worse outcome: not blamed on minutes
});

test('summary: headline excludes estimated/unknown, VOID excluded, MAE vs naive and coverage, win rate and over/under split', () => {
  const mk = (id: string, o: Partial<NbaPrediction>): NbaPrediction => ({ id, date: 'd', capturedAt: 0, gameId: 'g', market: 'pts', playerId: 1, name: 'A', team: 'X', opp: 'Y', mu: 20, r: 10, line: 20.5, lean: 'OVER', pOver: 0.5, pm: 30, rate: 0.6, oppF: 1, absF: 1, lvl: 1, avg: 18, inputs: 'REAL', avail: 'ACTIVE', result: 'HIT', actual: 25, minutes: 30, err: 5, ...o });
  const rows = [mk('1', {}), mk('2', { result: 'MISS', actual: 15, err: -5, lean: 'OVER' }), mk('3', { lean: 'UNDER', actual: 10, err: -10, result: 'HIT' }),
    mk('4', { inputs: 'ESTIMATED' }), mk('5', { avail: 'UNKNOWN' }), mk('6', { result: 'VOID', actual: null, err: null }), mk('7', { result: null, actual: null, err: null })];
  const s = summarizePredictions(rows);
  assert.equal(s.logged, 5); assert.equal(s.decided, 3); assert.equal(s.hits, 2); assert.ok(Math.abs(s.winRate! - 2 / 3) < 1e-12);
  assert.deepEqual(s.over, { n: 2, hits: 1 }); assert.deepEqual(s.under, { n: 1, hits: 1 });
  const p = s.byMarket.find(x => x.market === 'pts')!;
  assert.equal(p.n, 3); assert.ok(Math.abs(p.mae! - (5 + 5 + 10) / 3) < 1e-12); assert.ok(Math.abs(p.maeNaive! - (7 + 3 + 8) / 3) < 1e-12);
  assert.ok(Math.abs(s.alwaysUnder! - 2 / 3) < 1e-12); // actuals 25, 15, 10 against 20.5: two of three finished under
  assert.equal(summarizePredictions(rows, true).logged, 7);
  const edge = edgeKeys([{ date: 'd', market: 'pts', playerId: 1, tag: 'STAB' } as any, { date: 'd', market: 'reb', playerId: 1, tag: 'PASS' } as any]);
  assert.equal(filterPredictions(rows, 'edge', 'all', new Set(['1']), false).length, 1);
  assert.deepEqual([filterPredictions(rows, 'won', 'all', edge, false).length, filterPredictions(rows, 'missed', 'all', edge, false).length, filterPredictions(rows, 'pending', 'all', edge, false).length], [2, 1, 1]);
});

test('end to end on real box lines: capture from a real slate then grade against that day\'s real box scores', () => {
  const day = cur.filter(r => !r.dnp).map(r => r.date).sort()[cur.filter(r => !r.dnp).length - 1];
  const gid = cur.find(r => r.date === day && !r.dnp)!.gameId;
  const gm = cur.filter(r => r.gameId === gid && !r.dnp); const [home, away] = [gm.find(r => r.home)!.team, gm.find(r => !r.home)!.team];
  const g = [{ gameId: gid, date: day, home, away, state: 'pre', completed: false, postponed: false, label: '' }];
  const sl = buildNbaSlate(st, g, []);
  const rows = captureDailyCard(sl, g, st.players, new Set(), day);
  const res = gradePredictions(rows, boxLinesFor(cur, [day]), '2026-10-27');
  assert.ok(res.graded > 100);
  const s = summarizePredictions(res.rows, true);
  assert.ok(s.decided > 100 && s.byMarket.every(m => m.n === 0 || (m.mae! >= 0 && m.coverage.every(c => c !== null))));
});
