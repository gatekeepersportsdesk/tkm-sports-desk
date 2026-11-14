import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { projectNhlSkater } from '../model/nhl_engine.ts';
import { NhlPlayerSnapshot, NhlGameMatchup, NhlLedgerRow } from '../types/nhl.ts';
import { captureNhlCard, gradeNhlCard, nhlEdgeKeys, summarizeNhlCard, nhlPredictionId } from './nhl_card.ts';
import { captureMlbCard, gradeMlbCard, mlbNotStarted, mlbPredictionId, mlbEdgeKeys, summarizeMlbCard } from './mlb_card.ts';
import { captureNflCard, gradeNflCard, nflEdgeKeys, nflPendingWeeks, nflPredictionId, summarizeNflCard } from './nfl_card.ts';
import { easternKickoffMs } from './nflverse.ts';
import { buildNflSlate, NflverseFiles } from './nfl_slate.ts';
import { mergeCardRows, isHeadline } from './card_core.ts';
import { MlbGameMatchup } from '../types/mlb.ts';

/* ---------------- NHL ---------------- */
const skater = (id: number, o: Partial<NhlPlayerSnapshot> = {}): NhlPlayerSnapshot => ({
  playerId: id, name: `P${id}`, team: 'BOS', pos: 'F', toiAvg: 19, gp: 20, shots: 70, points: 18, priorGp: 80, priorShots: 260, priorPoints: 60,
  recentShots: [3, 4, 2, 5], recentPoints: [1, 0, 1, 0], availability: 'ACTIVE', inputsSource: 'REAL', ...o
});
const START = Date.parse('2026-10-28T23:00:00Z');
const nhlGames: NhlGameMatchup[] = [{ gameId: 501, startTimeUtc: new Date(START).toISOString(), awayTeam: 'NYR', homeTeam: 'BOS', venue: 'x' }];
const nhlProj = [1, 2, 3].map(i => ({ ...projectNhlSkater(skater(i, i === 3 ? { availability: 'OUT' } : {}), 'NYR'), gameId: 501 }));

test('NHL capture: sog + pts, pre-game only, OUT skipped, idempotent, never rewrites', () => {
  const rows = captureNhlCard(nhlProj, nhlGames, new Set(), '2026-10-28', START - 3600000);
  assert.equal(rows.length, 4); // 2 healthy skaters x 2 markets
  const r = rows.find(x => x.market === 'sog')!;
  assert.ok(r.id === nhlPredictionId('2026-10-28', 'sog', 1) && r.r! > 0 && r.pm === 19 && Math.abs(r.avg! - 3.5) < 1e-9 && r.result === null);
  assert.equal(captureNhlCard(nhlProj, nhlGames, new Set(rows.map(x => x.id)), '2026-10-28', START - 1000).length, 0);
  assert.equal(captureNhlCard(nhlProj, nhlGames, new Set(), '2026-10-28', START + 1).length, 0, 'started game not captured');
  const kept = [{ ...rows[0], result: 'HIT' as const }, ...rows.slice(1)];
  assert.equal(mergeCardRows(kept, rows)[0].result, 'HIT');
});

test('NHL grade: from box score, DNP void, not final pending, postponed void', () => {
  const rows = captureNhlCard(nhlProj, nhlGames, new Set(), '2026-10-28', START - 1);
  const box = (final: boolean, voided = false) => ({ final, voided, players: { '1': { sog: 6, points: 2, toiSec: 1200 } } as any });
  const g = gradeNhlCard(rows, { '501': box(true) }, '2026-10-29');
  const by = (id: string, m: string) => g.rows.find(r => r.playerId === Number(id) && r.market === m)!;
  assert.equal(by('1', 'sog').actual, 6); assert.equal(by('1', 'sog').minutes, 20);
  assert.ok(['HIT', 'MISS'].includes(by('1', 'sog').result!));
  assert.ok(Math.abs(by('1', 'sog').err! - (6 - by('1', 'sog').mu)) < 1e-9);
  assert.equal(by('2', 'sog').result, 'VOID');
  assert.deepEqual([g.graded, g.voided], [2, 2]);
  assert.equal(gradeNhlCard(rows, { '501': box(false) }, '2026-10-29').pending, 4);
  assert.equal(gradeNhlCard(rows, { '501': box(false, true) }, '2026-10-29').voided, 4);
  assert.equal(gradeNhlCard(rows, {}, '2026-10-29').pending, 4);
  const s = summarizeNhlCard(g.rows);
  assert.equal(s.decided, 2); assert.equal(s.voided, 2);
});

