import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankDeskRows,
  formSampleFromLogs,
  computeProcessScore,
  DeskItemAccess
} from './desk_rank';
import { DEFAULT_BETTABLE } from './bettable';
import {
  loadNhl2026PriorsSync,
  getNhl2026Counts,
  getNhl2026SkaterForm,
  getNhl2026GoalieForTeam,
  enrichNhlSkaterWith2026Priors
} from './nhl_2026_priors';
import { NhlPlayerSnapshot } from '../types/nhl';

interface MockItem {
  id: string;
  mu: number;
  line: number;
  pOver: number;
  pUnder: number;
  edge: number;
  overOdds: number | null;
  underOdds: number | null;
  logs?: number[];
}

function makeAccessor(
  sortBy: DeskItemAccess<MockItem>['sortBy'],
  deprioritizeWeakForm = false
): DeskItemAccess<MockItem> {
  return {
    sport: 'nba',
    market: 'pts',
    cfg: DEFAULT_BETTABLE,
    linesOf: p => [p.line],
    defaultLine: p => p.line,
    picked: () => undefined,
    entryAt: (p, l) => (l === p.line && (p.overOdds != null || p.underOdds != null)
      ? { over: p.overOdds, under: p.underOdds }
      : undefined),
    evalAt: (p, l) => (l === p.line ? {
      hasMarket: p.overOdds != null || p.underOdds != null,
      line: p.line,
      pOver: p.pOver,
      pUnder: p.pUnder,
      edgeOver: p.edge,
      edgeUnder: -p.edge,
      evOver: p.edge / 100,
      evUnder: -p.edge / 100,
      fairOver: p.pOver,
      fairUnder: p.pUnder,
      overOdds: p.overOdds,
      underOdds: p.underOdds
    } as any : null),
    mu: p => p.mu,
    pm: () => 30,
    inputs: () => 'REAL',
    availability: () => 'ACTIVE',
    sortBy,
    formOf: (p, line, side) => formSampleFromLogs(p.logs, line, side),
    deprioritizeWeakForm
  };
}

test('desk_rank: Form sort ranks by L10 hit rate then L5 tie-break, and missing logs stay null at bottom', () => {
  const items: MockItem[] = [
    { id: 'A_no_logs', mu: 26, line: 24.5, pOver: 0.62, pUnder: 0.38, edge: 6.0, overOdds: -110, underOdds: -110, logs: [] },
    // L10 = 70% (7/10), L5 = 40% (2/5)
    { id: 'B_70_40', mu: 25, line: 24.5, pOver: 0.58, pUnder: 0.42, edge: 3.0, overOdds: -110, underOdds: -110, logs: [20, 28, 22, 26, 21, 30, 31, 29, 27, 32] },
    // L10 = 70% (7/10), L5 = 100% (5/5) -> must beat B_70_40 on L5 tie-break
    { id: 'C_70_100', mu: 24, line: 24.5, pOver: 0.57, pUnder: 0.43, edge: 2.0, overOdds: -110, underOdds: -110, logs: [28, 29, 26, 27, 30, 21, 22, 20, 28, 29] },
    // L10 = 90% (9/10)
    { id: 'D_90', mu: 23, line: 24.5, pOver: 0.56, pUnder: 0.44, edge: 1.5, overOdds: -110, underOdds: -110, logs: [30, 29, 28, 27, 26, 25, 29, 28, 31, 20] }
  ];

  const ranked = rankDeskRows(items, makeAccessor('form'));
  assert.deepStrictEqual(
    ranked.map(r => r.p.id),
    ['D_90', 'C_70_100', 'B_70_40', 'A_no_logs']
  );
  assert.strictEqual(ranked.find(r => r.p.id === 'A_no_logs')?.form, null);
});

test('desk_rank: Process sort blends 0.40 model + 0.35 edge + 0.25 formL10 + L5 boost, and weak L10 <40% toggle pushes weak rows down', () => {
  // Verify formula directly
  const hot = computeProcessScore(0.62, 8.0, true, { l10HitRate: 0.80, l5HitRate: 0.80, l10Games: 10, l5Games: 5 });
  const cold = computeProcessScore(0.62, 8.0, true, { l10HitRate: 0.20, l5HitRate: 0.20, l10Games: 10, l5Games: 5 });
  assert.ok(hot > cold);

  const items: MockItem[] = [
    // Huge edge (10pp) & prob (64%) but terrible L10 (20% = 2/10)
    { id: 'weak_form_star', mu: 27, line: 24.5, pOver: 0.64, pUnder: 0.36, edge: 10.0, overOdds: -110, underOdds: -110, logs: [18, 19, 20, 21, 22, 25, 26, 19, 18, 20] },
    // Solid prob (59%), moderate edge (4pp), strong L10 (80% = 8/10)
    { id: 'balanced_hot', mu: 25, line: 24.5, pOver: 0.59, pUnder: 0.41, edge: 4.0, overOdds: -110, underOdds: -110, logs: [28, 27, 26, 29, 30, 28, 27, 26, 20, 21] }
  ];

  // With deprioritizeWeakForm = false & edge sort -> star ranks first
  const edgeFirst = rankDeskRows(items, makeAccessor('edge', false));
  assert.strictEqual(edgeFirst[0].p.id, 'weak_form_star');

  // With deprioritizeWeakForm = true -> weak_form_star (<40% L10) pushed below stronger-form rows
  const filteredWeak = rankDeskRows(items, makeAccessor('edge', true));
  assert.strictEqual(filteredWeak[0].p.id, 'balanced_hot');
  assert.strictEqual(filteredWeak[1].weakForm, true);
});

test('nhl_2026_priors: Loads league-wide 2026 CSVs cleanly and leaves missing players with empty form arrays', () => {
  const ok = loadNhl2026PriorsSync();
  assert.strictEqual(ok, true);
  const counts = getNhl2026Counts();
  assert.ok(counts.skaters > 200, `Expected >200 skaters, got ${counts.skaters}`);
  assert.ok(counts.forms > 200, `Expected >200 skater forms, got ${counts.forms}`);
  assert.ok(counts.goalies > 30, `Expected >30 goalies, got ${counts.goalies}`);
  assert.ok(counts.lines >= 20, `Expected >=20 teams with lines, got ${counts.lines}`);

  // League-wide check: verify a skater form exists and contains newest-first shots/points
  const mcdavid = getNhl2026SkaterForm(undefined, 'Connor McDavid');
  assert.ok(mcdavid !== null);
  assert.ok(mcdavid.recentShots.length > 0);
  assert.strictEqual(mcdavid.recentShots.length, mcdavid.recentPoints.length);

  // Goalie check
  const edmGoalie = getNhl2026GoalieForTeam('EDM');
  assert.ok(edmGoalie !== undefined);
  assert.ok(edmGoalie.savePct > 0.7 && edmGoalie.savePct < 1.0);

  // Unknown player must stay missing ([] recentShots, never fabricated 0%)
  const unknownSkater: NhlPlayerSnapshot = {
    playerId: 9999999,
    name: 'Totally Unknown Prospect',
    team: 'EDM',
    pos: 'F',
    gp: 0,
    shots: 0,
    points: null,
    toiAvg: 0,
    recentShots: [],
    recentPoints: []
  };

  const enrichedUnknown = enrichNhlSkaterWith2026Priors(unknownSkater);
  assert.strictEqual(enrichedUnknown.recentShots.length, 0);
  assert.strictEqual(enrichedUnknown.recentPoints.length, 0);
});
