// Solve pointsTeamLoading and verify the simulator against REAL MoneyPuck rosters.
// usage: tsx scripts/calibrate_gamesim.ts <rosters.json>   (rosters.json from the python dump of 400 real team-games)
import fs from 'node:fs';
import { simulateNhlGame, NhlSimSkater } from '../src/model/gamesim.ts';
import { nbCdfTable } from '../src/model/sampler.ts';
const rosters: { ms: number[]; mp: number[]; shots: number[]; points: number[] }[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const R_S = 16, R_P = 36;
const sample = rosters.slice(0, 120);
function measure(b: number, sims = 2500) {
  let numS = 0, numP = 0, den = 0, varRatioS = 0, varRatioP = 0, nVar = 0, calOK = 0;
  sample.forEach((t, gi) => {
    const sk: NhlSimSkater[] = t.ms.map((ms, i) => ({ id: i, team: 'A', sogMu: ms, sogR: R_S, ptsMu: t.mp[i], ptsR: R_P }));
    const sim = simulateNhlGame(sk, { sims, seed: 1000 + gi, pointsTeamLoading: b, rhoShotsPoints: 0.276 });
    if (sim.calibration.A.exact) calOK++;
    const zs: Float64Array[] = [], zp: Float64Array[] = [];
    sk.forEach((s, i) => {
      for (const [mk, mu, r, arr] of [['sog', s.sogMu, R_S, zs], ['pts', s.ptsMu!, R_P, zp]] as const) {
        const x = sim.counts.get(`${i}|${mk}`)!; const sd = Math.sqrt(mu + mu * mu / r);
        const z = new Float64Array(x.length); let m = 0; for (let k = 0; k < x.length; k++) { z[k] = (x[k] - mu) / sd; m += z[k]; }
        arr.push(z);
        let v = 0; for (let k = 0; k < x.length; k++) v += (x[k] - m / x.length * sd - mu) ** 2; // not used
      }
      const xs = sim.counts.get(`${i}|sog`)!, xp = sim.counts.get(`${i}|pts`)!;
      let ms = 0, mp = 0; for (let k = 0; k < sims; k++) { ms += xs[k]; mp += xp[k]; } ms /= sims; mp /= sims;
      let vs = 0, vp = 0; for (let k = 0; k < sims; k++) { vs += (xs[k] - ms) ** 2; vp += (xp[k] - mp) ** 2; }
      varRatioS += (vs / sims) / (s.sogMu + s.sogMu ** 2 / R_S); varRatioP += (vp / sims) / (s.ptsMu! + s.ptsMu! ** 2 / R_P); nVar++;
    });
    const n = sk.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
      let a = 0, c = 0; for (let k = 0; k < sims; k++) { a += zs[i][k] * zs[j][k]; c += zp[i][k] * zp[j][k]; }
      numS += a / sims; numP += c / sims; den++;
    }
  });
  return { corrShots: numS / den, corrPts: numP / den, varRatioShots: varRatioS / nVar, varRatioPts: varRatioP / nVar, exactShare: calOK / sample.length };
}
const target = 0.0962;
let lo = 0, hi = 0.6;
for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; const m = measure(mid); if (m.corrPts < target) lo = mid; else hi = mid; }
const b = (lo + hi) / 2;
const final = measure(b, 6000);
console.log(JSON.stringify({ pointsTeamLoading: +b.toFixed(3), ...Object.fromEntries(Object.entries(final).map(([k, v]) => [k, +v.toFixed(4)])), targets: { shotsTeammateCorr: 0.0181, pointsTeammateCorr: target } }, null, 1));
