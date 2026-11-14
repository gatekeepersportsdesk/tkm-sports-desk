import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BETTABLE as C, bettableIssue, usageIssue, juiceIssue, bestLine, rankKey, bestSide } from './bettable.ts';
import { parsePostedText, planApply, mergeOddsMap, normalizeMarket, resolveCandidate } from './odds_ingest.ts';
import { legIssue, DEFAULT_RULES, ParlayLeg, buildPool, suggestTickets } from './parlay_core.ts';

const base = { sport: 'nba' as const, inputs: 'REAL' as const, availability: 'ACTIVE' as const };

test('bettable: non-shooting centre threes and non-shooter SOG are not bettable; a real shooter at 1.5 stays bettable', () => {
  assert.match(bettableIssue({ ...base, market: 'tpm', mu: 0.12, pm: 28 }, C)!, /low 3PA/);
  assert.equal(bettableIssue({ ...base, market: 'tpm', mu: 2.4, pm: 32 }, C), null);
  assert.match(bettableIssue({ ...base, sport: 'nhl', market: 'sog', mu: 0.6 }, C)!, /low shot rate/);
  assert.equal(bettableIssue({ ...base, sport: 'nhl', market: 'sog', mu: 2.8 }, C), null);
  assert.match(bettableIssue({ ...base, market: 'pts', mu: 4, pm: 8 }, C)!, /low minutes/);
  assert.match(bettableIssue({ ...base, market: 'pts', mu: 20, pm: 30, availability: 'DOUBTFUL' }, C)!, /availability/);
  assert.match(bettableIssue({ ...base, market: 'pts', mu: 20, pm: 30, inputs: 'ESTIMATED' }, C)!, /estimated/);
  assert.match(bettableIssue({ ...base, sport: 'nfl', market: 'rec', mu: 0.4 }, C)!, /target volume/);
  assert.match(bettableIssue({ ...base, sport: 'mlb', market: 'hit', mu: 0.9, pm: 1.2 }, C)!, /at-bats/);
  assert.equal(usageIssue('nba', 'tpm', 0.3, 30, { ...C, floors: { ...C.floors, nbaTpmMu: 0.25 } }), null, 'floors are editable');
  assert.match(juiceIssue(-800, C)!, /juice too high/); assert.equal(juiceIssue(-110, C), null); assert.equal(juiceIssue(null, C), null);
});

test('best line: highest EV across several posted lines; unpriced sort below priced', () => {
  const ev: Record<number, any> = { 22.5: { hasMarket: true, evOver: 0.01, evUnder: -0.05, edgeOver: 1, edgeUnder: -3 }, 24.5: { hasMarket: true, evOver: -0.04, evUnder: 0.06, edgeOver: -2, edgeUnder: 3 } };
  const b = bestLine([24.5, 22.5, 26.5], l => ev[l] ?? null)!;
  assert.deepEqual([b.line, b.side], [24.5, 'under']);
  assert.equal(bestLine([26.5], () => null), null);
  assert.equal(bestSide({ hasMarket: false, evOver: 1, evUnder: 1, edgeOver: 1, edgeUnder: 1 }), null);
  assert.ok(rankKey('ev', b, 0.9) > rankKey('ev', null, 0.99));
  assert.equal(rankKey('p', null, 0.7), 0.7);
});

const cands = [{ id: 7, name: 'Nikola Jokić' }, { id: 8, name: 'Jamal Murray' }, { id: 9, name: 'Michael Porter Jr.' }];
const key = (m: string, id: number | string, l: number) => `${m}|${id}|${l}`;

