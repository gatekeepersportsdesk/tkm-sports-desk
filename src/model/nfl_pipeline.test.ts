import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildNflSlate, buildNflGrades, injuryFor, NflverseFiles } from '../lib/nfl_slate.ts';
import { importNflLines, parseImportText, resolveReceiver } from '../lib/nfl_import.ts';
import { NFL_PLAYERS } from '../data/nfl_seed.ts';
import { effectiveAlpha, priceNflProp, applyGameCap, NFL_CONFIG } from './nfl_engine.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const f = (n: string) => readFileSync(join(dir, n), 'utf8');
const files: NflverseFiles = {
  stats: f('stats_2026.csv'), snaps: f('snaps_2026.csv'), players: f('players.csv'),
  games: f('games_2026.csv'), injuries: f('injuries_2026.csv'),
  priorStats: f('stats_2025.csv'), priorSnaps: f('snaps_2025.csv')
};
const NOW = new Date('2026-10-23T19:00:00Z');

function ctxFor(week: number) {
  const slate = buildNflSlate(files, { season: 2026, week, now: NOW });
  const games: Record<string, any> = {};
  slate.games.forEach(g => { games[g.id] = g; });
  return { slate, ctx: { games, players: Object.values(slate.receivers).flat(), injuries: slate.injuries, injuriesAvailable: slate.injuriesAvailable } };
}

test('slate: real nflverse inputs, walk-forward as-of week', () => {
  const { slate } = ctxFor(7);
  assert.equal(slate.week, 7);
  assert.equal(slate.asOfWeek, 6);
  const sea = slate.receivers['SEA'] || [];
  const jsn = sea.find(p => p.name.includes('Smith-Njigba'));
  assert.ok(jsn, 'JSN present');
  assert.equal(jsn!.source, 'nflverse');
  assert.equal(jsn!.asOfWeek, 6);
  assert.ok(jsn!.route_pct > 0.7 && jsn!.route_pct <= 1, `route_pct ${jsn!.route_pct}`);
  assert.ok(slate.ratios.WR.ratio >= 0.85 && slate.ratios.WR.ratio <= 1.15);
  assert.ok(slate.ratios.TE.ratio >= 0.85 && slate.ratios.TE.ratio <= 1.15);
});

test('slate: an earlier week never sees later data (no leakage)', () => {
  const early = buildNflSlate(files, { season: 2026, week: 3, now: NOW }).receivers['SEA'].find(p => p.name.includes('Smith-Njigba'))!;
  const late = buildNflSlate(files, { season: 2026, week: 7, now: NOW }).receivers['SEA'].find(p => p.name.includes('Smith-Njigba'))!;
  assert.equal(early.asOfWeek, 2);
  assert.ok(early.targets < late.targets, 'week-3 slate has fewer targets than week-7 slate');
  assert.ok(early.games <= 2);
});

test('slate: injuries come from the official report only', () => {
  const { slate } = ctxFor(7);
  assert.equal(slate.injuriesAvailable, true);
  const noInj = buildNflSlate({ ...files, injuries: undefined }, { season: 2026, week: 7, now: NOW });
  assert.equal(noInj.injuriesAvailable, false);
  assert.ok(noInj.warnings.some(w => /injury/i.test(w)));
  assert.equal(injuryFor(slate, 'Nobody Atall'), undefined);
});

test('import: priced rows are gated; unknown players are skipped, never invented', () => {
  const { ctx } = ctxFor(7);
  const sea = ctx.players.find(p => p.team === 'SEA' && p.pos === 'WR')!;
  const text = `${sea.name}, 5.5, -115, -115\nTotally Unknown Guy, 3.5, -110, -110\n${sea.name}, 6.5, , `;
  const res = importNflLines(text, 2026, 7, 'Bet99', 'pre', ctx, []);
  assert.equal(res.imported, 2);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /not in this week/);
  const priced = res.snapshots.find(s => s.line === 5.5)!;
  assert.equal(priced.hasMarket, true);
  assert.equal(priced.inputsSource, 'REAL');
  const noOdds = res.snapshots.find(s => s.line === 6.5)!;
  assert.equal(noOdds.hasMarket, false);
  assert.notEqual(noOdds.cardStatus, 'BET');
});

