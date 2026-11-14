import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLoad, pushDiagLog } from './session_diag.ts';

test('diag: first load is benign', () => {
  const d = classifyLoad({ hadPriorSession: false });
  assert.equal(d.kind, 'first-load'); assert.equal(d.benign, true);
});
test('diag: a vite full-reload flag wins over everything and is not benign', () => {
  const d = classifyLoad({ hadPriorSession: true, viteReloadFlag: '123', navType: 'reload', prevServerStart: 1, serverStart: 2 });
  assert.equal(d.kind, 'vite-full-reload'); assert.equal(d.benign, false);
});
test('diag: changed server start means the server restarted', () => {
  const d = classifyLoad({ hadPriorSession: true, prevServerStart: 1000, serverStart: 2000, navType: 'reload' });
  assert.equal(d.kind, 'server-restarted'); assert.equal(d.benign, false);
});
test('diag: same server + browser reload is benign; unreachable health does not claim a restart', () => {
  assert.equal(classifyLoad({ hadPriorSession: true, prevServerStart: 5, serverStart: 5, navType: 'reload' }).kind, 'browser-reload');
  assert.equal(classifyLoad({ hadPriorSession: true, prevServerStart: 5, serverStart: null, navType: 'reload' }).kind, 'browser-reload');
});
test('diag: log keeps only the newest entries', () => {
  let log: any[] = [];
  for (let i = 0; i < 15; i++) log = pushDiagLog(log, { at: i, kind: 'navigate', message: String(i) });
  assert.equal(log.length, 10); assert.equal(log[0].at, 5); assert.equal(log[9].at, 14);
});
