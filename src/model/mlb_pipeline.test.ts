import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreMlbHit, gateMlbRow, getMlbRefRaw, simMlbCard, parlayEv, hitsNeeded, MLB_DEFAULT_TUNE
} from './mlb_engine.ts';
import {
  parseBatter, parsePitcher, ipToNumber, parseScheduleGame, enrichGames, batterForEngine
} from '../lib/mlb_stats.ts';
import { parseBoxscore, gradeLedger } from '../lib/mlb_grade.ts';

const batter = (o = {}) => ({
  slot: 2, isHome: false, hand: 'L', seasonBa: 0.255, seasonPa: 600, xba: 0.255, xbaPa: 600,
  recentBa: 0.255, recentAb: 40, bbPct: 0.085, recentReal: true, ...o
});
const pitcher = (o = {}) => ({ hand: 'RHP', kPct: 22, kBf: 600, recentIp: 5.2, ...o });

test('engine: hit-count distribution is coherent and beats the old Poisson shortcut', () => {
  const r = scoreMlbHit(batter(), pitcher(), 1.0);
  assert.ok(r.pAtLeast);
  const [p1, p2, p3] = r.pAtLeast!;
  assert.ok(Math.abs(p1 - r.calP) < 0.002);
  assert.ok(p1 > p2 && p2 > p3 && p3 > 0);
  // sanity vs a plain binomial with ~4.1 AB at ~.26: P(>=2) ~ 0.27-0.30
  assert.ok(p2 > 0.24 && p2 < 0.31, `p2=${p2}`);
  const lam = -Math.log(1 - r.calP);
  const poisson2 = 1 - Math.exp(-lam) * (1 + lam);
  assert.ok(p2 < poisson2, 'old Poisson over-stated P(2+ hits)');
});

test('engine: reference cache respects tune changes', () => {
  const a = getMlbRefRaw(undefined, { ...MLB_DEFAULT_TUNE, lgBa: 0.255 });
  const b = getMlbRefRaw(undefined, { ...MLB_DEFAULT_TUNE, lgBa: 0.240 });
  assert.notEqual(a, b);
});

test('gate: estimated inputs can never be PLAY', () => {
  const hit = scoreMlbHit(batter({ recentReal: false }), pitcher(), 1.0);
  assert.equal(hit.inputsReal, false);
  const g = gateMlbRow({ confirmed: true, slot: 1, over: '-160', under: '+130', hit });
  assert.equal(g.call, 'PASS');
  assert.ok(g.reasons.includes('EST_INPUTS'));
});

test('gate: batter not in the posted lineup cannot qualify', () => {
  const hit = scoreMlbHit(batter({ seasonBa: 0.31 }), pitcher(), 1.0);
  const g = gateMlbRow({ confirmed: true, slot: 1, over: '-160', under: '+130', availability: 'NOT_IN_LINEUP', hit });
  assert.equal(g.call, 'PASS');
  assert.ok(g.reasons.includes('UNAVAILABLE'));
});

test('gate: an edge that does not survive the vig is not a PLAY (EV check)', () => {
  const hit = scoreMlbHit(batter({ seasonBa: 0.28, xba: 0.28 }), pitcher({ kPct: 16 }), 1.05);
  // heavy chalk price inside the juice window: positive "edge" pts vs fair, negative EV
  const g = gateMlbRow({ confirmed: true, slot: 1, over: '-200', under: '+160', hit });
  if (g.edge >= MLB_DEFAULT_TUNE.edgeMinPts) {
    assert.ok(g.ev !== null && g.ev <= 0 ? g.call === 'PASS' : true);
  }
  assert.ok(g.ev !== null);
});

test('gate: PLAY needs real inputs, lineup, slot, price window and +EV', () => {
  const hit = scoreMlbHit(batter({ seasonBa: 0.30, xba: 0.30, recentBa: 0.30 }), pitcher({ kPct: 15 }), 1.05);
  const g = gateMlbRow({ confirmed: true, slot: 1, over: '-150', under: '+125', hit });
  assert.equal(g.quality, 'REAL');
  if (g.call === 'PLAY') assert.ok(g.ev! > 0 && g.edge >= MLB_DEFAULT_TUNE.edgeMinPts);
  else assert.ok(g.reasons.length > 0);
});

test('gate: lines above 0.5 are priced but not PLAY until opted in', () => {
  const hit = scoreMlbHit(batter(), pitcher(), 1.0);
  const g = gateMlbRow({ confirmed: true, slot: 1, line: 1.5, over: '+250', under: '-330', hit });
  assert.equal(g.call, 'PASS');
  assert.ok(g.reasons.includes('LINE_UNVALIDATED'));
  assert.ok(Math.abs(g.modelP - hit.pAtLeast![1]) < 1e-3);
  assert.equal(hitsNeeded(0.5), 1); assert.equal(hitsNeeded(1.5), 2); assert.equal(hitsNeeded(2.5), 3);
  assert.equal(hitsNeeded(1), null);
});

