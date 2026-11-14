import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  groupOf, NBA_CONFIG, projectNbaPlayer, projectMinutes, perMinuteRate, dispersionR, linesFor, classifyNbaInputs, buildNbaTeamFactors,
  lostRotation, evaluateNbaMarket, applyNbaTuning, NBA_TUNING_DEFAULTS
} from './nba_engine.ts';
import { NBA_MARKETS, NbaPlayerSnapshot, NbaTeamFactors } from '../types/nba.ts';

const rows: any[] = JSON.parse(fs.readFileSync(new URL('./fixtures/nba_parity.json', import.meta.url), 'utf8'));
const cnt = (pts: number, reb: number, ast: number, tpm: number, stl = 0, blk = 0) => ({ pts, reb, ast, tpm, pra: pts + reb + ast, stl, blk });
const MK = ['pts', 'reb', 'ast', 'tpm', 'pra', 'stl', 'blk'] as const;

test('NBA parity: TypeScript reproduces the Python-fitted means and minutes on 300 real rows (1e-9)', () => {
  assert.ok(rows.length >= 300);
  const saved = NBA_CONFIG.fit.priors;
  let maxErr = 0;
  try {
    for (const r of rows) {
      NBA_CONFIG.fit.priors = { [r.pos]: { rate: r.prRate, min: r.prMin } } as any;
      const snap: NbaPlayerSnapshot = {
        playerId: 1, name: 'x', team: 'AAA', prevTeam: r.changer ? 'ZZZ' : 'AAA', pos: r.pos, gp: r.gp, cumMin: r.cumMin, cum: r.cum, priorGp: r.priorGp, priorMin: r.priorMin,
        prior: r.prior, recentMinutes: r.minL5 === null ? [] : [r.minL5], availability: 'ACTIVE', inputsSource: 'REAL'
      };
      const factors: NbaTeamFactors = { team: 'BBB', gp: 30, source: 'live', factor: Object.fromEntries(MK.map(m => [m, Math.exp(r.of[m])])) as any };
      const pr = projectNbaPlayer(snap, 'BBB', factors, r.L);
      assert.ok(Math.abs(pr.pm - r.pyPm) < 1e-9, `pm ${pr.pm} vs ${r.pyPm}`);
      for (const m of MK) {
        if (r.pyMu[m] < 0.06) continue;
        const e = Math.abs(pr.markets[m].mu - r.pyMu[m]) / r.pyMu[m];
        maxErr = Math.max(maxErr, e);
        assert.ok(e < 1e-9, `${m}: ts ${pr.markets[m].mu} py ${r.pyMu[m]} group ${r.group}`);
        assert.ok(Math.abs(pr.markets[m].r - r.pyR[m]) / r.pyR[m] < 1e-9, `${m} r: ts ${pr.markets[m].r} py ${r.pyR[m]}`);
      }
    }
  } finally { NBA_CONFIG.fit.priors = saved; }
  assert.ok(maxErr < 1e-9);
});

const star = (o: Partial<NbaPlayerSnapshot> = {}): NbaPlayerSnapshot => ({
  playerId: 7, name: 'Star Guard', team: 'AAA', pos: 'G', gp: 12, cumMin: 12 * 34, cum: cnt(12 * 27, 12 * 5, 12 * 7, 12 * 3, 12 * 1.2, 12 * 0.4),
  priorGp: 70, priorMin: 70 * 33, prior: cnt(70 * 26, 70 * 5, 70 * 6.5, 70 * 3, 70 * 1.1, 70 * 0.4), recentMinutes: [35, 33, 36, 34, 35],
  availability: 'ACTIVE', inputsSource: 'REAL', ...o
});

test('NBA: all four markets price with monotone probabilities and sane means', () => {
  const pr = projectNbaPlayer(star(), 'BBB', undefined, 0);
  for (const m of NBA_MARKETS) {
    const mp = pr.markets[m];
    assert.ok(mp.mu > 0 && mp.r > 0);
    const ps = mp.lines.map(l => mp.probs[l].p_over);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i] <= ps[i - 1] + 1e-12);
  }
  assert.ok(pr.markets.pts.mu > 20 && pr.markets.pts.mu < 34);
  assert.equal(pr.oppSource, 'none'); // no live table -> neutral and flagged, never invented
});

