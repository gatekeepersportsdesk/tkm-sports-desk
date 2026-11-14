// usage: tsx dump_nfl_rows.ts <dataDir> <outCsv>
// Dumps walk-forward (no-lookahead) baseline predictions so feature experiments can be evaluated against them.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, backtestNfl, BacktestRow, NflverseInputs } from '../../src/lib/nflverse.ts';
import { NFL_CONFIG, computeWalkForwardRatios, RatioObservation } from '../../src/model/nfl_engine.ts';
const dir = process.argv[2];
const read = (f: string) => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
const players = read('players.csv'); const games = read('games.csv');
const load = (y: number): NflverseInputs => ({ statsRows: read(`stats_player_week_${y}.csv`), snapRows: read(`snap_counts_${y}.csv`), playersRows: players });
const y24 = load(2024), y25 = load(2025), y26 = load(2026);
function wf(season: number, rows: BacktestRow[], priorRows: BacktestRow[]) {
  const all: RatioObservation[] = [...priorRows, ...rows].map(r => ({ pos: r.pos, muStructural: r.muStructural, actual: r.actual, played: true, week: r.week, season: r.season }));
  const cache = new Map<number, ReturnType<typeof computeWalkForwardRatios>>();
  return rows.map(r => { let rt = cache.get(r.week); if (!rt) { rt = computeWalkForwardRatios(all, { season, week: r.week }); cache.set(r.week, rt); }
    return { ...r, mu: Math.max(0.2, NFL_CONFIG.blend_weight * r.muStructural * rt[r.pos].ratio + (1 - NFL_CONFIG.blend_weight) * r.seasonAvg) }; });
}
const bt24 = backtestNfl({ season: 2024, fromWeek: 3, toWeek: 18, current: y24, gamesRows: games });
const bt25 = wf(2025, backtestNfl({ season: 2025, fromWeek: 3, toWeek: 18, current: y25, prior: y24, gamesRows: games }), bt24);
const bt26 = wf(2026, backtestNfl({ season: 2026, fromWeek: 3, toWeek: 6, current: y26, prior: y25, gamesRows: games }), bt25);
const bt24w = wf(2024, bt24, []);
const rows = [...bt24w, ...bt25, ...bt26];
fs.writeFileSync(process.argv[3], 'season,week,name,pos,team,muStructural,mu,seasonAvg,actual,games\n' + rows.map(r => [r.season, r.week, JSON.stringify(r.name), r.pos, r.team, r.muStructural, r.mu, r.seasonAvg, r.actual, r.games].join(',')).join('\n'));
console.log('rows', rows.length);