test('import: JSON with two lines on one player-market and two books; CSV; errors named; no invented prices', () => {
  const json = JSON.stringify([
    { book: 'Bet365', sport: 'nba', player: 'Jamal Murray', market: 'Points', line: 22.5, over: '-105', under: -125 },
    { book: 'bet365', sport: 'nba', player: 'Jamal Murray', market: 'Points', line: 24.5, overOdds: 150, underOdds: -185 },
    { book: 'bet99', sport: 'nba', player: 'Jamal Murray', market: 'Points', line: 24.5, overOdds: 140, underOdds: -170 },
    { book: 'bet99', sport: 'nba', player: 'Nobody Here', market: 'Points', line: 10.5, over: -110, under: -110 },
    { book: 'bet99', sport: 'nba', player: 'Jamal Murray', market: 'Dunks', line: 0.5, over: -110, under: -110 },
    { book: 'bet99', sport: 'nba', player: 'Jamal Murray', market: 'Points', line: 'x', over: -110 },
    { book: 'bet99', sport: 'nba', player: 'Jamal Murray', market: 'Rebounds', line: 3.5 },
    { book: 'bet99', sport: 'nhl', player: 'X', market: 'Shots', line: 2.5, over: -110, under: -110 }
  ]);
  const p = parsePostedText(json, 'nba');
  assert.equal(p.lines.length, 4); assert.equal(p.otherSport, 1); assert.equal(p.errors.length, 3);
  assert.ok(p.errors.some(e => /Dunks/.test(e)) && p.errors.some(e => /not a number/.test(e)) && p.errors.some(e => /no readable price/.test(e)));
  const plan = planApply(p.lines, { book: 'best', candidates: cands, keyFor: key });
  assert.equal(plan.matched, 2);
  assert.ok(plan.entries['pts|8|22.5'] && plan.entries['pts|8|24.5']);
  assert.deepEqual(plan.unmatched, ['Nobody Here']);
  // same line posted by both books: the tighter two-way price wins without a model, the better EV wins with one
  assert.equal(plan.entries['pts|8|24.5'].book, 'bet99'); // 140 / -170 (hold 1.038) vs 150 / -185 (hold 1.041)
  const withModel = planApply(p.lines, { book: 'best', candidates: cands, keyFor: key, model: () => ({ pOver: 0.45, pUnder: 0.55 }) });
  assert.equal(withModel.entries['pts|8|24.5'].book, 'bet365'); // over +150 has the higher EV at p=0.45
  assert.equal(planApply(p.lines, { book: 'bet365', candidates: cands, keyFor: key }).entries['pts|8|24.5'].book, 'bet365');
  assert.equal(planApply(p.lines, { book: 'bet99', candidates: cands, keyFor: key }).entries['pts|8|22.5'], undefined);
  const csv = 'book,player,market,line,over,under\nbet99,"Jokić, Nikola",Points,26.5,-115,-115\nbet99,Nikola Jokić,Rebounds,12.5,+100,-130';
  const c = parsePostedText(csv, 'nba');
  assert.equal(c.lines.length, 2); assert.equal(c.lines.find(l => l.line === 26.5)?.player, 'Jokić, Nikola');
  assert.ok(c.lines.some(l => l.market === 'reb' && l.line === 12.5 && l.overOdds === 100 && l.underOdds === -130));
  assert.match(parsePostedText('not json', 'nba').errors[0], /header/);
  assert.match(parsePostedText('[1,', 'nba').errors[0], /Invalid JSON/);
  assert.equal(normalizeMarket('nba', '3-Pointers Made'), 'tpm'); assert.equal(normalizeMarket('nhl', 'Player Shots on Goal'), 'sog'); assert.equal(normalizeMarket('nfl', 'Receptions'), 'rec'); assert.equal(normalizeMarket('mlb', 'Hits'), 'hit');
  assert.equal(resolveCandidate('Michael Porter', cands)?.id, 9);
  assert.equal(resolveCandidate('J Smith', [{ id: 1, name: 'John Smith' }, { id: 2, name: 'Jake Smith' }]), undefined, 'ambiguous names are never guessed');
});

