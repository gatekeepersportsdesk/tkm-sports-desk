import test from 'node:test';
import assert from 'node:assert/strict';
import { ParlayLeg, ParlayRules, DEFAULT_RULES, legIssue, ticketConflict, priceTicket, suggestTickets, gradePaperTickets, summarizePaper, paperTicketsFor, legFromCard, legsFromPricedLedger, PaperTicket } from './parlay_core.ts';
import { CardRow, summarizeCard } from './card_core.ts';

const leg = (o: Partial<ParlayLeg> = {}): ParlayLeg => ({
  id: 'a', src: 'card', sport: 'nba', date: '2026-10-29', gameId: 'G1', playerId: 1, playerName: 'A', team: 'BOS', opp: 'NY', market: 'pts', side: 'OVER',
  line: 24.5, mu: 25, r: 8, pLean: 0.55, tag: 'NONE', inputs: 'REAL', availability: 'ACTIVE', overOdds: null, underOdds: null, teamKey: 'G1|BOS', ...o
});

test('cross-game ticket: jointP is the product of the leg probabilities; fair price and EV only with a book price', () => {
  const legs = [leg({ id: '1', gameId: 'G1', pLean: 0.6 }), leg({ id: '2', gameId: 'G2', playerId: 2, pLean: 0.7 }), leg({ id: '3', gameId: 'G3', playerId: 3, pLean: 0.65 })];
  const t = priceTicket(legs, 'cross');
  assert.ok(Math.abs(t.jointP - 0.6 * 0.7 * 0.65) < 1e-12 && Math.abs(t.indepP - t.jointP) < 1e-12 && !t.correlated);
  assert.equal(t.ev, null); assert.ok(t.warnings.some(w => /No book parlay price/.test(w)));
  assert.ok(t.fairAmerican! > 200 && t.fairAmerican! < 300); // 27.3% -> about +266
  const b = priceTicket(legs, 'cross', { bookAmerican: 300 });
  assert.ok(Math.abs(b.ev! - (0.273 * 4 - 1)) < 1e-9);
  assert.ok(Math.abs(priceTicket(legs, 'cross', { bookAmerican: -110 }).ev! - (0.273 / (100 / 110 / 1) * 0 + 0.273 * (1 + 100 / 110) - 1)) < 1e-9);
});

test('NBA same-player points + threes: correlated joint beats the product (measured rho > 0); teammates stay near the product', () => {
  const pts = leg({ id: 'p', market: 'pts', mu: 25, r: 9, line: 24.5, pLean: 0.5 });
  const tpm = leg({ id: 't', market: 'tpm', mu: 3, r: 6, line: 2.5, pLean: 0.5, teamKey: 'G1|BOS' });
  const same = priceTicket([pts, tpm], 'sgp', { sims: 40000 });
  assert.ok(same.correlated && same.jointP > same.indepP + 0.02, `${same.jointP} vs ${same.indepP}`);
  const mate = priceTicket([pts, { ...tpm, id: 'm', playerId: 2 }], 'sgp', { sims: 40000 });
  assert.ok(Math.abs(mate.jointP - mate.indepP) < 0.015, `${mate.jointP} vs ${mate.indepP}`);
});

test('NHL: same-skater shots + points linked, teammate points slightly linked, opponents independent', () => {
  const sog = leg({ id: 's', sport: 'nhl', market: 'sog', mu: 3, r: 10, line: 2.5, team: 'BOS', teamKey: 'G1|BOS' });
  const pts = leg({ id: 'p', sport: 'nhl', market: 'pts', mu: 0.8, r: 4, line: 0.5, team: 'BOS', teamKey: 'G1|BOS' });
  const t = priceTicket([sog, pts], 'sgp', { sims: 40000 });
  assert.ok(t.correlated && t.jointP > t.indepP);
  const opp = priceTicket([sog, { ...pts, id: 'o', playerId: 2, team: 'NYR', teamKey: 'G1|NYR' }], 'sgp', { sims: 40000 });
  assert.ok(Math.abs(opp.jointP - opp.indepP) < 0.01);
});

test('MLB same-game goes through the existing simulation; different games are a product', () => {
  const a = leg({ id: 'a', sport: 'mlb', market: 'hit', r: null, mu: 1, line: 0.5, pLean: 0.7, playerId: 1, team: 'NYY', gameId: '9' });
  const b = leg({ id: 'b', sport: 'mlb', market: 'hit', r: null, mu: 1, line: 0.5, pLean: 0.7, playerId: 2, team: 'NYY', gameId: '9' });
  const t = priceTicket([a, b], 'sgp', { sims: 20000 });
  assert.ok(t.correlated && t.jointP > 0.4 && t.jointP < 0.6);
  const c = priceTicket([a, { ...b, gameId: '10' }], 'cross');
  assert.ok(Math.abs(c.jointP - 0.49) < 1e-12);
});

