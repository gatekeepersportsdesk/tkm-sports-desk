// Backtest harness for the NFL receptions model on real nflverse data.
// usage: tsx backtest_nfl.ts <dataDir>
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, backtestNfl, BacktestRow, NflverseInputs } from '../src/lib/nflverse.ts';
import { calculateDiscreteLineProbs, conditionalProbs, NFL_CONFIG } from '../src/model/nfl_engine.ts';
import { nbinomPmfAlpha } from '../src/model/dist.ts';
import { discretePit, hashUnit, pitCoverage, summarizeCalibration } from '../src/model/calibration.ts';

const dir = process.argv[2];
const read = (f: string) => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
const players = read('players.csv');
const games = read('games.csv');
const load = (y: number): NflverseInputs => ({
  statsRows: read(`stats_player_week_${y}.csv`),
  snapRows: read(`snap_counts_${y}.csv`),
  playersRows: players
});
const y24 = load(2024), y25 = load(2025), y26 = load(2026);

function report(label: string, rows: BacktestRow[], alphaOverride?: Record<string, number>) {
  const alphaFor = (pos: string) => alphaOverride?.[pos] ?? (NFL_CONFIG.alpha as any)[pos];
  const sumA = rows.reduce((s, r) => s + r.actual, 0);
  const sumM = rows.reduce((s, r) => s + r.mu, 0);
  const sumS = rows.reduce((s, r) => s + r.muStructural, 0);
  console.log(`\n== ${label}  n=${rows.length}`);
  console.log(`   mean actual ${(sumA / rows.length).toFixed(3)}  mean mu ${(sumM / rows.length).toFixed(3)}  actual/mu ${(sumA / sumM).toFixed(3)}  actual/muStructural ${(sumA / sumS).toFixed(3)}`);
  for (const pos of ['WR', 'TE'] as const) {
    const rs = rows.filter(r => r.pos === pos);
    if (!rs.length) continue;
    const a = rs.reduce((s, r) => s + r.actual, 0), m = rs.reduce((s, r) => s + r.mu, 0), st = rs.reduce((s, r) => s + r.muStructural, 0);
    console.log(`   ${pos} n=${rs.length} actual/mu ${(a / m).toFixed(3)} actual/muStructural ${(a / st).toFixed(3)}`);
  }
  // PIT coverage under NB
  const pits = rows.map(r => {
    const pmf = (k: number) => nbinomPmfAlpha(k, r.mu, alphaFor(r.pos));
    return discretePit(pmf, r.actual, hashUnit(`${r.name}${r.week}${r.season}`));
  });
  console.log('   PIT coverage', pitCoverage(pits).map((c: any) => `${c.level}: ${(c.observed! * 100).toFixed(1)}%`).join('  '));
  // reliability on near-median half lines
  const preds = rows.map(r => {
    const line = Math.floor(r.mu) + 0.5;
    const pr = calculateDiscreteLineProbs(r.mu, line, alphaFor(r.pos));
    const c = conditionalProbs(pr.p_over, pr.p_under);
    return { p: c.over, y: (r.actual > line ? 1 : 0) as 0 | 1 };
  });
  const cal = summarizeCalibration(preds);
  console.log(`   near-median lines: meanP ${(cal.meanP! * 100).toFixed(1)}%  hit ${(cal.hitRate! * 100).toFixed(1)}%  gap ${(cal.gap! * 100).toFixed(1)}pts  brier ${cal.brier!.toFixed(4)}`);
  const base = preds.reduce((s, r) => s + r.y, 0) / preds.length;
  const brierNaive = preds.reduce((s, r) => s + (base - r.y) ** 2, 0) / preds.length;
  console.log(`   brier vs base-rate-constant ${brierNaive.toFixed(4)}`);
  cal.bins.filter((b: any) => b.n > 0).forEach((b: any) => console.log(`     [${b.lo.toFixed(1)},${b.hi.toFixed(1)}) n=${b.n} meanP ${(b.meanP! * 100).toFixed(1)} hit ${(b.hitRate! * 100).toFixed(1)}`));
}

const bt25 = backtestNfl({ season: 2025, fromWeek: 3, toWeek: 18, current: y25, prior: y24, gamesRows: games });
report('2025 weeks 3-18 (prior = 2024)', bt25);
const bt26 = backtestNfl({ season: 2026, fromWeek: 3, toWeek: 6, current: y26, prior: y25, gamesRows: games });
report('2026 weeks 3-6 (prior = 2025)', bt26);

// ---------- walk-forward ratios + dispersion diagnostics ----------
import { computeWalkForwardRatios, RatioObservation } from '../src/model/nfl_engine.ts';