test('parlay: simulation is deterministic and EV uses the offered price', () => {
  const legs = [
    { name: 'A', team: 'X', p: 0.65, game: 1 },
    { name: 'B', team: 'X', p: 0.62, game: 1 }
  ];
  const a = simMlbCard(legs, 8000, 7)!; const b = simMlbCard(legs, 8000, 7)!;
  assert.equal(a.sim, b.sim);
  assert.equal(a.same, true);
  assert.ok(a.sim > a.indep - 0.02, 'same-team legs are not anti-correlated');
  assert.ok(a.se > 0 && a.se < 0.01);
  assert.ok(Math.abs(parlayEv(0.5, 2.2) - 0.1) < 1e-9);
  assert.ok(parlayEv(0.5, 2.2, 0.9) < parlayEv(0.5, 2.2, 1));
  const cross = simMlbCard([{ name: 'A', team: 'X', p: 0.6, game: 1 }, { name: 'B', team: 'Y', p: 0.6, game: 2 }], 4000, 1)!;
  assert.equal(cross.same, false);
});

/* ------------------------- stats parsing (mock statsapi) ------------------------- */

const batPayload = {
  person: { people: [{ batSide: { code: 'L' } }] },
  stats: {
    stats: [
      { type: { displayName: 'season' }, splits: [{ stat: { atBats: 500, hits: 140, plateAppearances: 580, baseOnBalls: 58, avg: '.280' } }] },
      { type: { displayName: 'gameLog' }, splits: Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, stat: { hits: 1, atBats: 4 } })) },
      { type: { displayName: 'statSplits' }, splits: [
        { split: { code: 'vl' }, stat: { atBats: 120, hits: 30, avg: '.250' } },
        { split: { code: 'vr' }, stat: { atBats: 380, hits: 110, avg: '.289' } }
      ] }
    ]
  }
};
const pitPayload = {
  person: { people: [{ pitchHand: { code: 'R' } }] },
  stats: {
    stats: [
      { type: { displayName: 'season' }, splits: [{ stat: { battersFaced: 700, strikeOuts: 175 } }] },
      { type: { displayName: 'gameLog' }, splits: [
        { date: '2026-09-25', stat: { gamesStarted: 1, inningsPitched: '6.0' } },
        { date: '2026-09-19', stat: { gamesStarted: 1, inningsPitched: '5.1' } },
        { date: '2026-09-13', stat: { gamesStarted: 1, inningsPitched: '4.2' } },
        { date: '2026-09-10', stat: { gamesStarted: 0, inningsPitched: '2.0' } }
      ] }
    ]
  }
};

test('stats: batter parse from counting stats, recent form, platoon splits', () => {
  const b = parseBatter(batPayload);
  assert.equal(b.hand, 'L');
  assert.ok(Math.abs(b.seasonBa! - 0.28) < 1e-9);
  assert.equal(b.seasonPa, 580);
  assert.ok(Math.abs(b.bbPct! - 0.1) < 1e-9);
  assert.equal(b.recentAb, 60); // last 15 games x 4 AB
  assert.equal(b.recentReal, true);
  assert.ok(Math.abs(b.vsLBa! - 0.25) < 1e-9 && b.vsRAb === 380);
});

test('stats: pitcher K%, hand, recent IP (starts only, thirds)', () => {
  assert.ok(Math.abs(ipToNumber('5.1')! - 5.3333) < 1e-3);
  assert.equal(ipToNumber('5.3'), undefined);
  const p = parsePitcher(pitPayload);
  assert.equal(p.hand, 'RHP');
  assert.ok(Math.abs(p.kPct! - 25) < 1e-9);
  assert.equal(p.starts, 3);
  assert.ok(Math.abs(p.recentIp! - (6 + 5.3333 + 4.6667) / 3) < 1e-2);
});

const schedGame = (withLineups: boolean) => ({
  gamePk: 777,
  gameType: 'W',
  status: { abstractGameState: 'Preview', detailedState: 'Scheduled' },
  teams: {
    away: { team: { abbreviation: 'LAD' }, probablePitcher: { id: 5, fullName: 'Away Starter' } },
    home: { team: { abbreviation: 'NYY' }, probablePitcher: { id: 6, fullName: 'Home Starter' } }
  },
  lineups: withLineups
    ? {
        awayPlayers: Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, fullName: `Away ${i + 1}` })),
        homePlayers: Array.from({ length: 9 }, (_, i) => ({ id: 200 + i, fullName: `Home ${i + 1}` }))
      }
    : undefined
});