test('eligibility: estimated / unknown / out legs never enter safe or edge; edge needs a qualified priced single; safe needs two-way price within juice', () => {
  const r: ParlayRules = DEFAULT_RULES;
  assert.match(legIssue(leg({ inputs: 'ESTIMATED', pLean: 0.7 }), 'safe', r)!, /estimated/);
  assert.match(legIssue(leg({ availability: 'UNKNOWN', pLean: 0.7 }), 'edge', r)!, /availability/);
  assert.match(legIssue(leg({ availability: 'OUT' }), 'cross', r)!, /availability/);
  assert.match(legIssue(leg({ pLean: 0.7 }), 'edge', r)!, /qualified/);
  assert.equal(legIssue(leg({ pLean: 0.7, tag: 'EDGE', overOdds: -110, underOdds: -110 }), 'edge', r), null);
  assert.match(legIssue(leg({ pLean: 0.5 }), 'safe', r)!, /below 58%/);
  assert.equal(legIssue(leg({ pLean: 0.6 }), 'safe', r), null); // model-only: no price to judge
  assert.match(legIssue(leg({ pLean: 0.6, overOdds: -110, underOdds: null }), 'safe', r)!, /one-sided/);
  assert.match(legIssue(leg({ pLean: 0.6, overOdds: -150, underOdds: 125 }), 'safe', r)!, /juice/);
  assert.match(legIssue(leg({ pLean: 0.6, market: 'blk' }), 'safe', { ...r, markets: ['pts'] })!, /filtered/);
});

test('ticket rules: sgp one game, cross distinct games, PRA with its parts refused, duplicate player-stat refused, cross-sport refused', () => {
  const a = leg({ id: '1', gameId: 'G1' }), b = leg({ id: '2', gameId: 'G2', playerId: 2 });
  assert.match(ticketConflict([a, b], 'sgp')!, /one game/);
  assert.match(ticketConflict([a, { ...b, gameId: 'G1' }], 'cross')!, /different game/);
  assert.equal(ticketConflict([a, b], 'cross'), null);
  assert.match(ticketConflict([leg({ market: 'pra' }), leg({ id: 'x', market: 'pts' })], 'sgp')!, /PRA/);
  assert.match(ticketConflict([a, { ...a, id: 'dup' }], 'sgp')!, /same player and stat/);
  assert.match(ticketConflict([a, { ...b, sport: 'nhl' }], 'cross')!, /Cross-sport/);
  const three = [leg({ id: '1', playerId: 1 }), leg({ id: '2', playerId: 2 }), leg({ id: '3', playerId: 3 })];
  assert.match(ticketConflict(three, 'safe')!, /more than two legs/i);
});

test('suggestions: deterministic, best first, only eligible legs, disjoint on request; empty when the pool is too small', () => {
  const pool = Array.from({ length: 8 }, (_, i) => leg({ id: `l${i}`, gameId: `G${i}`, playerId: i, pLean: 0.7 - i * 0.02, teamKey: `G${i}|BOS`, team: 'BOS' }));
  pool.push(leg({ id: 'est', gameId: 'G9', playerId: 99, pLean: 0.95, inputs: 'ESTIMATED' }));
  const s1 = suggestTickets(pool, 'cross', 3, DEFAULT_RULES, { top: 3, disjoint: true });
  const s2 = suggestTickets(pool, 'cross', 3, DEFAULT_RULES, { top: 3, disjoint: true });
  assert.deepEqual(s1.map(t => t.id), s2.map(t => t.id));
  assert.equal(s1.length, 2); // 8 eligible legs, 3 per ticket, disjoint
  assert.ok(s1[0].jointP >= s1[1].jointP && s1.every(t => !t.legs.some(l => l.id === 'est')));
  assert.ok(Math.abs(s1[0].jointP - 0.7 * 0.68 * 0.66) < 1e-9);
  assert.deepEqual(suggestTickets(pool.slice(0, 2), 'cross', 3, DEFAULT_RULES), []);
});

