import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNhlContextAdjustments,
  loadNhlContextPriorsSync,
  normalizeName,
  normalizeTeam
} from './nhl_context_priors';

test('NHL Context Priors: Normalization helpers', () => {
  assert.strictEqual(normalizeName('Connor McDavid Jr.'), 'connor mcdavid');
  assert.strictEqual(normalizeName('J.T. Miller'), 'jt miller');
  assert.strictEqual(normalizeTeam('edm'), 'EDM');
});

test('NHL Context Priors: Context adjustments for elite players facing tough opponents', () => {
  loadNhlContextPriorsSync();
  // Connor McDavid (PP1, Top line, high danger) vs MIN (Wallstedt = elite goalie)
  const adj = getNhlContextAdjustments('Connor McDavid', 'EDM', 'MIN', 'F');
  assert.ok(adj.adjustments.length > 0, 'Should have active context adjustments');
  
  // Should have PP1 adjustment
  const ppAdj = adj.adjustments.find(a => a.label.includes('PP1'));
  assert.ok(ppAdj, 'McDavid should have PP1 boost');
  assert.strictEqual(ppAdj?.impactPct, 12);

  // Should have Opp goalie strong adjustment
  const goalieAdj = adj.adjustments.find(a => a.label.includes('Opp goalie'));
  assert.ok(goalieAdj, 'MIN should have goalie adjustment');
  assert.strictEqual(goalieAdj?.impactPct, -8);

  // Factor should be within safe range
  assert.ok(adj.totalFactor >= 0.75 && adj.totalFactor <= 1.30);
});

test('NHL Context Priors: Skater facing weak goalie and soft defense', () => {
  // MacKinnon vs SJS (soft defense, below average goalie Blackwood)
  const adj = getNhlContextAdjustments('Nathan MacKinnon', 'COL', 'SJS', 'F');
  assert.ok(adj.totalFactor > 1.0, 'Facing SJS should net positive context adjustment');

  const goalieWeak = adj.adjustments.find(a => a.label.includes('weak'));
  assert.ok(goalieWeak, 'SJS goalie should trigger weak boost');

  const defSoft = adj.adjustments.find(a => a.label.includes('soft'));
  assert.ok(defSoft, 'SJS defense should trigger soft defense boost');
});

test('NHL Context Priors: Missing player falls back gracefully', () => {
  const adj = getNhlContextAdjustments('Unknown Rookie', 'EDM', 'UNK', 'F');
  assert.strictEqual(adj.adjustments.length, 0);
  assert.strictEqual(adj.totalFactor, 1.0);
  assert.strictEqual(adj.summary, '');
});
