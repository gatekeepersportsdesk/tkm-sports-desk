import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseNbaBox, buildNbaState, positionGroup, parseEspnNbaScoreboard, applyNbaInjuries, parseEspnNbaInjuries, gradeNbaLedger, boxLinesFor } from './nba_data.ts';
import { buildNbaTeamFactors } from '../model/nba_engine.ts';
import type { NbaLedgerRow } from '../types/nba.ts';

const rd = (n: string) => fs.readFileSync(new URL(`../model/fixtures/${n}`, import.meta.url), 'utf8');
const cur = parseNbaBox(rd('nba_box_cur.csv'));
const pri = parseNbaBox(rd('nba_box_prior.csv'));
const st = buildNbaState(cur, pri);

test('positions group to G/F/C', () => {
  assert.equal(positionGroup('PG'), 'G'); assert.equal(positionGroup('SF'), 'F'); assert.equal(positionGroup('C'), 'C'); assert.equal(positionGroup(''), null);
});

test('state: totals match raw rows, DNP never counts as a game', () => {
  assert.ok(st.players.length > 200);
  const p = st.players.find(x => x.gp >= 4)!;
  const mine = cur.filter(r => r.playerId === p.playerId && !r.dnp);
  assert.equal(p.gp, mine.length);
  assert.ok(Math.abs(p.cum.pts - mine.reduce((s, r) => s + r.counts.pts, 0)) < 1e-9);
  assert.ok(Math.abs(p.cumMin - mine.reduce((s, r) => s + r.minutes, 0)) < 1e-9);
  assert.ok(p.recentMinutes.length <= 5 && p.recentMinutes.every(m => m > 0));
  for (const q of st.players) assert.ok(q.gp >= 0 && q.cumMin >= 0 && ['G', 'F', 'C'].includes(q.pos));
});

test('state: PRA/steals/blocks counted, prevTeam from last season, rookies have none', () => {
  const p = st.players.find(x => x.gp >= 3 && x.priorGp > 40)!;
  const mine = cur.filter(r => r.playerId === p.playerId && !r.dnp);
  assert.ok(Math.abs(p.cum.pra - (p.cum.pts + p.cum.reb + p.cum.ast)) < 1e-9);
  assert.ok(Math.abs(p.cum.stl - mine.reduce((s, r) => s + r.counts.stl, 0)) < 1e-9);
  assert.ok(Math.abs(p.cum.blk - mine.reduce((s, r) => s + r.counts.blk, 0)) < 1e-9);
  const last = pri.filter(r => r.playerId === p.playerId).sort((a, b) => (a.date + a.gameId < b.date + b.gameId ? -1 : 1)).pop()!;
  assert.equal(p.prevTeam, last.team);
  assert.ok(st.players.some(x => x.priorGp === 0 && x.prevTeam === undefined), 'players with no prior games have no prevTeam');
  assert.ok(st.players.some(x => x.prevTeam && x.prevTeam !== x.team), 'there are team changers in the fixture');
});

test('state: prior season used, team games pair up with allowed = opponent production', () => {
  assert.ok(st.players.some(p => p.priorGp > 40));
  assert.equal(st.teamGames.length, st.gamesPlayed * 2);
  const f = buildNbaTeamFactors(st.teamGames);
  assert.ok(Object.keys(f).length >= 28);
  for (const t of Object.values(f)) assert.ok(t.factor.pts > 0.7 && t.factor.pts < 1.3);
});

test('scoreboard + injuries parse the documented ESPN shape; null feed => UNKNOWN', () => {
  const g = parseEspnNbaScoreboard({ events: [{ id: '401', date: '2026-10-26T23:00Z', status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } },
    competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: 'BOS' } }, { homeAway: 'away', team: { abbreviation: 'NY' } }] }] },
    { id: '402', status: { type: { name: 'STATUS_POSTPONED' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: 'LAL' } }, { homeAway: 'away', team: { abbreviation: 'GS' } }] }] }]});
  assert.equal(g.length, 2); assert.equal(g[0].label, 'NY @ BOS'); assert.equal(g[1].postponed, true);
  const inj = parseEspnNbaInjuries({ injuries: [{ injuries: [{ athlete: { displayName: p0().name }, status: 'Out', shortComment: 'knee' }] }] });
  const a = applyNbaInjuries(st.players.slice(0, 3), inj);
  assert.equal(a[0].availability, 'OUT'); assert.equal(a[1].availability, 'ACTIVE');
  assert.ok(applyNbaInjuries(st.players.slice(0, 2), null).every(p => p.availability === 'UNKNOWN'));
});
function p0() { return st.players[0]; }

