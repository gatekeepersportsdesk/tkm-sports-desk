import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseNflPlayerRatesPrior,
  parseNbaPlayerRates,
  shrinkNflReceptions,
  shrinkNbaMarketRate,
  getNflPlayerPrior,
  getNbaPlayerPrior,
  NflPlayerRatePrior,
  NbaPlayerRatePrior
} from './player_priors';

test('Player Priors: NFL prior parsing and shrinkage', () => {
  const sampleNflCsv = `player_id,player_name,position,games,avg_targets,avg_receptions,avg_rec_yards,total_targets,total_receptions
00-0030279,Keenan Allen,WR,18,7.22,4.67,966.0,130,84
00-0030506,Travis Kelce,TE,17,6.35,4.47,874.0,108,76`;

  const map = parseNflPlayerRatesPrior(sampleNflCsv);
  assert.strictEqual(map.size, 2);

  const allen = map.get('keenan allen')!;
  assert.ok(allen);
  assert.strictEqual(allen.games, 18);
  assert.strictEqual(allen.avgReceptions, 4.67);

  // Shrinkage test: 18 games vs k=8 -> weight = 18/(18+8) = 18/26 = 0.692
  const shrink18 = shrinkNflReceptions(6.0, allen, 8.0);
  assert.strictEqual(shrink18.priorGames, 18);
  assert.strictEqual(shrink18.priorAvg, 4.67);
  assert.strictEqual(shrink18.weight, 0.692);
  // Shrunk = (1 - 0.6923) * 6.0 + 0.6923 * 4.67 = 1.846 + 3.233 = ~5.079
  assert.ok(shrink18.shrunkAvg < 6.0 && shrink18.shrunkAvg > 4.67);
  assert.strictEqual(shrink18.source, 'nfl_player_rates_prior.csv');

  // Shrinkage with fewer games (more games = more weight)
  const rookie: NflPlayerRatePrior = {
    playerId: 'test',
    playerName: 'Rookie WR',
    position: 'WR',
    games: 4,
    avgTargets: 5,
    avgReceptions: 3.5,
    avgRecYards: 45,
    totalTargets: 20,
    totalReceptions: 14
  };
  const shrink4 = shrinkNflReceptions(6.0, rookie, 8.0);
  assert.strictEqual(shrink4.weight, 0.333);
  assert.ok(shrink18.weight > shrink4.weight, 'More games must yield higher weight on prior');

  // Missing player fallback: no shrinkage, weight = 0
  const missing = shrinkNflReceptions(5.5, undefined);
  assert.strictEqual(missing.shrunkAvg, 5.5);
  assert.strictEqual(missing.weight, 0);
  assert.strictEqual(missing.source, 'none');
});

test('Player Priors: NBA prior parsing and shrinkage across markets', () => {
  const sampleNbaCsv = `PLAYER_NAME,PLAYER_ID,GP,MIN,PTS,REB,AST,FG3M
Luka Doncic,1629029,70,36.0,33.0,9.0,9.5,3.8
Nikola Jokic,203999,75,34.0,26.0,12.0,9.0,1.0`;

  const map = parseNbaPlayerRates(sampleNbaCsv);
  assert.strictEqual(map.size, 2);

  const luka = map.get('luka doncic')!;
  assert.ok(luka);
  assert.strictEqual(luka.gp, 70);
  assert.strictEqual(luka.pts, 33.0);
  assert.strictEqual(luka.reb, 9.0);
  assert.strictEqual(luka.ast, 9.5);
  assert.strictEqual(luka.fg3m, 3.8);

  // Points shrinkage: base per-minute rate = 0.85 pts/min, projected 35 minutes
  // Prior per-minute rate = 33.0 / 36.0 = 0.9167 pts/min
  // Weight with k=20 -> 70 / (70 + 20) = 70/90 = 0.778
  const ptsShrink = shrinkNbaMarketRate(0.85, 'pts', 35, luka, undefined, 20);
  assert.strictEqual(ptsShrink.weight, 0.778);
  assert.ok(ptsShrink.shrunkRate > 0.85, 'Rate should shrink upward toward 0.9167');
  assert.strictEqual(ptsShrink.source, 'nba_player_rates_prior.csv');

  // Threes shrinkage:
  const tpmShrink = shrinkNbaMarketRate(0.08, 'tpm', 35, luka, undefined, 20);
  assert.strictEqual(tpmShrink.priorPerGame, 3.8);
  assert.ok(tpmShrink.shrunkRate > 0.08);

  // Blending with current season rate file:
  const lukaCur: NbaPlayerRatePrior = {
    playerId: 1629029,
    playerName: 'Luka Doncic',
    gp: 8,
    min: 35.0,
    pts: 30.0,
    reb: 8.5,
    ast: 9.0,
    fg3m: 3.2
  };
  const ptsBlended = shrinkNbaMarketRate(0.85, 'pts', 35, luka, lukaCur, 20);
  // Blended per game = 0.8 * 33 + 0.2 * 30 = 26.4 + 6 = 32.4
  assert.strictEqual(ptsBlended.priorPerGame, 32.4);
  assert.strictEqual(ptsBlended.source, 'nba_player_rates_prior + current (80/20)');

  // Missing player fallback
  const missingNba = shrinkNbaMarketRate(0.70, 'pts', 30, undefined, undefined);
  assert.strictEqual(missingNba.shrunkRate, 0.70);
  assert.strictEqual(missingNba.weight, 0);
  assert.strictEqual(missingNba.source, 'none');
});

test('Player Priors: Fixture files load from disk', () => {
  // Test lookup from generated fixture CSVs
  const travis = getNflPlayerPrior('Travis Kelce');
  assert.ok(travis, 'Travis Kelce should exist in NFL prior fixture');
  assert.strictEqual(travis.position, 'TE');
  assert.ok(travis.games > 0);

  const nbaBanchero = getNbaPlayerPrior('Paolo Banchero');
  assert.ok(nbaBanchero.prior, 'Paolo Banchero should exist in NBA prior fixture');
  assert.ok(nbaBanchero.prior.pts > 0);
});