test('NBA: starters are less dispersed than bench players (r rises with projected minutes)', () => {
  for (const m of NBA_MARKETS) assert.ok(dispersionR(m, 36) > dispersionR(m, 20));
});

test('NBA: opponent factor and teammate absence move the mean in the fitted direction', () => {
  const base = projectNbaPlayer(star(), 'BBB', undefined, 0).markets.pts.mu;
  const soft: NbaTeamFactors = { team: 'BBB', gp: 20, source: 'live', factor: { pts: 1.08, reb: 1, ast: 1, tpm: 1, pra: 1, stl: 1, blk: 1 } };
  assert.ok(projectNbaPlayer(star(), 'BBB', soft, 0).markets.pts.mu > base);
  assert.ok(projectNbaPlayer(star(), 'BBB', undefined, 0.6).markets.pts.mu > base);
  applyNbaTuning({ oppScale: 0 });
  assert.ok(Math.abs(projectNbaPlayer(star(), 'BBB', soft, 0).markets.pts.mu - base) < 1e-9);
  applyNbaTuning(NBA_TUNING_DEFAULTS);
});

test('NBA: a hot 2-game start is shrunk hard (per-minute rate barely moves)', () => {
  const calm = perMinuteRate(star({ gp: 0, cumMin: 0, cum: cnt(0, 0, 0, 0) }), 'pts');
  const hot = perMinuteRate(star({ gp: 2, cumMin: 70, cum: cnt(90, 8, 10, 8) }), 'pts');
  assert.ok(hot > calm && hot < calm * 1.15);
});

test('NBA: recent minutes pull the projection (a starter benched for 5 games projects fewer minutes)', () => {
  const k = NBA_CONFIG.fit.params.pts;
  assert.ok(projectMinutes(star({ recentMinutes: [12, 10, 14, 11, 12] }), k.KM, k.W) < projectMinutes(star(), k.KM, k.W) - 5);
});

test('NBA: lines are half-lines around the mean', () => {
  const { lines, defaultLine } = linesFor('pts', 24.3);
  assert.equal(defaultLine, 24.5);
  assert.deepEqual(lines, [20.5, 22.5, 24.5, 26.5, 28.5]);
  assert.ok(linesFor('reb', 0.4).lines.every(l => l >= 0.5));
});

test('NBA: input quality — a veteran needs a live feed; a rookie needs minGamesNew games (see the v2 test)', () => {
  assert.equal(classifyNbaInputs(star(), true), 'REAL');
  assert.equal(classifyNbaInputs(star(), false), 'ESTIMATED');
  assert.equal(classifyNbaInputs(star({ gp: 2, priorGp: 0, cumMin: 40, priorMin: 0 }), true), 'ESTIMATED');
});

test('NBA: opponent table is shrunk toward the league and needs real games', () => {
  assert.deepEqual(buildNbaTeamFactors([]), {});
  const g = (team: string, pts: number) => ({ team, allowed: cnt(pts, 44, 25, 13, 7.5, 5) });
  const t = buildNbaTeamFactors([g('A', 130), g('B', 100), g('B', 100), g('C', 115)]);
  assert.ok(t.A.factor.pts > 1 && t.B.factor.pts < 1);
  assert.ok(t.A.factor.pts < 130 / 111.25); // shrunk, not raw
  assert.equal(t.A.source, 'live');
});

test('NBA: teammate absence counts only Out/Doubtful rotation players, never the player himself', () => {
  const tm = [
    { name: 'A', avgMin: 34, availability: 'OUT' as const }, { name: 'B', avgMin: 30, availability: 'DOUBTFUL' as const },
    { name: 'C', avgMin: 28, availability: 'QUESTIONABLE' as const }, { name: 'D', avgMin: 12, availability: 'OUT' as const },
    { name: 'Self', avgMin: 36, availability: 'OUT' as const }
  ];
  assert.ok(Math.abs(lostRotation(tm, 'Self') - 0.64) < 1e-9);
});