function withWalkForward(season: number, rows: BacktestRow[], priorRows: BacktestRow[]) {
  const all: RatioObservation[] = [...priorRows, ...rows].map(r => ({ pos: r.pos, muStructural: r.muStructural, actual: r.actual, played: true, week: r.week, season: r.season }));
  const cache = new Map<number, ReturnType<typeof computeWalkForwardRatios>>();
  return rows.map(r => {
    let rt = cache.get(r.week);
    if (!rt) { rt = computeWalkForwardRatios(all, { season, week: r.week }); cache.set(r.week, rt); }
    const ratio = rt[r.pos].ratio;
    const mu = Math.max(0.2, NFL_CONFIG.blend_weight * r.muStructural * ratio + (1 - NFL_CONFIG.blend_weight) * r.seasonAvg);
    return { ...r, mu };
  });
}
const bt24 = backtestNfl({ season: 2024, fromWeek: 3, toWeek: 18, current: y24, gamesRows: games });
const bt25wf = withWalkForward(2025, bt25, bt24);
report('2025 WALK-FORWARD ratios (prior season replay + in-season)', bt25wf);
const bt26wf = withWalkForward(2026, bt26, bt25);
report('2026 WALK-FORWARD ratios', bt26wf);

function pitByGames(label: string, rows: BacktestRow[]) {
  console.log(`\n-- PIT 80% coverage by games played (${label})`);
  for (const [lo, hi] of [[2, 3], [4, 5], [6, 9], [10, 18]]) {
    const rs = rows.filter(r => r.games >= lo && r.games <= hi);
    if (rs.length < 30) continue;
    const pits = rs.map(r => discretePit((k: number) => nbinomPmfAlpha(k, r.mu, (NFL_CONFIG.alpha as any)[r.pos]), r.actual, hashUnit(`${r.name}${r.week}${r.season}`)));
    const c = pitCoverage(pits, [0.8, 0.9]);
    console.log(`   games ${lo}-${hi} n=${rs.length}: 80% -> ${(c[0].observed! * 100).toFixed(1)}%  90% -> ${(c[1].observed! * 100).toFixed(1)}%`);
  }
}
pitByGames('2025', bt25wf);
pitByGames('2026', bt26wf);

// alpha MLE by position over a grid
function alphaMle(rows: BacktestRow[]) {
  for (const pos of ['WR', 'TE'] as const) {
    const rs = rows.filter(r => r.pos === pos);
    let best = { a: 0, ll: -Infinity };
    for (let a = 0.02; a <= 0.4; a += 0.01) {
      const ll = rs.reduce((s, r) => s + Math.log(Math.max(1e-12, nbinomPmfAlpha(r.actual, r.mu, a))), 0);
      if (ll > best.ll) best = { a, ll };
    }
    console.log(`   alpha MLE ${pos}: ${best.a.toFixed(2)} (config ${(NFL_CONFIG.alpha as any)[pos]})  n=${rs.length}`);
  }
}
console.log('\n-- alpha MLE (2025 walk-forward mu)'); alphaMle(bt25wf);
console.log('-- alpha MLE (2024+2025+2026 pooled)'); alphaMle([...withWalkForward(2024, bt24, []), ...bt25wf, ...bt26wf]);

