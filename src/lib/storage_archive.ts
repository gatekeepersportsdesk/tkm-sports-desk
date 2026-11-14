/**
 * Browser Storage Quota & Auto-Archiving Engine
 *
 * Prevents "Browser storage is full" errors from blocking grading or losing results.
 * Automatically exports snapshots older than 14 days as JSON files to Downloads
 * when localStorage quota is exceeded, keeps active graded cards safe in memory,
 * and supports manual 30-day history archiving.
 */

export interface ArchiveResult<T> {
  ok: boolean;
  status: string;
  trimmed: boolean;
  inMemoryOnly: boolean;
  archivedFileName?: string;
  archivedCount?: number;
  remainingRows: T[];
}

export const ARCHIVE_EMAIL_STORAGE_KEY = 'gatekeep_archive_email';

/**
 * Gets the configured notification email for archives (e.g. appsbuilder1996@gmail.com).
 */
export function getArchiveNotificationEmail(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(ARCHIVE_EMAIL_STORAGE_KEY);
      if (saved) return saved.trim();
    }
  } catch { /* ignore */ }
  return 'appsbuilder1996@gmail.com'; // Default user contact from configuration
}

/**
 * Saves the configured notification email for archives.
 */
export function setArchiveNotificationEmail(email: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ARCHIVE_EMAIL_STORAGE_KEY, email.trim());
    }
  } catch { /* ignore */ }
}

/**
 * Programmatically triggers a JSON file download in browser environments.
 */
export function downloadJsonFile(filename: string, data: unknown): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  try {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (err) {
    console.warn('[storage_archive] Failed to download JSON archive:', err);
    return false;
  }
}

/**
 * Opens a mailto: draft when an archive is created if the user has an email configured.
 */
export function triggerArchiveMailto(email: string, filename: string, rowCount: number, today: string): void {
  if (typeof window === 'undefined' || !email) return;
  try {
    const subject = encodeURIComponent(`Gatekeep Sports Desk: Daily Card Archive (${today})`);
    const body = encodeURIComponent(
      `Hi,\n\nYour Gatekeep Sports Desk daily card archive has been created:\n` +
      `- Archive file: ${filename} (saved in your Downloads folder)\n` +
      `- Entries archived: ${rowCount}\n` +
      `- Date: ${today}\n\n` +
      `Keep this file for your long-term model calibration and betting history records.\n\n` +
      `Gatekeep Sports Desk`
    );
    // Use an invisible anchor to avoid popup blockers or alert issues
    const mailtoLink = `mailto:${email}?subject=${subject}&body=${body}`;
    const a = document.createElement('a');
    a.href = mailtoLink;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.warn('[storage_archive] Failed to trigger mailto:', err);
  }
}

/**
 * Persists rows safely with automatic 14-day auto-archiving on quota exhaustion.
 * NEVER blocks grading or throws away current day results: if storage is completely full,
 * keeps current graded results in memory and flags inMemoryOnly = true.
 */