test('import: seed / stale inputs can never be BET (ESTIMATED)', () => {
  const { ctx } = ctxFor(7);
  const seedOnly = { ...ctx, players: Object.values(NFL_PLAYERS) };
  const game = Object.values(ctx.games).find(g => g.home === 'SEA' || g.away === 'SEA')!;
  const jsn = NFL_PLAYERS['Jaxon Smith-Njigba'];
  const res = importNflLines(`${jsn.name}, 2.5, +300, -500`, 2026, 7, 'x', 'pre', { ...seedOnly, games: { [game.id]: game } }, []);
  assert.equal(res.snapshots.length, 1);
  assert.equal(res.snapshots[0].inputsSource, 'ESTIMATED');
  assert.notEqual(res.snapshots[0].cardStatus, 'BET');
});

test('import: no injury report -> availability UNKNOWN -> cannot BET', () => {
  const { ctx } = ctxFor(7);
  const p = ctx.players.find(x => x.team === 'SEA' && x.pos === 'WR')!;
  const res = importNflLines(`${p.name}, 1.5, +250, -400`, 2026, 7, 'x', 'pre', { ...ctx, injuriesAvailable: false }, []);
  assert.equal(res.snapshots[0].availability, 'UNKNOWN');
  assert.notEqual(res.snapshots[0].cardStatus, 'BET');
});

test('import: injury-report OUT forces PASS even with a huge edge', () => {
  const { ctx } = ctxFor(7);
  const p = ctx.players.find(x => x.team === 'SEA' && x.pos === 'WR')!;
  const injuries = { ...ctx.injuries, [p.name.toLowerCase().replace(/[^a-z ]/g, '')]: { status: 'OUT' as const, detail: 'knee', team: 'SEA' } };
  const res = importNflLines(`${p.name}, 0.5, +900, -3000`, 2026, 7, 'x', 'pre', { ...ctx, injuries }, []);
  assert.equal(res.snapshots[0].availability, 'OUT');
  assert.equal(res.snapshots[0].cardStatus, 'PASS');
});

test('import: parse + resolve helpers', () => {
  const r = parseImportText('A B, 4.5, -110, -120\nbad line\nC D, x, -110, -110');
  assert.equal(r.lines.length, 1);
  assert.equal(r.skipped.length, 2);
  const pool = [{ ...NFL_PLAYERS['Courtland Sutton'] }, { ...NFL_PLAYERS['Jaylen Waddle'] }];
  assert.equal(resolveReceiver('courtland sutton', pool)?.name, 'Courtland Sutton');
  assert.equal(resolveReceiver('Nobody', pool), undefined);
});

test('game cap: at most 3 BETs per game, best edges kept', () => {
  const mk = (edge: number) => ({ gameKey: 'g', cardStatus: 'BET' as const, cardReason: '', edge });
  const out = applyGameCap([mk(0.04), mk(0.09), mk(0.05), mk(0.07), mk(0.03)]);
  assert.equal(out.filter(s => s.cardStatus === 'BET').length, NFL_CONFIG.game_cap);
  assert.deepEqual(out.filter(s => s.cardStatus === 'BET').map(s => s.edge).sort(), [0.05, 0.07, 0.09]);
});

test('pricing: no odds -> no BET; one-sided -> never BET; early-season alpha is wider', () => {
  const noMkt = priceNflProp({ mu: 6, alpha: 0.1, line: 3.5, seasonAvg: 5 });
  assert.equal(noMkt.hasMarket, false);
  assert.notEqual(noMkt.status, 'BET');
  const oneSided = priceNflProp({ mu: 6, alpha: 0.1, line: 3.5, overOdds: '+150', seasonAvg: 5 });
  assert.equal(oneSided.twoWay, false);
  assert.notEqual(oneSided.status, 'BET');
  assert.ok(effectiveAlpha('WR', 2) > effectiveAlpha('WR', 12));
});

test('grades: real final receptions from nflverse, only for final games', () => {
  const g = buildNflGrades(files, 2026, 6);
  assert.ok(g.finalTeams.includes('SEA') && g.finalTeams.includes('DEN'));
  const jsn = Object.entries(g.actuals).find(([k]) => k.includes('smithnjigba') || k.includes('smith-njigba') || k.includes('smith njigba'));
  assert.ok(jsn, 'JSN graded: ' + Object.keys(g.actuals).slice(0, 5).join(','));
  assert.equal(jsn![1].actual, 12);
  const wk7 = buildNflGrades(files, 2026, 7);
  assert.equal(wk7.finalTeams.length, 0);
});
