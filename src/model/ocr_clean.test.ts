import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOcrLines, sportHint } from '../lib/ocr_clean.ts';

test('OCR clean: keeps only readable rows, never invents any', () => {
  const out = cleanOcrLines({
    propType: 'shots',
    lines: [
      { player: ' Connor McDavid ', line: 3.5, overOdds: '-120', underOdds: '', team: 'EDM' },
      { player: '', line: 2.5, overOdds: '-110' },
      { player: 'No Line', overOdds: '-110' },
      { player: 'Bad Line', line: 'abc' },
      { player: 'Null Line', line: null },
      null,
      { player: 'Leon Draisaitl', line: '0.5', overOdds: '-170', underOdds: '+135', prop: 'points' }
    ]
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].player, 'Connor McDavid');
  assert.equal(out[0].underOdds, '');            // missing price stays missing, not defaulted
  assert.equal(out[0].prop, 'shots');            // falls back to the slip-level propType
  assert.equal(out[1].line, 0.5);
  assert.equal(out[1].prop, 'points');
});

test('OCR clean: garbage input yields nothing (no sample fallback)', () => {
  assert.deepEqual(cleanOcrLines(null), []);
  assert.deepEqual(cleanOcrLines({}), []);
  assert.deepEqual(cleanOcrLines({ lines: 'nope' }), []);
});

test('OCR clean: the detected sport is only a hint', () => {
  assert.equal(sportHint({ detectedSport: 'nfl' }), 'NFL');
  assert.equal(sportHint({ detectedSport: 'cricket' }), null);
  assert.equal(sportHint(undefined), null);
});