export function persistWithAutoArchive<T extends { id?: string; date: string }>(
  storageKey: string,
  rows: T[],
  today: string,
  options?: {
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    notifyUser?: boolean;
    emailNotification?: boolean;
  }
): ArchiveResult<T> {
  const store = options?.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const nowMs = Date.parse(today) || Date.now();

  // Age helper in days
  const getAgeDays = (dateStr: string) => {
    const t = Date.parse(dateStr);
    if (isNaN(t)) return 0;
    return Math.floor((nowMs - t) / 86400000);
  };

  // If no storage is available, keep rows in memory only
  if (!store) {
    return {
      ok: true,
      status: 'Storage unavailable; running in memory.',
      trimmed: false,
      inMemoryOnly: true,
      remainingRows: rows
    };
  }

  // 1. First attempt: standard retention windows (120 days, then 60 days)
  const windowDays = [120, 60];
  for (const days of windowDays) {
    const keep = rows.filter(r => getAgeDays(r.date) < days);
    try {
      store.setItem(storageKey, JSON.stringify(keep));
      return {
        ok: true,
        status: keep.length < rows.length ? `Kept recent ${keep.length} rows.` : '',
        trimmed: keep.length < rows.length,
        inMemoryOnly: false,
        remainingRows: keep
      };
    } catch {
      // Quota exceeded: proceed to auto-archive flow
    }
  }

  // 2. Storage full: Auto-archive everything older than 14 days
  const olderThan14 = rows.filter(r => getAgeDays(r.date) >= 14);
  const recent14 = rows.filter(r => getAgeDays(r.date) < 14);
  const archiveFilename = `gatekeep_archive_${today}.json`;

  let archivedCount = 0;
  if (olderThan14.length > 0) {
    archivedCount = olderThan14.length;
    // Download archive file
    downloadJsonFile(archiveFilename, {
      archiveDate: today,
      storageKey,
      totalEntries: olderThan14.length,
      rows: olderThan14
    });

    // Optional email notification if configured
    const userEmail = getArchiveNotificationEmail();
    if (userEmail && options?.emailNotification !== false) {
      triggerArchiveMailto(userEmail, archiveFilename, olderThan14.length, today);
    }
  }

  // 3. Retry saving with rows <= 14 days
  const candidateRows = recent14.length > 0 ? recent14 : rows.filter(r => r.date === today);

  // Try 14 days, then 7 days, then only today
  const pruneTries = [14, 7, 3, 1];
  for (const days of pruneTries) {
    const keep = candidateRows.filter(r => getAgeDays(r.date) < days);
    // Ensure we keep at least today's rows if available
    const rowsToTry = keep.length > 0 ? keep : rows.filter(r => r.date === today);
    try {
      store.setItem(storageKey, JSON.stringify(rowsToTry));
      const archiveMsg = archivedCount > 0
        ? `Storage full. Older cards archived to ${archiveFilename} in your Downloads folder. Keep this file if you want the history.`
        : `Storage full. Older cards pruned to keep the most recent ${rowsToTry.length} entries.`;
      return {
        ok: true,
        status: archiveMsg,
        trimmed: true,
        inMemoryOnly: false,
        archivedFileName: archivedCount > 0 ? archiveFilename : undefined,
        archivedCount,
        remainingRows: rowsToTry
      };
    } catch {
      // Continue to next smaller window
    }
  }

  // 4. Last resort: Even today's rows exceeded browser storage
  // KEEP IN MEMORY! Never lose current day's graded results!
  return {
    ok: false,
    status: `Storage full. Current graded card is retained in memory. Export JSON to save your results.`,
    trimmed: true,
    inMemoryOnly: true,
    archivedFileName: archivedCount > 0 ? archiveFilename : undefined,
    archivedCount,
    remainingRows: rows
  };
}

/**
 * Manually clears graded history older than 30 days by:
 * 1. Automatically downloading an archive JSON file first.
 * 2. Removing those entries from storage.
 * 3. Returning the pruned collection of rows so UI updates immediately.
 */
export function clearOldGradedHistory<T extends { date: string }>(
  sportName: string,
  rows: T[],
  today: string,
  storageKey?: string,
  storage?: Pick<Storage, 'setItem'>
): {
  archivedCount: number;
  archiveFilename: string;
  remainingRows: T[];
  message: string;
} {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const nowMs = Date.parse(today) || Date.now();

  const getAgeDays = (dateStr: string) => {
    const t = Date.parse(dateStr);
    if (isNaN(t)) return 0;
    return Math.floor((nowMs - t) / 86400000);
  };

  const olderThan30 = rows.filter(r => getAgeDays(r.date) >= 30);
  const remainingRows = rows.filter(r => getAgeDays(r.date) < 30);
  const archiveFilename = `gatekeep_archive_${sportName.toLowerCase()}_${today}.json`;

  if (olderThan30.length === 0) {
    return {
      archivedCount: 0,
      archiveFilename,
      remainingRows: rows,
      message: 'No graded entries older than 30 days found in storage.'
    };
  }

  // 1. Download archive of everything older than 30 days
  downloadJsonFile(archiveFilename, {
    sport: sportName,
    archiveDate: today,
    entriesArchived: olderThan30.length,
    rows: olderThan30
  });

  // 2. Persist remaining rows to storage
  if (store && storageKey) {
    try {
      store.setItem(storageKey, JSON.stringify(remainingRows));
    } catch (e) {
      console.warn('[storage_archive] Failed to write pruned rows to storage:', e);
    }
  }

  return {
    archivedCount: olderThan30.length,
    archiveFilename,
    remainingRows,
    message: `Archived and cleared ${olderThan30.length} entries older than 30 days to ${archiveFilename}.`
  };
}
