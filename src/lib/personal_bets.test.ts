import { test } from 'node:test';
import assert from 'node:assert';
import {
  calcAmericanProfitMultiplier,
  calcBetPnl,
  summarizePersonalBets,
  createPersonalBet,
  gradeSingleBet,
  reconcileBetsWithCardRows,
  parseBetsFromCsv,
  parseBetsFromJson,
  exportBetsToCsv,
  exportBetsToJson,
  PersonalBet
} from './personal_bets';
import { CardRow } from './card_core';

test('Personal Bets: American odds profit multiplier', () => {
  // Positive odds: +150 -> 1.50 profit
  assert.strictEqual(calcAmericanProfitMultiplier(150), 1.5);
  // Even money: +100 -> 1.00 profit
  assert.strictEqual(calcAmericanProfitMultiplier(100), 1.0);
  // Negative odds: -110 -> ~0.909 profit
  const mult110 = calcAmericanProfitMultiplier(-110);
  assert.ok(Math.abs(mult110 - (100 / 110)) < 0.001);
  // Negative odds: -200 -> 0.5 profit
  assert.strictEqual(calcAmericanProfitMultiplier(-200), 0.5);
});

test('Personal Bets: P&L calculation for results', () => {
  // Hit with +120 odds, 1.0 unit stake -> +1.20 units
  const pnlHitPlus = calcBetPnl({ result: 'HIT', odds: 120, stake: 1.0 });
  assert.strictEqual(pnlHitPlus, 1.2);

  // Hit with -110 odds, 1.1 units stake -> +1.00 units
  const pnlHitMinus = calcBetPnl({ result: 'HIT', odds: -110, stake: 1.1 });
  assert.strictEqual(pnlHitMinus, 1.0);

  // Miss with 2.5 units stake -> -2.5 units
  const pnlMiss = calcBetPnl({ result: 'MISS', odds: -110, stake: 2.5 });
  assert.strictEqual(pnlMiss, -2.5);

  // Push / Void -> 0
  assert.strictEqual(calcBetPnl({ result: 'PUSH', odds: -110, stake: 1.0 }), 0);
  assert.strictEqual(calcBetPnl({ result: 'VOID', odds: -110, stake: 1.0 }), 0);

  // Pending -> null
  assert.strictEqual(calcBetPnl({ result: 'PENDING', odds: -110, stake: 1.0 }), null);
});

test('Personal Bets: Summary metrics (win rate, net units, ROI)', () => {
  const bets: PersonalBet[] = [
    createPersonalBet({ player: 'LeBron James', result: 'HIT', odds: -110, stake: 1.1 }), // PnL +1.0
    createPersonalBet({ player: 'Stephen Curry', result: 'HIT', odds: 100, stake: 1.0 }),  // PnL +1.0
    createPersonalBet({ player: 'Nikola Jokic', result: 'MISS', odds: -120, stake: 1.0 }), // PnL -1.0
    createPersonalBet({ player: 'Luka Doncic', result: 'PUSH', odds: -110, stake: 1.0 }),  // PnL 0
    createPersonalBet({ player: 'Giannis Antetokounmpo', result: 'VOID', odds: -110, stake: 1.0 }), // PnL 0
    createPersonalBet({ player: 'Jayson Tatum', result: 'PENDING', odds: -110, stake: 1.0 }) // Pending
  ];

  const summary = summarizePersonalBets(bets);

  assert.strictEqual(summary.totalBets, 6);
  assert.strictEqual(summary.settledBets, 5);
  assert.strictEqual(summary.pendingBets, 1);
  assert.strictEqual(summary.hits, 2);
  assert.strictEqual(summary.misses, 1);
  assert.strictEqual(summary.pushes, 1);
  assert.strictEqual(summary.voids, 1);

  // Win rate: 2 hits / (2 hits + 1 miss) = 66.7%
  assert.strictEqual(summary.winRate, 66.7);

  // Settled stake = 1.1 + 1.0 + 1.0 + 1.0 + 1.0 = 5.1
  assert.strictEqual(summary.settledStaked, 5.1);

  // Net units = +1.0 + 1.0 - 1.0 = +1.0
  assert.strictEqual(summary.netUnits, 1.0);

  // ROI = 1.0 / 5.1 * 100 = 19.6%
  assert.strictEqual(summary.roi, 19.6);
});

