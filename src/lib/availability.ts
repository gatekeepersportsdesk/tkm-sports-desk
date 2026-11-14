/**
 * Gatekeep Sports Desk — Universal Availability & Input Quality Gate
 *
 * Order of operations (never edge-first on an unavailable player):
 *   roster/slate -> availability -> input quality -> edge.
 *
 * Availability here is ALWAYS fed from a live source (official injury report,
 * confirmed lineup). There are no hand-typed injury lists: they go stale within
 * a week and silently mark healthy players as dead (or the reverse).
 */

export type AvailabilityStatus =
  | 'ACTIVE'
  | 'QUESTIONABLE'
  | 'DOUBTFUL'
  | 'OUT'
  | 'IR'
  | 'INACTIVE'
  | 'SCRATCHED'
  | 'NOT_IN_LINEUP'
  | 'UNKNOWN';

export type InputsSource = 'REAL' | 'ESTIMATED' | 'UNKNOWN';

export interface PlayerAvailabilityInfo {
  status: AvailabilityStatus;
  reason: string;
}

/** Normalizes a player name for matching (accents, punctuation, suffixes). */
export function normalizeName(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’\-]/g, '')
    .replace(/\s+(jr|sr|iii|ii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact normalized match, or one name fully contained in the other (min 6 chars). */
export function fuzzyMatchName(input: string, candidate: string): boolean {
  const a = normalizeName(input);
  const b = normalizeName(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.includes(a)) return true;
  if (b.length >= 6 && a.includes(b)) return true;
  return false;
}

/** Players who will not play (or almost certainly will not). */
export function isUnavailable(status: AvailabilityStatus): boolean {
  return (
    status === 'OUT' ||
    status === 'IR' ||
    status === 'INACTIVE' ||
    status === 'SCRATCHED' ||
    status === 'NOT_IN_LINEUP' ||
    status === 'DOUBTFUL'
  );
}

export interface GateOptions {
  /** When true, an UNKNOWN availability cannot qualify (use when an injury feed is expected). */
  requireKnownAvailability?: boolean;
  /** Extra note appended to the reason for QUESTIONABLE players that still qualify. */
  note?: string;
}

/**
 * Universal gate: availability -> input quality -> (already computed) edge.
 * Returns the final card status. Never upgrades a PASS/OFF.
 */
export function forcePassIfUnavailable(
  computedStatus: 'BET' | 'PLAY' | 'PASS' | 'OFF',
  computedReason: string,
  availability: AvailabilityStatus,
  inputsSource: InputsSource = 'REAL',
  opts: GateOptions = {}
): { status: 'BET' | 'PASS' | 'OFF'; reason: string; playAllowed: boolean } {
  const wantsPlay = computedStatus === 'BET' || computedStatus === 'PLAY';

  if (isUnavailable(availability)) {
    return { status: 'PASS', reason: `Not available (${availability})`, playAllowed: false };
  }

  if (wantsPlay && availability === 'UNKNOWN' && opts.requireKnownAvailability) {
    return { status: 'PASS', reason: 'Availability unconfirmed — cannot qualify until the injury/lineup report is loaded', playAllowed: false };
  }

  if (wantsPlay && inputsSource !== 'REAL') {
    return {
      status: 'PASS',
      reason: inputsSource === 'ESTIMATED'
        ? 'Estimated inputs — cannot qualify as BET/PLAY'
        : 'Input quality unknown — cannot qualify as BET/PLAY',
      playAllowed: false
    };
  }

  if (wantsPlay) {
    const q = availability === 'QUESTIONABLE' ? ' (listed QUESTIONABLE — confirm before betting)' : '';
    return { status: 'BET', reason: computedReason + q + (opts.note ? ` ${opts.note}` : ''), playAllowed: true };
  }
  return { status: computedStatus === 'OFF' ? 'OFF' : 'PASS', reason: computedReason, playAllowed: false };
}