test('NBA gate: estimated, unknown-availability, unavailable, blank and one-sided rows can never be STAB/FADE', () => {
  const edge = { pOver: 0.62, pUnder: 0.38, pPush: 0, over: -110, under: -110 };
  assert.equal(evaluateNbaMarket({ ...edge, availability: 'ACTIVE', inputsSource: 'REAL' }).tag, 'STAB');
  assert.equal(evaluateNbaMarket({ ...edge, availability: 'ACTIVE', inputsSource: 'ESTIMATED' }).tag, 'PASS');
  assert.equal(evaluateNbaMarket({ ...edge, availability: 'UNKNOWN', inputsSource: 'REAL' }).tag, 'PASS');
  assert.equal(evaluateNbaMarket({ ...edge, availability: 'OUT', inputsSource: 'REAL' }).tag, 'PASS');
  assert.equal(evaluateNbaMarket({ ...edge, availability: 'DOUBTFUL', inputsSource: 'REAL' }).tag, 'PASS');
  assert.equal(evaluateNbaMarket({ pOver: 0.62, pUnder: 0.38, over: null, under: null, availability: 'ACTIVE', inputsSource: 'REAL' }).tag, 'PASS');
  // a one-sided OVER price may qualify a STAB (assumed hold), but a FADE needs a real under price
  const under = evaluateNbaMarket({ pOver: 0.35, pUnder: 0.65, over: -120, under: null, availability: 'ACTIVE', inputsSource: 'REAL' });
  assert.equal(under.tag, 'PASS');
});

test('NBA gate: EV is computed at the offered price (edge that does not survive the vig is a PASS)', () => {
  const d = evaluateNbaMarket({ pOver: 0.545, pUnder: 0.455, over: -125, under: 105, availability: 'ACTIVE', inputsSource: 'REAL', edgeMinPts: 1 });
  assert.equal(d.tag, 'PASS');
  assert.ok((d.ev ?? 0) <= 0);
});

test('NBA v2: groups, rookie gate and the pre-fitted early-season behaviour', () => {
  const rook = (o: Partial<NbaPlayerSnapshot> = {}) => star({ priorGp: 0, priorMin: 0, prior: cnt(0, 0, 0, 0), gp: 1, cumMin: 20, cum: cnt(8, 3, 2, 1), recentMinutes: [20], ...o });
  assert.equal(groupOf(star()), 'vet');
  assert.equal(groupOf(star({ prevTeam: 'AAA' })), 'vet');
  assert.equal(groupOf(star({ prevTeam: 'ZZZ' })), 'changer');
  assert.equal(groupOf(rook()), 'new');
  // rookies need minGamesNew games (default 3): 2 games => ESTIMATED, 3 => REAL; veterans are REAL at game 0
  assert.equal(classifyNbaInputs(rook({ gp: 2 }), true), 'ESTIMATED');
  assert.equal(classifyNbaInputs(rook({ gp: 3, cumMin: 60 }), true), 'REAL');
  assert.equal(classifyNbaInputs(star({ gp: 0, cumMin: 0, cum: cnt(0, 0, 0, 0), recentMinutes: [] }), true), 'REAL');
  applyNbaTuning({ minGamesNew: 8 });
  assert.equal(classifyNbaInputs(rook({ gp: 5, cumMin: 100 }), true), 'ESTIMATED');
  applyNbaTuning(NBA_TUNING_DEFAULTS);
  // a rookie's rate leans on his own games much sooner than a veteran's (smaller K multiplier), and his distribution is wider
  const hotRook = perMinuteRate(rook({ gp: 5, cumMin: 100, cum: cnt(60, 10, 12, 8) }), 'pts', 'new');
  const hotVet = perMinuteRate(rook({ gp: 5, cumMin: 100, cum: cnt(60, 10, 12, 8) }), 'pts', 'vet');
  assert.ok(Math.abs(hotRook - 0.6) < Math.abs(hotVet - 0.6));
  assert.ok(dispersionR('pts', 30, 'new') < dispersionR('pts', 30, 'vet'));
});