test('merge: import fills prices, keeps other keys unless replace is chosen; never touches anything but over/under', () => {
  const plan = planApply(parsePostedText('book,player,market,line,over,under\nbet99,Jamal Murray,Points,22.5,-110,-110', 'nba').lines, { book: 'best', candidates: cands, keyFor: key });
  const ex: any = { 'pts|8|20.5': { over: -120, under: 100 }, 'pts|8|22.5': { over: null, under: -105 } };
  const m = mergeOddsMap(ex, plan);
  assert.deepEqual(m['pts|8|20.5'], ex['pts|8|20.5']); assert.deepEqual(m['pts|8|22.5'], { over: -110, under: -110 });
  assert.deepEqual(Object.keys(mergeOddsMap(ex, plan, true)), ['pts|8|22.5']);
});

const leg = (o: Partial<ParlayLeg>): ParlayLeg => ({ id: 'a', src: 'ledger', sport: 'nba', date: 'd', gameId: 'G1', playerId: 1, playerName: 'A', team: 'T', opp: 'O', market: 'tpm', side: 'UNDER', line: 0.5, mu: 0.1, pm: 25, r: 3, pLean: 0.9, tag: 'EDGE', inputs: 'REAL', availability: 'ACTIVE', overOdds: 900, underOdds: -1200, teamKey: 'G1|T', ...o });
test('parlay: low-usage under 0.5 threes and heavy juice are out of Edge / Safe; a real shooter priced -110/-110 is in; multi-line pool keeps each line', () => {
  assert.match(legIssue(leg({}), 'edge', DEFAULT_RULES)!, /not bettable/);
  assert.match(legIssue(leg({}), 'safe', DEFAULT_RULES)!, /not bettable/);
  const shooter = leg({ id: 's', mu: 2.2, line: 1.5, side: 'OVER', pLean: 0.6, overOdds: -110, underOdds: -110 });
  assert.equal(legIssue(shooter, 'edge', DEFAULT_RULES), null);
  assert.match(legIssue({ ...shooter, side: 'UNDER', underOdds: -200 }, 'edge', DEFAULT_RULES)!, /juice too high/);
  assert.match(legIssue({ ...shooter, availability: 'DOUBTFUL' }, 'edge', DEFAULT_RULES)!, /availability/);
  assert.equal(legIssue(leg({ mu: 0.1 }), 'cross', DEFAULT_RULES), null, 'research modes are not restricted');
  const pool = buildPool([leg({ id: 'card', src: 'card', tag: 'NONE', playerId: 5 })], [shooter, { ...shooter, id: 's2', line: 2.5 }]);
  assert.equal(pool.length, 3); // two priced lines of one player-market + a model-only leg for a different player
  const same = buildPool([leg({ id: 'card2', src: 'card', playerId: 1, market: 'tpm' })], [shooter]);
  assert.deepEqual(same.map(l => l.id), ['s']);
  const t = suggestTickets([shooter, { ...shooter, id: 's2', line: 2.5, pLean: 0.55 }, { ...shooter, id: 'o', playerId: 2, gameId: 'G2', teamKey: 'G2|T' }], 'edge', 2, DEFAULT_RULES);
  assert.ok(t.length > 0 && t.every(x => new Set(x.legs.map(l => `${l.playerId}|${l.market}`)).size === x.legs.length), 'one line per player-market on a ticket');
});

import fs from 'node:fs';
import { parseNbaBox, buildNbaState } from './nba_data.ts';
import { buildNbaSlate, evalNbaRow } from './nba_board.ts';
import { rankDeskRows } from './desk_rank.ts';
import { NBA_CONFIG } from '../model/nba_engine.ts';

