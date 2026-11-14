/**
 * localStorage for per-day boards (odds maps). A stored map carries the date it
 * was entered; on any other day it is discarded, so yesterday's prices can never
 * be applied to today's lines.
 */
export function loadDated<T>(key: string, today: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.date === today && parsed.data !== undefined) return parsed.data as T;
  } catch { /* ignore */ }
  return fallback;
}

export function saveDated<T>(key: string, today: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ date: today, data }));
  } catch { /* ignore */ }
}
