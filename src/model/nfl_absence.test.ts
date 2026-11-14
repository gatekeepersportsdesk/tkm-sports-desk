import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAbsenceLoad } from '../lib/nflverse.ts';
import { computeStructuralMu, NFL_CONFIG } from './nfl_engine.ts';

const stat = (pid: string, name: string, team: string, week: number, targets: number, season = 2026) =>
  ({ player_id: pid, player_display_name: name, team, week: String(week), season: String(season), season_type: 'REG', targets: String(targets) });
const inj = (pid: string, status: string, week = 5, season = 2026) => ({ gsis_id: pid, report_status: status, week: String(week), season: String(season) });
const base = () => {
  const rows: any[] = [];
  for (let w = 1; w <= 4; w++) rows.push(stat('p1', 'Alpha One', 'KC', w, 8), stat('p2', 'Beta Two', 'KC', w, 6), stat('p3', 'Gamma Three', 'KC', w, 4), stat('p4', 'Delta Four', 'KC', w, 2));
  return rows;
};

test('absence: an Out receiver redistributes his share; the formula is -ln(1-L)', () => {
  const r = computeAbsenceLoad({ season: 2026, week: 5, statsRows: base(), injuriesRows: [inj('p1', 'Out')] });
  const L = 8 / (8 + 6 + 4); // p4 averages 2 targets: below the 3.0 threshold, so he is not in the pool
  assert.ok(Math.abs(r.KC.lostShare - L) < 1e-9);
  assert.ok(Math.abs(r.KC.g - -Math.log(1 - L)) < 1e-9);
  assert.deepEqual(r.KC.names, ['Alpha One']);
});

test('absence: Doubtful counts, Questionable and Probable do not', () => {
  assert.ok(computeAbsenceLoad({ season: 2026, week: 5, statsRows: base(), injuriesRows: [inj('p2', 'Doubtful')] }).KC.lostShare > 0);
  const none = computeAbsenceLoad({ season: 2026, week: 5, statsRows: base(), injuriesRows: [inj('p1', 'Questionable'), inj('p2', 'Probable')] });
  assert.equal(Object.keys(none).length, 0);
});

test('absence: no leakage — stats from the target week or later, other seasons and other weeks of the report are ignored', () => {
  const rows = [...base(), stat('p9', 'Leak Guy', 'KC', 5, 20), stat('p9', 'Leak Guy', 'KC', 6, 20), ...[1, 2, 3, 4].map(w => stat('p8', 'Old Season', 'KC', w, 15, 2025))];
  const r = computeAbsenceLoad({ season: 2026, week: 5, statsRows: rows, injuriesRows: [inj('p1', 'Out'), inj('p9', 'Out'), inj('p8', 'Out'), inj('p2', 'Out', 6), inj('p3', 'Out', 5, 2025)] });
  assert.ok(Math.abs(r.KC.lostShare - 8 / 18) < 1e-9, `got ${r.KC.lostShare}`);
});

test('absence: a player who has not played within the window, or has under 3 prior games, is not counted', () => {
  const stale = [stat('p5', 'Long Gone', 'KC', 1, 9), stat('p5', 'Long Gone', 'KC', 2, 9), stat('p5', 'Long Gone', 'KC', 3, 9)];
  const r1 = computeAbsenceLoad({ season: 2026, week: 9, statsRows: [...base(), ...stale], injuriesRows: [inj('p5', 'Out', 9)] });
  assert.equal(Object.keys(r1).length, 0);
  const thin = [stat('p6', 'Rookie', 'KC', 3, 9), stat('p6', 'Rookie', 'KC', 4, 9)];
  assert.equal(Object.keys(computeAbsenceLoad({ season: 2026, week: 5, statsRows: [...base(), ...thin], injuriesRows: [inj('p6', 'Out')] })).length, 0);
});

test('absence: lost share is clipped at the configured maximum', () => {
  const r = computeAbsenceLoad({ season: 2026, week: 5, statsRows: base(), injuriesRows: [inj('p1', 'Out'), inj('p2', 'Out'), inj('p3', 'Out')] });
  assert.equal(r.KC.lostShare, NFL_CONFIG.absence_clip_share);
});

test('absence: engine factor = exp(coef*g), capped, and absent/NaN input means no change', () => {
  const stats = { routes: 200, season_tprr: 0.2, prior_tprr: 0.2, receptions: 50, targets: 75, route_pct: 0.85, walk_forward_ratio: 1, season_avg_receptions: 5 };
  const game = { spread: -3, implied_total: 24 };
  const none = computeStructuralMu(stats, game);
  assert.equal(none.absenceFactor, 1);
  assert.equal(computeStructuralMu({ ...stats, absence_g: Number.NaN }, game).absenceFactor, 1);
  assert.equal(computeStructuralMu({ ...stats, absence_g: -2 }, game).absenceFactor, 1);
  const g = 0.5; const withAbs = computeStructuralMu({ ...stats, absence_g: g }, game);
  assert.ok(Math.abs(withAbs.absenceFactor - Math.exp(NFL_CONFIG.absence_coef * g)) < 1e-9);
  assert.ok(Math.abs(withAbs.finalMu / none.finalMu - withAbs.absenceFactor) < 1e-9);
  assert.equal(computeStructuralMu({ ...stats, absence_g: 50 }, game).absenceFactor, NFL_CONFIG.absence_max_factor);
});