test('schedule: no posted lineup -> no batters, no projected guesses', () => {
  const g = parseScheduleGame(schedGame(false), '2026-10-23')!;
  assert.equal(g.confirmed, false);
  assert.equal(g.batters.length, 0);
  assert.match(g.note!, /not posted/i);
});

test('schedule+stats: REAL only when batter, hand, recent form and pitcher all present', () => {
  const g = parseScheduleGame(schedGame(true), '2026-10-23')!;
  assert.equal(g.confirmed, true);
  assert.equal(g.batters.length, 18);
  assert.equal(g.batters[0].slot, 1);
  assert.equal(g.batters[9].isHome, true);
  // nothing fetched: nothing invented
  const bare = enrichGames([g], { batters: {}, pitchers: {} })[0];
  assert.ok(bare.batters.every(b => b.inputsSource === 'ESTIMATED'));
  assert.equal(batterForEngine(bare.batters[0]).seasonBa, undefined);
  // full stats for batter 100 (away leadoff) and the home starter facing him
  const full = enrichGames([g], { batters: { '100': batPayload }, pitchers: { '6': pitPayload } })[0];
  assert.equal(full.batters[0].inputsSource, 'REAL');
  assert.equal(full.batters[1].inputsSource, 'ESTIMATED');
  const hit = scoreMlbHit(batterForEngine(full.batters[0]), full.homeSp, full.park, 'W', 4.4);
  assert.equal(hit.inputsReal, true);
  // pitcher without stats keeps the whole side ESTIMATED
  const noPit = enrichGames([g], { batters: { '100': batPayload }, pitchers: {} })[0];
  assert.equal(noPit.batters[0].inputsSource, 'ESTIMATED');
});

/* ------------------------------- grading ------------------------------------ */

const box = {
  teams: {
    away: { players: { ID100: { person: { id: 100 }, stats: { batting: { hits: 2, atBats: 4, plateAppearances: 5 } } },
                      ID101: { person: { id: 101 }, stats: { batting: { hits: 0, atBats: 0, plateAppearances: 0 } } } } },
    home: { players: { ID200: { person: { id: 200 }, stats: { batting: { hits: 0, atBats: 3, plateAppearances: 4 } } } } }
  }
};
const finalSched = { dates: [{ games: [{ status: { abstractGameState: 'Final', detailedState: 'Final' } }] }] };

const row = (o: any) => ({
  date: '2026-10-22', gamePk: 777, id: 100, name: 'x', team: 'LAD', slot: 1, call: 'PLAY' as const, over: '-150', under: '+125',
  hold: 1.07, dec: 1.67, modelP: 0.66, fairP: 0.6, blendedP: 0.63, edge: 3, quality: 'REAL', hit: null, result: '', void: false, ...o
});

test('grading: only final games, real hits, DNP void, line-aware', () => {
  const res = { '777': parseBoxscore(box, finalSched) };
  const g = gradeLedger([
    row({ id: 100 }),                    // 2 hits -> win at 0.5
    row({ id: 100, line: 2.5 }),         // needs 3 -> loss
    row({ id: 100, line: 1.5 }),         // needs 2 -> win
    row({ id: 200 }),                    // 0-for-3 -> loss
    row({ id: 101 }),                    // no PA -> void
    row({ id: 999 }),                    // not in box -> void
    row({ id: 100, gamePk: 888 }),       // no result -> pending
    row({ id: 100, demo: true })         // demo rows are never graded
  ], res);
  assert.deepEqual(g.rows.map(r => r.hit), [1, 0, 1, 0, null, null, null, null]);
  assert.equal(g.rows[0].result, '2-for-4');
  assert.equal(g.rows[4].void, true);
  assert.equal(g.graded, 4); assert.equal(g.voided, 2); assert.equal(g.pending, 1);
});

test('grading: a game that is not final stays pending; postponed is void', () => {
  const live = parseBoxscore(box, { dates: [{ games: [{ status: { abstractGameState: 'Live', detailedState: 'In Progress' } }] }] });
  assert.equal(live.final, false);
  assert.equal(gradeLedger([row({})], { '777': live }).pending, 1);
  const ppd = parseBoxscore(box, { dates: [{ games: [{ status: { abstractGameState: 'Preview', detailedState: 'Postponed' } }] }] });
  const g = gradeLedger([row({})], { '777': ppd });
  assert.equal(g.rows[0].void, true);
});