test('Personal Bets: Single bet grading (Over, Under, Push, Void)', () => {
  const overBet = createPersonalBet({ player: 'Shai Gilgeous-Alexander', market: 'points', side: 'OVER', line: 30.5, odds: -115, stake: 1.0 });
  const hit = gradeSingleBet(overBet, 32);
  assert.strictEqual(hit.result, 'HIT');
  assert.strictEqual(hit.actual, 32);
  assert.ok((hit.pnl ?? 0) > 0);

  const miss = gradeSingleBet(overBet, 28);
  assert.strictEqual(miss.result, 'MISS');
  assert.strictEqual(miss.pnl, -1.0);

  const underBet = createPersonalBet({ player: 'Rudy Gobert', market: 'rebounds', side: 'UNDER', line: 12.0, odds: -105, stake: 1.0 });
  const underHit = gradeSingleBet(underBet, 10);
  assert.strictEqual(underHit.result, 'HIT');

  const push = gradeSingleBet(underBet, 12);
  assert.strictEqual(push.result, 'PUSH');
  assert.strictEqual(push.pnl, 0);

  const voidBet = gradeSingleBet(underBet, 0, true);
  assert.strictEqual(voidBet.result, 'VOID');
  assert.strictEqual(voidBet.pnl, 0);
});

test('Personal Bets: Reconcile with CardRows', () => {
  const bets: PersonalBet[] = [
    createPersonalBet({ date: '2026-11-06', sport: 'nba', player: 'Luka Doncic', market: 'points', side: 'OVER', line: 29.5, odds: -110, stake: 1.0 }),
    createPersonalBet({ date: '2026-11-06', sport: 'nfl', player: 'Travis Kelce', market: 'receptions', side: 'OVER', line: 5.5, odds: -120, stake: 1.0 }),
    createPersonalBet({ date: '2026-11-06', sport: 'nba', player: 'Kyrie Irving', market: 'points', side: 'UNDER', line: 22.5, odds: -110, stake: 1.0, result: 'HIT' }) // already settled
  ];

  const cardRows: Partial<CardRow>[] = [
    {
      date: '2026-11-06',
      market: 'points',
      name: 'Luka Dončić', // accented name check
      result: 'HIT',
      actual: 34
    },
    {
      date: '2026-11-06',
      market: 'receptions',
      name: 'Travis Kelce',
      result: 'MISS',
      actual: 4
    }
  ];

  const { updatedBets, gradedCount } = reconcileBetsWithCardRows(bets, cardRows as CardRow[]);

  assert.strictEqual(gradedCount, 2);
  assert.strictEqual(updatedBets[0].result, 'HIT');
  assert.strictEqual(updatedBets[0].actual, 34);
  assert.strictEqual(updatedBets[1].result, 'MISS');
  assert.strictEqual(updatedBets[1].actual, 4);
  assert.strictEqual(updatedBets[2].result, 'HIT'); // untouched
});

test('Personal Bets: CSV Import & Export', () => {
  const csvContent = `date,player,sport,market,side,line,odds,stake,notes
2026-11-06,Anthony Davis,nba,rebounds,OVER,12.5,-115,1.5,Starter vs PHX
2026-11-06,Connor McDavid,nhl,shots,OVER,3.5,-130,2.0,Home power play`;

  const { bets, errors } = parseBetsFromCsv(csvContent);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(bets.length, 2);

  assert.strictEqual(bets[0].player, 'Anthony Davis');
  assert.strictEqual(bets[0].market, 'rebounds');
  assert.strictEqual(bets[0].side, 'OVER');
  assert.strictEqual(bets[0].line, 12.5);
  assert.strictEqual(bets[0].odds, -115);
  assert.strictEqual(bets[0].stake, 1.5);
  assert.strictEqual(bets[0].notes, 'Starter vs PHX');

  assert.strictEqual(bets[1].player, 'Connor McDavid');
  assert.strictEqual(bets[1].sport, 'nhl');
  assert.strictEqual(bets[1].line, 3.5);
  assert.strictEqual(bets[1].stake, 2.0);

  // Round trip export
  const exported = exportBetsToCsv(bets);
  assert.ok(exported.includes('Anthony Davis'));
  assert.ok(exported.includes('Connor McDavid'));
});