test('NBA v2: PRA, steals and blocks price; PRA mean is close to the sum of its parts', () => {
  const pr = projectNbaPlayer(star(), 'BBB', undefined, 0);
  const sum = pr.markets.pts.mu + pr.markets.reb.mu + pr.markets.ast.mu;
  assert.ok(Math.abs(pr.markets.pra.mu / sum - 1) < 0.06, `pra ${pr.markets.pra.mu} vs sum ${sum}`);
  assert.ok(pr.markets.stl.mu > 0.4 && pr.markets.stl.mu < 2.5 && pr.markets.blk.mu > 0.1 && pr.markets.blk.mu < 2);
  for (const m of ['pra', 'stl', 'blk'] as const) { const ps = pr.markets[m].lines.map(l => pr.markets[m].probs[l].p_over); for (let i = 1; i < ps.length; i++) assert.ok(ps[i] <= ps[i - 1] + 1e-12); }
});

test('NBA v2: absence lift is larger (in %) for a bench player than a starter', () => {
  const bench = (l: number) => projectNbaPlayer(star({ recentMinutes: [18, 17, 19, 18, 18], gp: 12, cumMin: 12 * 18, cum: cnt(12 * 8, 12 * 3, 12 * 2, 12 * 1), priorMin: 70 * 18, prior: cnt(70 * 8, 70 * 3, 70 * 2, 70 * 1) }), 'BBB', undefined, l).markets.pts.mu;
  const starter = (l: number) => projectNbaPlayer(star(), 'BBB', undefined, l).markets.pts.mu;
  assert.ok(bench(0.5) / bench(0) > starter(0.5) / starter(0));
});

import { priceNbaJoint, jointConflict, nbaLegCorrelation, measuredRho } from './nba_joint.ts';
const leg = (o: Partial<import('./nba_joint.ts').NbaJointLeg>) => ({ playerId: 1, team: 'AAA', gameId: 'G', market: 'pts' as const, mu: 24, r: 8, line: 24.5, side: 'over' as const, ...o });

test('NBA joints: same-player points + threes are positively dependent; teammates are ~independent; deterministic', () => {
  const same = priceNbaJoint([leg({}), leg({ market: 'tpm', mu: 3, r: 12, line: 2.5 })], { sims: 20000 });
  assert.ok(measuredRho('samePlayer', 'pts', 'tpm') > 0.5);
  assert.ok(same.p > same.pIndep + 0.02, `joint ${same.p} vs indep ${same.pIndep}`);
  const mates = priceNbaJoint([leg({}), leg({ playerId: 2, mu: 18, line: 17.5 })], { sims: 20000 });
  assert.ok(Math.abs(mates.p - mates.pIndep) < 0.012, `teammates ${mates.p} vs ${mates.pIndep}`);
  const other = priceNbaJoint([leg({}), leg({ playerId: 3, gameId: 'H', market: 'reb', mu: 8, r: 18, line: 7.5 })], { sims: 20000 });
  assert.ok(Math.abs(other.p - other.pIndep) < 0.012);
  assert.equal(priceNbaJoint([leg({}), leg({ market: 'tpm', mu: 3, r: 12, line: 2.5 })], { sims: 20000 }).p, same.p);
  const c = nbaLegCorrelation([leg({}), leg({ market: 'reb', mu: 5, r: 20, line: 4.5 }), leg({ playerId: 2, team: 'BBB' })]);
  assert.equal(c[0][0], 1); assert.ok(c[0][1] > 0.2); assert.ok(Math.abs(c[0][2]) < 0.06);
});

test('NBA joints: PRA with its own parts, or the same stat twice, is refused', () => {
  assert.ok(jointConflict([leg({ market: 'pra' }), leg({ market: 'reb' })]));
  assert.ok(jointConflict([leg({}), leg({ line: 30.5 })]));
  assert.equal(jointConflict([leg({ market: 'pra' }), leg({ playerId: 2, market: 'reb' })]), null);
  assert.equal(priceNbaJoint([leg({ market: 'pra' }), leg({ market: 'reb' })]).conflict !== null, true);
});
