// Estimate the correlation of reception residuals between WR/TE pairs from real nflverse data.
// Residual z = (actual - mu) / sqrt(mu + alpha*mu^2), mu from the walk-forward model (no leakage).
// usage: tsx scripts/estimate_nfl_corr.ts <dataDir>   (dataDir holds the nflverse CSVs)
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, backtestNfl, normalizeNflTeam, NflverseInputs } from '../src/lib/nflverse.ts';
import { NFL_CONFIG } from '../src/model/nfl_engine.ts';

const dir = process.argv[2];
const read = (f: string) => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
const games = read('games.csv');
const load = (y: number): NflverseInputs => ({
  statsRows: read(`stats_player_week_${y}.csv`),
  snapRows: read(`snap_counts_${y}.csv`),
  playersRows: read('players.csv')
});
const y24 = load(2024), y25 = load(2025), y26 = load(2026);
const rows = [
  ...backtestNfl({ season: 2025, fromWeek: 3, toWeek: 18, current: y25, prior: y24, gamesRows: games }),
  ...backtestNfl({ season: 2026, fromWeek: 3, toWeek: 6, current: y26, prior: y25, gamesRows: games })
];

const opp = new Map<string, string>();
for (const g of games) {
  const s = Number(g.season), w = Number(g.week);
  const h = normalizeNflTeam(String(g.home_team)), a = normalizeNflTeam(String(g.away_team));
  opp.set(`${s}-${w}-${h}`, a);
  opp.set(`${s}-${w}-${a}`, h);
}

const z = (r: (typeof rows)[number]) => (r.actual - r.mu) / Math.sqrt(r.mu + ((NFL_CONFIG.alpha as any)[r.pos]) * r.mu * r.mu);
type Pair = [number, number];
const pools: Record<string, Pair[]> = { 'teammates (all)': [], 'teammates WR-WR': [], 'teammates WR-TE': [], 'opponents (all)': [] };
const byGame = new Map<string, typeof rows>();
for (const r of rows) {
  const o = opp.get(`${r.season}-${r.week}-${r.team}`);
  if (!o) continue;
  const key = `${r.season}-${r.week}-${[r.team, o].sort().join('@')}`;
  (byGame.get(key) ?? byGame.set(key, []).get(key)!).push(r);
}
for (const list of byGame.values()) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const p: Pair = [z(a), z(b)];
      if (a.team === b.team) {
        pools['teammates (all)'].push(p);
        if (a.pos === 'WR' && b.pos === 'WR') pools['teammates WR-WR'].push(p);
        else if (a.pos !== b.pos) pools['teammates WR-TE'].push(p);
      } else pools['opponents (all)'].push(p);
    }
  }
}
function corr(ps: Pair[]) {
  // symmetric pooled correlation (each pair counted in both orders)
  const xs = ps.flatMap(([a, b]) => [a, b]), ys = ps.flatMap(([a, b]) => [b, a]);
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy);
  return { r, n: ps.length, se: 1 / Math.sqrt(ps.length) };
}
console.log(`player-weeks ${rows.length}, games ${byGame.size}`);
for (const [k, ps] of Object.entries(pools)) {
  const c = corr(ps);
  console.log(`${k.padEnd(18)} rho ${c.r.toFixed(3)}  (n pairs ${c.n}, ±${(1.96 * c.se).toFixed(3)} at 95%)`);
}