// ---------- decay-weighted ratios: compare schemes on both seasons ----------
function ratiosDecay(season: number, rows: BacktestRow[], priorRows: BacktestRow[], halfLife: number, priorWeight: number) {
  const allObs = [...priorRows.map(r => ({ ...r, age0: (r.season - season) * 18 + r.week })), ...rows.map(r => ({ ...r, age0: r.week }))];
  const out = new Map<number, Record<string, number>>();
  const weeks = [...new Set(rows.map(r => r.week))];
  for (const w of weeks) {
    const rec: Record<string, number> = {};
    for (const pos of ['WR', 'TE'] as const) {
      let sa = 0, sp = 0;
      for (const o of allObs) {
        if (o.pos !== pos || o.age0 >= w) continue;
        const age = w - o.age0;
        const wt = (o.season < season ? priorWeight : 1) * Math.pow(0.5, age / halfLife);
        sa += wt * o.actual; sp += wt * o.muStructural;
      }
      const prior = (NFL_CONFIG.ratio_prior as any)[pos];
      const n = sp; // effective pseudo-count scale (sum of weighted mu)
      const k = 40 * 2.2; // ~ ratio_k obs * mean mu
      const raw = sp > 0 ? sa / sp : prior;
      const shrunk = prior + (n / (n + k)) * (raw - prior);
      rec[pos] = Math.min(1.15, Math.max(0.85, shrunk));
    }
    out.set(w, rec);
  }
  return rows.map(r => {
    const ratio = out.get(r.week)![r.pos];
    return { ...r, mu: Math.max(0.2, NFL_CONFIG.blend_weight * r.muStructural * ratio + (1 - NFL_CONFIG.blend_weight) * r.seasonAvg) };
  });
}
function quick(label: string, rows: BacktestRow[]) {
  const a = rows.reduce((s, r) => s + r.actual, 0), m = rows.reduce((s, r) => s + r.mu, 0);
  const ll = rows.reduce((s, r) => s + Math.log(Math.max(1e-12, nbinomPmfAlpha(r.actual, r.mu, (NFL_CONFIG.alpha as any)[r.pos]))), 0) / rows.length;
  const preds = rows.map(r => { const line = Math.floor(r.mu) + 0.5; const pr = calculateDiscreteLineProbs(r.mu, line, (NFL_CONFIG.alpha as any)[r.pos]); return { p: conditionalProbs(pr.p_over, pr.p_under).over, y: (r.actual > line ? 1 : 0) as 0 | 1 }; });
  const cal = summarizeCalibration(preds);
  console.log(`   ${label.padEnd(34)} actual/mu ${(a / m).toFixed(3)}  meanLL ${ll.toFixed(4)}  gap ${(cal.gap! * 100).toFixed(1)}pts  brier ${cal.brier!.toFixed(4)}`);
}
console.log('\n-- ratio schemes (2025 | 2026)');
quick('none (ratio prior only) 2025', bt25); quick('none (ratio prior only) 2026', bt26);
for (const [H, PW] of [[4, 0.0], [6, 0.0], [8, 0.0], [8, 0.3], [12, 0.3], [1e9, 1.0]] as [number, number][]) {
  quick(`H=${H} priorW=${PW} 2025`, ratiosDecay(2025, bt25, bt24, H, PW));
  quick(`H=${H} priorW=${PW} 2026`, ratiosDecay(2026, bt26, bt25, H, PW));
}

// ---------- dispersion grid on decay-ratio mu (pooled 2024-2026) ----------
{
  const r24 = ratiosDecay(2024, bt24, [], 6, 0);
  const r25 = ratiosDecay(2025, bt25, bt24, 6, 0);
  const r26 = ratiosDecay(2026, bt26, bt25, 6, 0);
  const pooled = [...r24, ...r25, ...r26];
  console.log('\n-- dispersion grid: alpha_eff = alpha*(1 + c/games), pooled n=' + pooled.length);
  for (const pos of ['WR', 'TE'] as const) {
    const rs = pooled.filter(r => r.pos === pos);
    let best = { a: 0, c: 0, ll: -Infinity };
    for (let a = 0.04; a <= 0.3; a += 0.01) for (const c of [0, 0.5, 1, 2, 3, 4]) {
      const ll = rs.reduce((s, r) => s + Math.log(Math.max(1e-12, nbinomPmfAlpha(r.actual, r.mu, a * (1 + c / r.games)))), 0);
      if (ll > best.ll) best = { a, c, ll };
    }
    const base = rs.reduce((s, r) => s + Math.log(Math.max(1e-12, nbinomPmfAlpha(r.actual, r.mu, (NFL_CONFIG.alpha as any)[pos]))), 0);
    console.log(`   ${pos}: best alpha ${best.a.toFixed(2)} c ${best.c}  LL/row ${(best.ll / rs.length).toFixed(4)} vs config ${(base / rs.length).toFixed(4)}`);
  }
  const cfg = { WR: 0.14, TE: 0.17, c: 2 };
  for (const [label, rows] of [['2025', r25], ['2026', r26]] as [string, any[]][]) {
    for (const [lo, hi] of [[2, 3], [4, 5], [6, 9], [10, 18]]) {
      const rs = rows.filter(r => r.games >= lo && r.games <= hi);
      if (rs.length < 30) continue;
      const pits = rs.map(r => discretePit((k: number) => nbinomPmfAlpha(k, r.mu, (cfg as any)[r.pos] * (1 + cfg.c / r.games)), r.actual, hashUnit(`${r.name}${r.week}${r.season}`)));
      const c2 = pitCoverage(pits, [0.8, 0.9]);
      console.log(`   cfg(WR .14 TE .17 c 2) ${label} games ${lo}-${hi} n=${rs.length}: 80% -> ${(c2[0].observed! * 100).toFixed(1)}  90% -> ${(c2[1].observed! * 100).toFixed(1)}`);
    }
  }
}