test('Personal Bets: JSON Import & Export', () => {
  const bets: PersonalBet[] = [
    createPersonalBet({ player: 'Shohei Ohtani', sport: 'mlb', market: 'hits', side: 'OVER', line: 0.5, odds: -160, stake: 1.0 })
  ];

  const jsonStr = exportBetsToJson(bets);
  const { bets: imported, errors } = parseBetsFromJson(jsonStr);

  assert.strictEqual(errors.length, 0);
  assert.strictEqual(imported.length, 1);
  assert.strictEqual(imported[0].player, 'Shohei Ohtani');
  assert.strictEqual(imported[0].line, 0.5);
});

test('Personal Bets: JSON Import variations (wrapper objects, single objects, aliases, BOM, NDJSON)', () => {
  // 1. Wrapped in "personal_bets" object
  const wrappedJson = JSON.stringify({
    personal_bets: [
      { player: 'Luka Doncic', sport: 'nba', market: 'points', line: 28.5, odds: -110, stake: 1.5 },
      { player: 'Kyrie Irving', sport: 'nba', market: 'assists', line: 5.5, odds: 120, stake: 1.0 }
    ]
  });
  const resWrapped = parseBetsFromJson(wrappedJson);
  assert.strictEqual(resWrapped.errors.length, 0);
  assert.strictEqual(resWrapped.bets.length, 2);
  assert.strictEqual(resWrapped.bets[0].player, 'Luka Doncic');

  // 2. Single object (not wrapped in array)
  const singleJson = JSON.stringify({
    Player: 'Anthony Davis',
    League: 'NBA',
    Prop: 'Rebounds',
    Side: 'Over',
    Threshold: '12.5',
    Price: '-115',
    Units: '2u'
  });
  const resSingle = parseBetsFromJson(singleJson);
  assert.strictEqual(resSingle.errors.length, 0);
  assert.strictEqual(resSingle.bets.length, 1);
  assert.strictEqual(resSingle.bets[0].player, 'Anthony Davis');
  assert.strictEqual(resSingle.bets[0].line, 12.5);
  assert.strictEqual(resSingle.bets[0].odds, -115);
  assert.strictEqual(resSingle.bets[0].stake, 2);

  // 3. UTF-8 BOM prefix
  const bomJson = '\uFEFF' + JSON.stringify([{ player: 'Connor McDavid', market: 'shots', line: 3.5 }]);
  const resBom = parseBetsFromJson(bomJson);
  assert.strictEqual(resBom.errors.length, 0);
  assert.strictEqual(resBom.bets.length, 1);
  assert.strictEqual(resBom.bets[0].player, 'Connor McDavid');

  // 4. Decimal odds conversion (e.g. 1.91 -> -110, 2.50 -> +150)
  const decJson = JSON.stringify([
    { player: 'Player A', odds: 1.91, stake: 1 },
    { player: 'Player B', odds: 2.50, stake: 1 }
  ]);
  const resDec = parseBetsFromJson(decJson);
  assert.strictEqual(resDec.bets[0].odds, -110);
  assert.strictEqual(resDec.bets[1].odds, 150);

  // 5. Line-delimited JSON (NDJSON)
  const ndjson = `{"player": "Player 1", "line": 10.5}\n{"player": "Player 2", "line": 20.5}`;
  const resNd = parseBetsFromJson(ndjson);
  assert.strictEqual(resNd.errors.length, 0);
  // 6. Date-grouped object: { "2026-11-06": [ ... ] }
  const dateGrouped = JSON.stringify({
    '2026-11-06': [
      { player: 'Luka Doncic', market: 'points', line: 28.5 },
      { player: 'Nikola Jokic', market: 'rebounds', line: 12.5 }
    ]
  });
  const resDateGrouped = parseBetsFromJson(dateGrouped);
  assert.strictEqual(resDateGrouped.errors.length, 0);
  assert.strictEqual(resDateGrouped.bets.length, 2);
  assert.strictEqual(resDateGrouped.bets[0].player, 'Luka Doncic');

  // 7. Loose JSON with comments, trailing commas, and unquoted keys
  const looseJson = `// My personal wagers
  [
    {
      player: "Travis Kelce",
      market: "receptions",
      line: 5.5,
      odds: -115,
      stake: 1.0, /* strong lean */
    },
  ]`;
  const resLoose = parseBetsFromJson(looseJson);
  assert.strictEqual(resLoose.errors.length, 0);
  assert.strictEqual(resLoose.bets.length, 1);
  assert.strictEqual(resLoose.bets[0].player, 'Travis Kelce');

  // 8. Empty input
  const resEmpty = parseBetsFromJson('');
  assert.strictEqual(resEmpty.bets.length, 0);
  assert.ok(resEmpty.errors.length > 0);
});