test('grading: actual from box, DNP is VOID, stale missing game is VOID, recent missing is pending, integer push', () => {
  const day = cur.find(r => !r.dnp)!;
  const dnp = cur.find(r => r.dnp)!;
  const lines = boxLinesFor(cur, [day.date, dnp.date]);
  const base = (o: Partial<NbaLedgerRow>): NbaLedgerRow => ({ id: 'x', date: day.date, gameId: day.gameId, market: 'pts', playerId: day.playerId, playerName: day.name, team: day.team, opp: day.opp,
    line: 10.5, modelMu: 10, r: 6, probOver: 0.5, overOdds: -110, underOdds: -110, pMarketOver: 0.5, tag: 'PASS', side: null, edge: 0, ev: null, inputsSource: 'REAL', availability: 'ACTIVE', actual: null, result: null, ...o });
  const rows = [base({}), base({ line: day.counts.pts }), base({ id: 'd', date: dnp.date, gameId: dnp.gameId, playerId: dnp.playerId }),
    base({ id: 's', gameId: 'nope', date: '2026-01-01' }), base({ id: 'p', gameId: 'nope', date: '2026-10-25' })];
  const r = gradeNbaLedger(rows, lines, '2026-10-26');
  assert.equal(r.rows[0].result, day.counts.pts > 10.5 ? 'OVER' : 'UNDER');
  assert.equal(r.rows[1].result, 'PUSH');
  assert.equal(r.rows[2].result, 'VOID');
  assert.equal(r.rows[3].result, 'VOID');
  assert.equal(r.rows[4].result, null);
  assert.deepEqual([r.graded, r.pending, r.voided], [2, 1, 2]);
});

import { withOddsLines, buildNbaSlate, inferNbaMarket, evalNbaRow, collectNbaLedgerRows, mergeNbaLedger } from './nba_board.ts';

test('slate: projections, availability gate, unknown feed cannot qualify, absence lifts teammates', () => {
  const [a, b] = ['BOS', 'NY'].map(t => st.players.filter(p => p.team === t).sort((x, y) => y.cumMin - x.cumMin));
  assert.ok(a.length > 5 && b.length > 5, 'fixture has both teams');
  const game = [{ gameId: 'G1', date: '2026-10-26', home: 'BOS', away: 'NY', state: 'pre', completed: false, postponed: false, label: 'NY @ BOS' }];
  const none = buildNbaSlate(st, game, []);
  const star = none.find(p => p.name === a[0].name)!;
  assert.equal(star.availability, 'ACTIVE'); assert.equal(star.gameId, 'G1'); assert.equal(star.opp, 'NY');
  const settings = { edgeThreshold: 5, maxJuice: -200, showStabsOnly: false };
  // an obviously mispriced two-way line on an ACTIVE REAL player may qualify; the same row with the player OUT never can
  const mp = star.markets.pts; const line = mp.lines[0];
  const entry = { over: 400, under: -600 };
  const ok = evalNbaRow(star, 'pts', line, entry, settings);
  const outFeed = buildNbaSlate(st, game, [{ name: a[0].name, status: 'OUT', detail: 'knee' }]);
  const out = outFeed.find(p => p.name === a[0].name)!;
  assert.equal(evalNbaRow(out, 'pts', line, entry, settings).decision.tag, 'PASS');
  const unk = buildNbaSlate(st, game, null);
  assert.ok(unk.every(p => p.availability === 'UNKNOWN'));
  assert.ok(unk.every(p => evalNbaRow(p, 'pts', p.markets.pts.lines[0], entry, settings).decision.tag === 'PASS'));
  // teammate lift when the star sits
  const mate = none.find(p => p.team === 'BOS' && p.name === a[1].name)!;
  const mateOut = outFeed.find(p => p.name === a[1].name)!;
  if (st.avgMinByName[a[0].name] >= 20) assert.ok(mateOut.markets.pts.mu > mate.markets.pts.mu);
  assert.ok(ok.decision.tag === 'PASS' || ok.decision.tag === 'STAB' || ok.decision.tag === 'FADE');
});

