// Validate the NFL receptions simulator on real games (walk-forward mu from the v1.5 backtest rows).
// usage: tsx scripts/validate_gamesim_nfl.ts bt_rows.csv
import fs from 'node:fs';
import { simulateNflTeam, simJoint } from '../src/model/gamesim.ts';
import { effectiveAlpha } from '../src/model/nfl_engine.ts';
import { hashUnit } from '../src/model/calibration.ts';
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n'); const hdr = lines[0].split(',');
const rows = lines.slice(1).map(l => { const m = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map(x => x.replace(/,$/, '').replace(/^"|"$/g, '')); const o: any = {}; hdr.forEach((h, i) => (o[h] = m[i])); return o; });
const by = new Map<string, any[]>(); rows.forEach(r => { const k = `${r.season}|${r.week}|${r.team}`; (by.get(k) || by.set(k, []).get(k)!).push(r); });
const SIMS = 4000; let cov = { 50: 0, 80: 0, 90: 0 }, nPit = 0; const acc: any = { pair: { n: 0, ps: 0, pi: 0, y: 0, bs: 0, bi: 0 } };
let corrNum = 0, corrDen = 0, pairs = 0, simCorrNum = 0;
let gi = 0;
for (const [k, g] of by) {
  if (g.length < 2) continue; gi++;
  const pl = g.map((r, i) => ({ id: String(i), mu: Math.max(0.2, +r.mu), catchRate: 0.656, alpha: effectiveAlpha(r.pos, +r.games) }));
  const sim = simulateNflTeam({ players: pl, sims: SIMS, seed: 900 + gi });
  const D = pl.map(p => sim.draws[p.id].rec!);
  // randomized PIT of the actual under the SIMULATED marginal
  g.forEach((r, i) => {
    let lo = 0, eq = 0; const a = +r.actual; for (let s = 0; s < SIMS; s++) { if (D[i][s] < a) lo++; else if (D[i][s] === a) eq++; }
    const u = (lo + hashUnit(`${k}|${i}|${r.name}`) * eq) / SIMS; nPit++; // randomized PIT (mid-PIT over-covers on counts)
    for (const [lv, key] of [[0.5, 50], [0.8, 80], [0.9, 90]] as const) if (u > (1 - lv) / 2 && u < 1 - (1 - lv) / 2) (cov as any)[key]++;
  });
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const li = Math.floor(pl[i].mu) + 0.5, lj = Math.floor(pl[j].mu) + 0.5;
    const r = simJoint([{ draws: D[i], line: li, side: 'over' }, { draws: D[j], line: lj, side: 'over' }]);
    const y = +g[i].actual > li && +g[j].actual > lj ? 1 : 0; const a = acc.pair; a.n++; a.ps += r.p; a.pi += r.pIndep; a.y += y; a.bs += (r.p - y) ** 2; a.bi += (r.pIndep - y) ** 2;
  }
}
console.log(`team-weeks ${gi}  players ${nPit}`);
console.log(`simulated-marginal PIT coverage 50/80/90: ${(cov[50] / nPit * 100).toFixed(1)} / ${(cov[80] / nPit * 100).toFixed(1)} / ${(cov[90] / nPit * 100).toFixed(1)}`);
const a = acc.pair;
console.log(`teammate pairs both OVER floor(mu)+.5: n=${a.n} actual ${(a.y / a.n * 100).toFixed(2)}%  sim ${(a.ps / a.n * 100).toFixed(2)}%  indep ${(a.pi / a.n * 100).toFixed(2)}%  Brier sim ${(a.bs / a.n).toFixed(5)} indep ${(a.bi / a.n).toFixed(5)}  delta ${((a.bs - a.bi) / a.n).toFixed(6)}`);
