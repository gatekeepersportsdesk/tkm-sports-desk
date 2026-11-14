// Out-of-model check on REAL team-games: does the simulator predict the spread of TEAM totals better than independence?
// For each roster: z = (actual team total - sum of means) / sd, where sd comes from (a) the simulator, (b) independent NB sums.
// A calibrated model gives mean z^2 ~ 1 (a bit above 1 is expected: the means themselves carry estimation error).
import fs from 'node:fs';
import { simulateNhlGame, NhlSimSkater } from '../src/model/gamesim.ts';
const rosters: { ms: number[]; mp: number[]; shots: number[]; points: number[] }[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const R_S = 16, R_P = 36;
const acc = { shots: { sim: 0, ind: 0, hitSim: 0, hitInd: 0 }, points: { sim: 0, ind: 0, hitSim: 0, hitInd: 0 } };
let n = 0;
rosters.forEach((t, gi) => {
  const sk: NhlSimSkater[] = t.ms.map((ms, i) => ({ id: i, team: 'A', sogMu: ms, sogR: R_S, ptsMu: t.mp[i], ptsR: R_P }));
  const sim = simulateNhlGame(sk, { sims: 4000, seed: 77 + gi });
  for (const [mk, key, mus, r] of [['sog', 'shots', t.ms, R_S], ['pts', 'points', t.mp, R_P]] as const) {
    const tot = new Float64Array(sim.sims);
    sk.forEach((_, i) => { const x = sim.counts.get(`${i}|${mk}`)!; for (let k = 0; k < sim.sims; k++) tot[k] += x[k]; });
    let m = 0; tot.forEach(v => m += v); m /= sim.sims; let v = 0; tot.forEach(x => v += (x - m) ** 2); v /= sim.sims - 1;
    const meanSum = mus.reduce((a, b) => a + b, 0), indVar = mus.reduce((a, mu) => a + mu + mu * mu / r, 0);
    const actual = (t as any)[key].reduce((a: number, b: number) => a + b, 0);
    const zs = (actual - meanSum) / Math.sqrt(v), zi = (actual - meanSum) / Math.sqrt(indVar);
    const a = acc[key]; a.sim += zs * zs; a.ind += zi * zi; a.hitSim += Math.abs(zs) < 1.2816 ? 1 : 0; a.hitInd += Math.abs(zi) < 1.2816 ? 1 : 0;
  }
  n++;
});
for (const k of ['shots', 'points'] as const) {
  const a = acc[k];
  console.log(`${k}: mean z^2 simulator ${(a.sim / n).toFixed(3)}  vs independent ${(a.ind / n).toFixed(3)}   | actual inside the 80% band: simulator ${(a.hitSim / n * 100).toFixed(1)}%  independent ${(a.hitInd / n * 100).toFixed(1)}%   (n=${n} real team-games)`);
}