test('slate: rookies are grouped, flagged ESTIMATED until minGamesNew, and a DNP-only player is not listed', () => {
  const game = [{ gameId: 'G1', date: '2026-10-26', home: 'DEN', away: 'LAL', state: 'pre', completed: false, postponed: false, label: '' }];
  const slate = buildNbaSlate(st, game, []);
  assert.ok(slate.every(p => p.gp + p.priorGp > 0));
  for (const p of slate) {
    if (p.group === 'new' && p.gp < 3) assert.equal(p.inputsSource, 'ESTIMATED');
    if (p.group !== 'new') assert.equal(p.inputsSource, 'REAL');
  }
  const chg = buildNbaSlate(st, [{ ...game[0], home: st.players.find(x => x.prevTeam && x.prevTeam !== x.team && x.priorGp >= 20)!.team, away: 'LAL' }], []);
  assert.ok(chg.some(p => p.group === 'changer'));
});

test('ledger: collect only priced rows, merge never overwrites graded rows, OCR market inference', () => {
  const game = [{ gameId: 'G1', date: '2026-10-26', home: 'BOS', away: 'NY', state: 'pre', completed: false, postponed: false, label: '' }];
  const slate = buildNbaSlate(st, game, []);
  const p = slate[0]; const line = p.markets.reb.lines[0];
  const settings = { edgeThreshold: 5, maxJuice: -200, showStabsOnly: false };
  const rows = collectNbaLedgerRows(slate, { [`reb|${p.playerId}|${line}`]: { over: -110, under: -110 } }, settings, '2026-10-26');
  assert.equal(rows.length, 1); assert.equal(rows[0].market, 'reb'); assert.equal(rows[0].result, null);
  const graded = [{ ...rows[0], result: 'OVER' as const, actual: 9 }];
  assert.equal(mergeNbaLedger(graded, rows)[0].result, 'OVER');
  assert.equal(inferNbaMarket('Player Points'), 'pts'); assert.equal(inferNbaMarket('Rebounds'), 'reb');
  assert.equal(inferNbaMarket('Assists'), 'ast'); assert.equal(inferNbaMarket('3-Pointers Made'), 'tpm');
  assert.equal(inferNbaMarket('Pts+Reb+Ast'), 'pra'); assert.equal(inferNbaMarket('Points + Rebounds + Assists'), 'pra'); assert.equal(inferNbaMarket('PRA'), 'pra');
  assert.equal(inferNbaMarket('Pts+Reb'), null); assert.equal(inferNbaMarket('Points + Assists'), null);
  assert.equal(inferNbaMarket('Steals'), 'stl'); assert.equal(inferNbaMarket('Blocks'), 'blk'); assert.equal(inferNbaMarket('Turnovers'), null);
  assert.equal(inferNbaMarket('threes'), 'tpm'); assert.equal(inferNbaMarket('points'), 'pts');
});

test('an off-ladder posted line is added and priced, not dropped', () => {
  const game = [{ gameId: 'G1', date: '2026-10-26', home: 'BOS', away: 'NY', state: 'pre', completed: false, postponed: false, label: '' }];
  const slate = buildNbaSlate(st, game, []);
  const p = slate[0];
  const odd = p.markets.pts.lines.includes(7.5) ? 6.5 : 7.5;
  const out = withOddsLines(slate, { [`pts|${p.playerId}|${odd}`]: { over: -110, under: -110 } });
  const q = out.find(x => x.playerId === p.playerId)!;
  assert.ok(q.markets.pts.lines.includes(odd) && q.markets.pts.probs[odd].p_over > 0);
  assert.deepEqual(q.markets.reb.lines, p.markets.reb.lines);
});