test('NHL edge keys: only priced STAB/FADE, not demo', () => {
  const L = (o: Partial<NhlLedgerRow>) => ({ date: '2026-10-28', market: 'sog', playerId: 1, tag: 'STAB', ...o }) as NhlLedgerRow;
  const e = nhlEdgeKeys([L({}), L({ playerId: 2, tag: 'PASS' }), L({ playerId: 3, demo: true })]);
  assert.deepEqual([...e], ['2026-10-28:sog:1']);
});

/* ---------------- MLB ---------------- */
const bat = (id: number, o: any = {}) => ({
  id, name: `B${id}`, team: 'NYY', slot: 2, isHome: false, hand: 'L', seasonBa: 0.26, seasonPa: 600, xba: 0.26, xbaPa: 600, recentBa: 0.26, recentAb: 40,
  bbPct: 0.085, recentReal: true, oppSp: 'X', oppHand: 'RHP', confirmed: true, availability: 'ACTIVE', inputsSource: 'REAL', park: 1, gamePk: 9001, ...o
});
const mlbGame = (o: Partial<MlbGameMatchup> = {}): MlbGameMatchup => ({
  gamePk: 9001, away: 'NYY', home: 'BOS', status: 'Scheduled', live: false, inning: 0, park: 1, confirmed: true,
  awaySp: { name: 'A', hand: 'RHP', kPct: 22, kBf: 600, recentIp: 5.5 }, homeSp: { name: 'H', hand: 'RHP', kPct: 22, kBf: 600, recentIp: 5.5 },
  batters: [bat(1), bat(2, { availability: 'NOT_IN_LINEUP' }), bat(3, { inputsSource: 'ESTIMATED' })] as any, ...o
});

test('MLB capture: confirmed + not started only, bench skipped, idempotent, estimated flagged', () => {
  const rows = captureMlbCard([mlbGame()], new Set(), '2026-10-28', undefined, 5);
  assert.equal(rows.length, 2);
  const r = rows.find(x => x.playerId === 1)!;
  assert.ok(r.id === mlbPredictionId('2026-10-28', 1) && r.line === 0.5 && r.r === null && r.pm! > 3 && r.mu > 0.5 && r.mu < 1.6);
  assert.ok(Math.abs(r.pOver - (r.lean === 'OVER' ? r.pOver : r.pOver)) < 1 && (r.lean === 'OVER') === (r.pOver >= 0.5));
  assert.ok(isHeadline(r) && !isHeadline(rows.find(x => x.playerId === 3)!));
  assert.equal(captureMlbCard([mlbGame()], new Set(rows.map(x => x.id)), '2026-10-28').length, 0);
  assert.equal(captureMlbCard([mlbGame({ confirmed: false })], new Set(), 'd').length, 0);
  for (const st of ['In Progress', 'Final', 'Postponed', 'Delayed']) assert.equal(captureMlbCard([mlbGame({ status: st })], new Set(), 'd').length, 0, st);
  assert.equal(captureMlbCard([mlbGame({ live: true })], new Set(), 'd').length, 0);
  assert.ok(mlbNotStarted({ live: false, status: 'Pre-Game' }) && mlbNotStarted({ live: false, status: 'Warmup' }));
});

test('MLB grade: hits >= 1 is OVER, 0-for-4 a loss for OVER, no PA void, not final pending', () => {
  const rows = captureMlbCard([mlbGame({ batters: [bat(1), bat(3, { inputsSource: 'REAL' }), bat(4, { inputsSource: 'REAL' })] as any })], new Set(), '2026-10-28');
  const box = (final: boolean) => ({ final, voided: false, players: { '1': { hits: 2, atBats: 4, pa: 4 }, '3': { hits: 0, atBats: 4, pa: 4 } } });
  const g = gradeMlbCard(rows, { '9001': box(true) }, '2026-10-29');
  const by = (id: number) => g.rows.find(r => r.playerId === id)!;
  assert.equal(by(1).actual, 2); assert.equal(by(1).result, by(1).lean === 'OVER' ? 'HIT' : 'MISS');
  assert.equal(by(3).actual, 0); assert.equal(by(3).result, by(3).lean === 'OVER' ? 'MISS' : 'HIT');
  assert.match(by(1).reason!, /Actual 2 in 4 AB/);
  assert.equal(by(4).result, 'VOID'); assert.equal(by(4).err, null);
  assert.equal(gradeMlbCard(rows, { '9001': box(false) }, '2026-10-29').pending, 3);
  assert.equal(summarizeMlbCard(g.rows).decided, 2);
  const e = mlbEdgeKeys([{ date: '2026-10-28', id: 1, call: 'PLAY', line: 0.5 } as any, { date: '2026-10-28', id: 2, call: 'PASS' } as any]);
  assert.deepEqual([...e], [mlbPredictionId('2026-10-28', 1)]);
});

