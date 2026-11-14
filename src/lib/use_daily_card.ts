import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeCardRows } from './card_core';
import { persistWithAutoArchive, downloadJsonFile } from './storage_archive';

/**
 * Shared plumbing for every sport's automatic daily card: rows persisted in browser storage
 * with automatic 14-day JSON archiving to Downloads when storage is full.
 * Never loses active graded rows; keeps in-memory state intact even under quota failures.
 */
export function useDailyCard<T extends { id: string; date: string }>(storageKey: string, today: () => string) {
  const [rows, setRows] = useState<T[]>(() => {
    try { const v = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  const [status, setStatus] = useState('');
  const [inMemoryOnly, setInMemoryOnly] = useState(false);
  const ref = useRef<T[]>(rows);

  useEffect(() => {
    ref.current = rows;
    const r = persistWithAutoArchive(storageKey, rows, today());
    setInMemoryOnly(r.inMemoryOnly);
    if (r.status) {
      setStatus(r.status);
    } else if (r.trimmed) {
      setStatus(`Browser storage is tight: kept the most recent ${r.remainingRows.length} daily-card rows.`);
    }
  }, [rows]);

  const add = useCallback((incoming: T[]) => setRows(prev => mergeCardRows(prev, incoming)), []);

  const exportCurrentCard = useCallback(() => {
    const filename = `${storageKey}_export_${today()}.json`;
    downloadJsonFile(filename, ref.current);
    setStatus(`Exported current card (${ref.current.length} rows) to ${filename}`);
  }, [storageKey, today]);

  return { rows, ref, setRows, add, status, setStatus, inMemoryOnly, exportCurrentCard, storageKey };
}

/**
 * Runs `run` automatically: after the slate loads (`ready` changes), when the scoreboard / History tab opens (`open` turns
 * true) and when the browser tab regains focus. Automatic runs are throttled to once per 5 minutes; `go(true)` is the
 * manual button and ignores the throttle. Never runs two at once.
 */
export function useAutoGrade(run: () => Promise<void>, ready: unknown, open: boolean) {
  const runRef = useRef(run);
  runRef.current = run;
  const busy = useRef(false);
  const last = useRef(0);
  const go = useCallback(async (manual: boolean) => {
    if (busy.current) return;
    if (!manual && Date.now() - last.current < 5 * 60 * 1000) return;
    busy.current = true; last.current = Date.now();
    try { await runRef.current(); } catch (e) { console.warn('auto-grade failed', e); } finally { busy.current = false; }
  }, []);
  useEffect(() => { void go(false); }, [ready]);
  useEffect(() => { if (open) void go(false); }, [open]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void go(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [go]);
  return go;
}
