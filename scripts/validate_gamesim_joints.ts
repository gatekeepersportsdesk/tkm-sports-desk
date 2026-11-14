// Do simulated JOINT probabilities predict real outcomes better than independence?
// usage: tsx scripts/validate_gamesim_joints.ts rosters.json
// For every real team-game, the sim (means from the walk-forward fit) prices:
//   A same-skater  shots>=3 & points>=1          B same-skater shots<=1 & points=0 (under/under)
//   C teammate pair  skater i points>=1 & skater j points>=1 (random distinct pair)
//   D teammate pair  skater i shots>=3 & skater j shots>=3
// and we score Brier / reliability of sim vs the product of the sim's own marginals (independence).
import fs from 'node:fs';
import { simulateNhlGame, NhlSimSkater } from '../src/model/gamesim.ts';
const rosters: { ms: number[]; mp: number[]; shots: number[]; points: number[] }[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const R_S = 16, R_P = 36;
type Acc = { n: number; ps: number; pi: number; y: number; bs: number; bi: number };
const acc: Record<string, Acc> = {};
const add = (k: string, ps: number, pi: number, y: number) => { const a = (acc[k] ||= { n: 0, ps: 0, pi: 0, y: 0, bs: 0, bi: 0 }); a.n++; a.ps += ps; a.pi += pi; a.y += y; a.bs += (ps - y) ** 2; a.bi += (pi - y) ** 2; };
const SIMS = 4000;
rosters.forEach((t, gi) => {
  const sk: NhlSimSkater[] = t.ms.map((ms, i) => ({ id: i, team: 'A', sogMu: ms, sogR: R_S, ptsMu: t.mp[i], ptsR: R_P }));
  const sim = simulateNhlGame(sk, { sims: SIMS, seed: 5000 + gi });
  const S = sk.map((_, i) => sim.counts.get(`${i}|sog`)!), P = sk.map((_, i) => sim.counts.get(`${i}|pts`)!);
  const prob = (f: (s: number) => boolean) => { let c = 0; for (let s = 0; s < SIMS; s++) if (f(s)) c++; return c / SIMS; };
  const n = sk.length;
  for (let i = 0; i < n; i++) {
    const pa = prob(s => S[i][s] >= 3 && P[i][s] >= 1), pa1 = prob(s => S[i][s] >= 3), pa2 = prob(s => P[i][s] >= 1);
    add('A same-skater SOG>=3 & PTS>=1', pa, pa1 * pa2, t.shots[i] >= 3 && t.points[i] >= 1 ? 1 : 0);
    const pb = prob(s => S[i][s] <= 1 && P[i][s] === 0), pb1 = prob(s => S[i][s] <= 1), pb2 = prob(s => P[i][s] === 0);
    add('B same-skater SOG<=1 & PTS=0', pb, pb1 * pb2, t.shots[i] <= 1 && t.points[i] === 0 ? 1 : 0);
  }
  // teammate pairs: all distinct pairs among the first 12 skaters (deterministic, no cherry-picking)
  for (let i = 0; i < Math.min(n, 12); i++) for (let j = i + 1; j < Math.min(n, 12); j++) {
    const pc = prob(s => P[i][s] >= 1 && P[j][s] >= 1), ci = prob(s => P[i][s] >= 1) * prob(s => P[j][s] >= 1);
    add('C teammates both PTS>=1', pc, ci, t.points[i] >= 1 && t.points[j] >= 1 ? 1 : 0);
    const pd = prob(s => S[i][s] >= 3 && S[j][s] >= 3), di = prob(s => S[i][s] >= 3) * prob(s => S[j][s] >= 3);
    add('D teammates both SOG>=3', pd, di, t.shots[i] >= 3 && t.shots[j] >= 3 ? 1 : 0);
  }
});
for (const [k, a] of Object.entries(acc)) {
  console.log(`${k.padEnd(34)} n=${String(a.n).padStart(6)}  actual ${(a.y / a.n * 100).toFixed(2)}%  sim ${(a.ps / a.n * 100).toFixed(2)}%  indep ${(a.pi / a.n * 100).toFixed(2)}%   Brier sim ${(a.bs / a.n).toFixed(5)}  indep ${(a.bi / a.n).toFixed(5)}  (negative = sim better) delta ${((a.bs - a.bi) / a.n).toFixed(6)}`);
}