test('paper tickets: fixed daily menu, ids idempotent, graded MISS/HIT/VOID with void legs excluded, calibration summary', () => {
  const pool = Array.from({ length: 10 }, (_, i) => leg({ id: `l${i}`, gameId: `G${i % 5}`, playerId: i, pLean: 0.7 - i * 0.01, team: i % 2 ? 'BOS' : 'NY', teamKey: `G${i % 5}|${i % 2 ? 'BOS' : 'NY'}` }));
  const t1 = paperTicketsFor('nba', pool, [], '2026-10-29');
  assert.ok(t1.length > 0 && t1.every(t => t.result === null && t.legs.length === t.L && t.jointP > 0 && t.jointP <= 1));
  const again = paperTicketsFor('nba', pool, t1, '2026-10-29');
  const key = (t: PaperTicket) => `${t.mode}${t.L}`;
  assert.ok(again.every(t => !t1.some(o => o.id === t.id) && t1.filter(o => key(o) === key(t)).every(o => o.legs.every(l => !t.legs.some(x => x.id === l.id)))), 'a rebuild never reuses legs of an existing ticket in the same menu item or an existing id');
  for (const k of new Set([...t1, ...again].map(key))) assert.ok([...t1, ...again].filter(t => key(t) === k).length <= 3, 'at most three per menu item per day');
  const ids = new Set(t1.map(t => t.id)); assert.equal(ids.size, t1.length);
  const used = new Set(t1.filter(t => t.mode === 'safe').flatMap(t => t.legs.map(l => l.id)));
  const more = paperTicketsFor('nba', [...pool, ...Array.from({ length: 6 }, (_, i) => leg({ id: `n${i}`, gameId: `H${i}`, playerId: 100 + i, pLean: 0.69, teamKey: `H${i}|BOS` }))], t1, '2026-10-29');
  assert.ok(more.every(t => !ids.has(t.id)) && more.filter(t => t.mode === 'safe').every(t => t.legs.every(l => !used.has(l.id))));
  const mk = (legs: string[]): PaperTicket => ({ id: legs.join(), date: 'd', sport: 'nba', mode: 'cross', L: legs.length, jointP: 0.3, indepP: 0.25, correlated: false, result: null, legs: legs.map(id => ({ id, src: 'card', name: id, market: 'pts', side: 'OVER', line: 1, pLean: 0.5, gameId: id })) });
  const states: Record<string, any> = { h1: 'HIT', h2: 'HIT', m: 'MISS', v: 'VOID', p: null, push: 'PUSH' };
  const g = gradePaperTickets([mk(['h1', 'h2']), mk(['h1', 'm']), mk(['m', 'p']), mk(['m', 'v']), mk(['h1', 'p']), mk(['h1', 'push'])], l => states[l.id], 5);
  assert.deepEqual(g.tickets.map(t => t.result), ['HIT', 'MISS', 'MISS', 'VOID', null, 'VOID']);
  assert.deepEqual([g.graded, g.voided, g.pending], [3, 2, 1]);
  const old = gradePaperTickets([{ ...mk(['h1', 'p']), date: '2026-10-01' }], l => states[l.id], 5, { today: '2026-10-29', days: 10 });
  assert.equal(old.tickets[0].result, 'VOID');
  const s = summarizePaper(g.tickets)[0];
  assert.equal(s.n, 3); assert.equal(s.hits, 1); assert.ok(Math.abs(s.realized! - 1 / 3) < 1e-12 && Math.abs(s.predicted! - 0.3) < 1e-12);
  assert.ok(s.brier! < 0.5 && s.brierIndep! < 0.5);
});

test('leg builders: card legs carry the desk probability for the lean; priced legs need STAB/FADE, EV > 0 and two prices', () => {
  const row = { id: 'x', date: 'd', gameId: 'g', market: 'sog', playerId: 1, name: 'N', team: 'T', opp: 'O', mu: 3, r: 9, line: 2.5, lean: 'UNDER', pOver: 0.44, inputs: 'REAL', avail: 'ACTIVE' } as CardRow;
  assert.ok(Math.abs(legFromCard(row, 'nhl').pLean - 0.56) < 1e-12);
  const led = (o: any) => ({ id: 'L', date: '2026-10-29', gameId: 1, market: 'sog', playerId: 1, playerName: 'N', team: 'T', opp: 'O', line: 2.5, modelMu: 3, r: 9, probOver: 0.6, overOdds: -110, underOdds: -110, tag: 'STAB', side: 'over', ev: 0.04, inputsSource: 'REAL', availability: 'ACTIVE', result: null, ...o });
  assert.equal(legsFromPricedLedger([led({}), led({ id: '2', tag: 'PASS' }), led({ id: '3', ev: -0.01 }), led({ id: '4', underOdds: null }), led({ id: '5', date: '2026-10-28' }), led({ id: '6', result: 'OVER' })], 'nhl', '2026-10-29').map(l => l.id).join(), 'L');
  assert.equal(legsFromPricedLedger([led({})], 'nhl', '2026-10-29')[0].tag, 'EDGE');
});

test('baselines: model win rate and both baselines come from the same decided rows (UNDER + OVER = 100% with no pushes)', () => {
  const mk = (i: number, actual: number, lean: 'OVER' | 'UNDER'): CardRow => ({ id: `r${i}`, date: 'd', capturedAt: 0, gameId: 'g', market: 'pts', playerId: i, name: 'n', team: 't', opp: 'o', mu: 10, r: 8, line: 10.5, lean,
    pOver: 0.45, pm: 30, avg: 10, inputs: 'REAL', avail: 'ACTIVE', result: (actual > 10.5) === (lean === 'OVER') ? 'HIT' : 'MISS', actual, minutes: 30, err: actual - 10 });
  const rows = [mk(1, 12, 'OVER'), mk(2, 8, 'UNDER'), mk(3, 7, 'UNDER'), mk(4, 14, 'UNDER'), mk(5, 9, 'OVER')];
  const s = summarizeCard(rows, ['pts']);
  assert.equal(s.decided, 5); assert.equal(s.hits, 3);
  assert.ok(Math.abs(s.winRate! - 0.6) < 1e-12 && Math.abs(s.alwaysUnder! - 0.6) < 1e-12 && Math.abs(s.alwaysOver! - 0.4) < 1e-12);
});
