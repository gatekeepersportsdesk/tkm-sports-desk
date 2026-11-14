import { test } from 'node:test';
import assert from 'node:assert';
import {
  persistWithAutoArchive,
  clearOldGradedHistory,
  getArchiveNotificationEmail,
  setArchiveNotificationEmail
} from './storage_archive';

test('Storage Archive: Normal save when quota is fine', () => {
  const mockStorage = {
    data: new Map<string, string>(),
    getItem(k: string) { return this.data.get(k) || null; },
    setItem(k: string, v: string) { this.data.set(k, v); },
    removeItem(k: string) { this.data.delete(k); }
  };

  const rows = [
    { id: '1', date: '2026-11-06', text: 'Recent row' },
    { id: '2', date: '2026-10-15', text: '22 days old' }
  ];

  const res = persistWithAutoArchive('test_card', rows, '2026-11-06', {
    storage: mockStorage,
    emailNotification: false
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.inMemoryOnly, false);
  assert.strictEqual(res.remainingRows.length, 2);
  assert.ok(mockStorage.data.has('test_card'));
});

test('Storage Archive: Auto-archives older than 14 days when quota exceeded', () => {
  let callCount = 0;
  const mockStorage = {
    data: new Map<string, string>(),
    getItem(k: string) { return this.data.get(k) || null; },
    setItem(k: string, v: string) {
      callCount++;
      // Fail on first 2 calls (120 and 60 days) to simulate quota limit
      if (callCount <= 2) {
        throw new Error('QuotaExceededError');
      }
      this.data.set(k, v);
    },
    removeItem(k: string) { this.data.delete(k); }
  };

  const rows = [
    { id: 'today', date: '2026-11-07', text: 'Today row' },
    { id: 'recent', date: '2026-11-02', text: '5 days old' },
    { id: 'old1', date: '2026-10-10', text: '28 days old' },
    { id: 'old2', date: '2026-09-01', text: '67 days old' }
  ];

  const res = persistWithAutoArchive('test_card', rows, '2026-11-07', {
    storage: mockStorage,
    emailNotification: false
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.archivedCount, 2); // old1 and old2 archived
  assert.ok(res.status.includes('Storage full. Older cards archived to gatekeep_archive_2026-11-07.json'));
  assert.strictEqual(res.remainingRows.length, 2); // today and recent kept
  assert.strictEqual(res.inMemoryOnly, false);
});

test('Storage Archive: Retains in memory if storage is completely full', () => {
  const mockStorage = {
    getItem() { return null; },
    setItem() { throw new Error('QuotaExceededError: full'); },
    removeItem() {}
  };

  const rows = [
    { id: 'today', date: '2026-11-07', text: 'Today row' }
  ];

  const res = persistWithAutoArchive('test_card', rows, '2026-11-07', {
    storage: mockStorage,
    emailNotification: false
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.inMemoryOnly, true);
  // Must NOT lose the row!
  assert.strictEqual(res.remainingRows.length, 1);
  assert.ok(res.status.includes('retained in memory'));
});

test('Storage Archive: Clear old graded history older than 30 days', () => {
  const mockStorage = {
    saved: '',
    setItem(_k: string, v: string) { this.saved = v; }
  };

  const rows = [
    { id: 'r1', date: '2026-11-07' }, // 0 days
    { id: 'r2', date: '2026-10-20' }, // 18 days
    { id: 'r3', date: '2026-09-15' }, // 53 days
    { id: 'r4', date: '2026-08-01' }  // 98 days
  ];

  const res = clearOldGradedHistory('NHL', rows, '2026-11-07', 'gatekeep_nhl_card_v1', mockStorage);

  assert.strictEqual(res.archivedCount, 2);
  assert.strictEqual(res.remainingRows.length, 2);
  assert.strictEqual(res.remainingRows[0].id, 'r1');
  assert.strictEqual(res.remainingRows[1].id, 'r2');
  assert.ok(res.message.includes('Archived and cleared 2 entries'));
});