test('real fixture slate: tiny-usage threes / steals are hidden, shooters stay; priced rows sort by EV above unpriced', () => {
  const rd = (n: string) => fs.readFileSync(new URL(`../model/fixtures/${n}`, import.meta.url), 'utf8');
  const st = buildNbaState(parseNbaBox(rd('nba_box_cur.csv')), parseNbaBox(rd('nba_box_prior.csv')));
  const slate = buildNbaSlate(st, [{ gameId: 'G1', date: '2026-10-26', home: 'BOS', away: 'NY', state: 'pre', completed: false, postponed: false, label: 'x' }], []);
  const settings = { edgeThreshold: NBA_CONFIG.edgeMinPts, maxJuice: NBA_CONFIG.maxChalk, showStabsOnly: false };
  const odds: Record<string, any> = {};
  const top = slate.slice().sort((a, b) => b.markets.pts.mu - a.markets.pts.mu)[0];
  odds[`pts|${top.playerId}|${top.markets.pts.defaultLine}`] = { over: -110, under: -110 };
  odds[`pts|${top.playerId}|${top.markets.pts.defaultLine + 2}`] = { over: 150, under: -185 };
  const run = (market: any) => rankDeskRows(slate, {
    sport: 'nba', market, cfg: C, linesOf: p => p.markets[market as 'pts'].lines, defaultLine: p => p.markets[market as 'pts'].defaultLine, picked: () => undefined,
    entryAt: (p, l) => odds[`${market}|${p.playerId}|${l}`],
    evalAt: (p, l) => { const r = evalNbaRow(p, market, l, odds[`${market}|${p.playerId}|${l}`], settings); const d = r.decision; return { hasMarket: d.hasMarket, evOver: d.evOver, evUnder: d.evUnder, edgeOver: d.edgeOver, edgeUnder: d.edgeUnder, pOver: r.pOver, pUnder: r.pUnder }; },
    mu: p => p.markets[market as 'pts'].mu, pm: p => p.markets[market as 'pts'].pm, inputs: p => p.inputsSource, availability: p => p.availability
  });
  const tpm = run('tpm');
  const low = tpm.filter(r => r.p.markets.tpm.mu < C.floors.nbaTpmMu);
  const ok = tpm.filter(r => r.p.markets.tpm.mu >= C.floors.nbaTpmMu && r.p.markets.tpm.pm >= C.floors.nbaMinutes && r.p.inputsSource === 'REAL');
  assert.ok(low.length > 0, 'fixture has non-shooters');
  assert.ok(low.every(r => r.issue !== null && /low 3PA|minutes|estimated|availability/.test(r.issue!)));
  assert.ok(ok.length > 0 && ok.every(r => r.issue === null || /availability/.test(r.issue)), 'real shooters stay bettable');
  const pts = run('pts');
  assert.equal(pts[0].p.playerId, top.playerId, 'the priced player sorts first');
  assert.ok(pts[0].best && pts[0].priced && pts.slice(1).every(r => !r.priced));
  assert.ok([pts[0].best!.line].every(l => l === top.markets.pts.defaultLine || l === top.markets.pts.defaultLine + 2), 'best line is one of the two posted lines');
});

test('the local odds script output (scripts/odds/examples) is accepted by the in-app importer, several lines and books intact', () => {
  const rd = (n: string) => fs.readFileSync(new URL(`../../scripts/odds/examples/${n}`, import.meta.url), 'utf8');
  const nba = parsePostedText(rd('sample_nba.json'), 'nba');
  assert.deepEqual(nba.errors, []); assert.equal(nba.lines.length, 5);
  assert.deepEqual([...new Set(nba.lines.map(l => l.book))].sort(), ['bet365', 'bet99']);
  assert.equal(nba.lines.filter(l => l.market === 'pts' && l.player === 'Jalen Johnson').length, 3);
  assert.ok(nba.lines.some(l => l.market === 'tpm' && l.line === 1.5));
  const nhl = parsePostedText(rd('sample_nhl.json'), 'nhl');
  assert.deepEqual(nhl.errors, []); assert.deepEqual(nhl.lines.map(l => l.market).sort(), ['pts', 'sog']);
  assert.equal(parsePostedText(rd('sample_nba.json'), 'nhl').otherSport, 5, 'a file for another sport is ignored, not mis-applied');
});
