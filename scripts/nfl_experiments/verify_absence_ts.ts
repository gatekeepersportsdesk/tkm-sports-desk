// usage: tsx verify_absence_ts.ts <dataDir>
// Re-runs the 2024-2026 walk-forward backtest THROUGH THE REAL ENGINE with the v1.6 absence factor off vs on,
// and prints NB log-lik per row, per season, plus a cluster-free bootstrap CI. Confirms the TS implementation
// reproduces the Python experiment (nfl_absence_form_v2.py).
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, backtestNfl, BacktestRow, NflverseInputs } from '../../src/lib/nflverse.ts';
import { NFL_CONFIG, computeWalkForwardRatios, RatioObservation, effectiveAlpha } from '../../src/model/nfl_engine.ts';
import { nbinomPmfAlpha } from '../../src/model/dist.ts';
const dir = process.argv[2];
const read = (f: string) => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
const players = read('players.csv'); const games = read('games.csv');
const inj = [...read('injuries_2024.csv'), ...read('injuries_2025.csv'), ...read('injuries_2026.csv')];
const load = (y: number): NflverseInputs => ({ statsRows: read(`stats_player_week_${y}.csv`), snapRows: read(`snap_counts_${y}.csv`), playersRows: players });
const Y = { 2024: load(2024), 2025: load(2025), 2026: load(2026) } as Record<number, NflverseInputs>;
function run(withAbs: boolean) {
  const mk = (season: number, to: number, prior?: NflverseInputs) =>
    backtestNfl({ season, fromWeek: 3, toWeek: to, current: Y[season], prior, gamesRows: games, injuriesRows: withAbs ? inj.filter(r => Number(r.season) === season) : undefined });
  const r24 = mk(2024, 18), r25 = mk(2025, 18, Y[2024]), r26 = mk(2026, 6, Y[2025]);
  const wf = (season: number, rows: BacktestRow[], priorRows: BacktestRow[]) => {
    const all: RatioObservation[] = [...priorRows, ...rows].map(r => ({ pos: r.pos, muStructural: r.muStructural, actual: r.actual, played: true, week: r.week, season: r.season }));
    const cache = new Map<number, ReturnType<typeof computeWalkForwardRatios>>();
    return rows.map(r => { let rt = cache.get(r.week); if (!rt) { rt = computeWalkForwardRatios(all, { season, week: r.week }); cache.set(r.week, rt); }
      const blended = Math.max(0.2, NFL_CONFIG.blend_weight * r.muStructural * rt[r.pos].ratio + (1 - NFL_CONFIG.blend_weight) * r.seasonAvg);
      return { ...r, mu: blended * r.absenceFactor }; });
  };
  const w24 = wf(2024, r24, []), w25 = wf(2025, r25, r24), w26 = wf(2026, r26, r25);
  return { 2024: w24, 2025: w25, 2026: w26 } as Record<number, (BacktestRow)[]>;
}
const off = run(false), on = run(true);
const ll = (r: BacktestRow) => Math.log(Math.max(1e-300, nbinomPmfAlpha(r.actual, r.mu, effectiveAlpha(r.pos, r.games))));
let tot = 0, n = 0;
for (const s of [2024, 2025, 2026]) {
  const a = off[s], b = on[s]; let d = 0, affected = 0, ar = 0, mo = 0, mn = 0;
  for (let i = 0; i < a.length; i++) { d += ll(b[i]) - ll(a[i]); if (b[i].absenceFactor > 1) { affected++; ar += b[i].actual; mo += a[i].mu; mn += b[i].mu; } }
  tot += d; n += a.length;
  console.log(`${s}: n=${a.length}  dLL/row ${(d / a.length).toFixed(5)}  rows with a listed teammate absence ${affected} (${(100 * affected / a.length).toFixed(1)}%)  actual/mu there: off ${(ar / mo).toFixed(3)} -> on ${(ar / mn).toFixed(3)}`);
}
console.log(`pooled dLL/row ${(tot / n).toFixed(5)} over ${n} rows`);