/* ---------------- NFL ---------------- */
const dir = join(dirname(fileURLToPath(import.meta.url)), '../model/fixtures');
const f = (n: string) => readFileSync(join(dir, n), 'utf8');
const files: NflverseFiles = {
  stats: f('stats_2026.csv'), snaps: f('snaps_2026.csv'), players: f('players.csv'), games: f('games_2026.csv'),
  injuries: f('injuries_2026.csv'), priorStats: f('stats_2025.csv'), priorSnaps: f('snaps_2025.csv')
};
const slate = buildNflSlate(files, { season: 2026, week: 7, now: new Date('2026-10-23T19:00:00Z') });
const games: Record<string, any> = {}; slate.games.forEach(g => { games[g.id] = g; });
const nctx = { injuries: slate.injuries, injuriesAvailable: slate.injuriesAvailable };

test('NFL kickoff: Eastern wall time converts with daylight saving', () => {
  assert.equal(easternKickoffMs('2026-10-25', '13:00'), Date.parse('2026-10-25T17:00:00Z')); // EDT
  assert.equal(easternKickoffMs('2026-12-06', '13:00'), Date.parse('2026-12-06T18:00:00Z')); // EST
  assert.equal(easternKickoffMs('', '13:00'), null);
});

test('NFL capture: only games with a known future kickoff; nflverse inputs only; idempotent; OUT skipped', () => {
  const open = Object.values(games).filter((g: any) => !g.played && g.kickoffAt != null) as any[];
  assert.ok(open.length > 0, 'fixture has an unplayed week-7 game with a kickoff');
  const before = Math.min(...open.map(g => g.kickoffAt)) - 3600000;
  const rows = captureNflCard(games, slate.receivers, nctx, new Set(), '2026-10-25', before);
  assert.ok(rows.length > 0 && rows.every(r => r.market === 'rec' && r.r! > 0 && r.line >= 0.5 && r.season === 2026 && r.week === 7 && r.id === nflPredictionId(2026, 7, r.name)));
  assert.ok(!rows.some(r => r.avail === 'OUT'));
  assert.equal(captureNflCard(games, slate.receivers, nctx, new Set(rows.map(r => r.id)), '2026-10-25', before).length, 0);
  assert.equal(captureNflCard(games, slate.receivers, nctx, new Set(), '2026-10-25', Math.max(...open.map(g => g.kickoffAt)) + 1).length, 0, 'all kicked off');
  const unknownKick = Object.fromEntries(Object.entries(games).map(([k, g]: any) => [k, { ...g, kickoffAt: null }]));
  assert.equal(captureNflCard(unknownKick, slate.receivers, nctx, new Set(), 'd', before).length, 0, 'unknown kickoff is never assumed future');
  assert.deepEqual(nflPendingWeeks(rows), ['2026-7']);
});

test('NFL grade: final team + actual = graded, no row on a final team = DNP void, other team pending, no payload pending', () => {
  const open = Object.values(games).filter((g: any) => !g.played && g.kickoffAt != null) as any[];
  const rows = captureNflCard(games, slate.receivers, nctx, new Set(), '2026-10-25', Math.min(...open.map(g => g.kickoffAt)) - 1);
  const a = rows[0], b = rows.find(r => r.team !== a.team && r.team !== a.opp)!, c = rows.find(r => r.team === a.team && r.id !== a.id)!;
  const payload = { season: 2026, week: 7, finalTeams: [a.team, a.opp], actuals: { [a.playerId as string]: { played: true, actual: 5, team: a.team } } };
  const g = gradeNflCard([a, b, c], { '2026-7': payload }, '2026-10-27');
  assert.equal(g.rows[0].actual, 5); assert.ok(['HIT', 'MISS', 'PUSH'].includes(g.rows[0].result!));
  assert.equal(g.rows[1].result, null);
  assert.equal(g.rows[2].result, 'VOID');
  assert.equal(gradeNflCard([a], {}, '2026-10-27').pending, 1);
  assert.equal(gradeNflCard([a], {}, '2026-12-27').voided, 1, 'stale and never seen = VOID');
  assert.equal(summarizeNflCard(g.rows).decided, g.rows[0].result === 'PUSH' ? 0 : 1);
  const e = nflEdgeKeys([{ season: 2026, week: 7, player: 'A B', cardStatus: 'BET', hasMarket: true } as any, { season: 2026, week: 7, player: 'C D', cardStatus: 'PASS', hasMarket: true } as any]);
  assert.deepEqual([...e], [nflPredictionId(2026, 7, 'A B')]);
});
