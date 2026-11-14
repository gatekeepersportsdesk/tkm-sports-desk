/**
 * Gatekeep Sports Desk — Self-Grading Engine & Seeded History Ledger for Today's Plays Picker
 *
 * Requirements:
 * 1. Freeze membership in that day's exclusive Edge / Safe / Avoid snapshots at board lock or odds import.
 *    Strict precedence:
 *      a) EDGE: valid odds + valid edge + edge > 0 + prob >= 0.55
 *      b) else SAFE: valid odds + valid edge + prob >= safeThreshold
 *      c) else AVOID: no odds or below thresholds
 *    A play MUST appear in ONLY ONE bucket (Edge plays NEVER double-list under Safe).
 * 2. Persist POTD crown (`isPotd: true`) on snapshots so History displays the crowned play & outcome.
 * 3. Idempotent historical CSV seeding (`gatekeep_picker_seed_full_clean.csv` & `_game_by_game_clean.csv`)
 *    for decided NHL and NBA rows only — NEVER seed NFL picker history and NEVER wipe user snapshots.
 */

import { PlayItem } from '../components/common/TodaysPlaysSection';
import { CardRow } from './card_core';
import { PickOfTheDay } from './pick_of_the_day';
import { americanToDecimal } from './odds';

export interface GradedPickerPlay {
  id: string | number;
  player: string;
  team: string;
  opp: string;
  market: string;
  marketLabel?: string;
  side: 'OVER' | 'UNDER' | 'over' | 'under';
  line: number;
  odds: number | null;
  prob: number;
  edge: number;
  modelMu?: number;
  isEdge: boolean;
  isSafe: boolean;
  isAvoid: boolean;
  isPotd?: boolean;
  matchup?: string;
  result: 'HIT' | 'MISS' | 'PUSH' | 'VOID' | null;
  actual: number | null;
}

export interface DailyPickerSnapshot {
  sport: string;
  date: string;
  timestamp: number;
  safeThreshold: number;
  seeded?: boolean;
  plays: GradedPickerPlay[];
}

export interface BucketStats {
  hits: number;
  misses: number;
  voids: number;
  pending: number;
  decided: number;
  hitRate: number | null; // e.g. 64.3 for 64.3%
}

export interface PickerPerformanceSummary {
  sport: string;
  scope: 'today' | '7d' | 'all';
  safeThreshold: number;
  edge: BucketStats;
  safe: BucketStats;
  avoid: BucketStats;
  potd?: BucketStats;
  totalDecided: number;
  totalPending: number;
}

export interface SeededGameRollup {
  date: string;
  sport: string;
  matchup: string;
  totalPlays: number;
  edgePlays: number;
  safePlays: number;
  hits: number;
  misses: number;
  pushes: number;
  voids: number;
  pending: number;
  decided: number;
  winRatePct: number | null;
}

const PICKER_PREFIX = 'gatekeep_picker_snap_v1_';
const INDEX_PREFIX = 'gatekeep_picker_dates_v1_';
const SEED_DONE_KEY = 'gatekeep_picker_seed_hydrated_v1';
const SEED_GBG_KEY = 'gatekeep_picker_seed_gbg_v1';

export function normalizePlayerName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.'’\-]/g, '')
    .replace(/\s+(jr|sr|iii|ii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMarketKey(m: string): string {
  const s = (m || '').toLowerCase().trim();
  if (s === 'sog' || s === 'shots' || s.includes('shot')) return 'shots';
  if (s === 'pts' || s === 'points' || s.includes('point')) return 'points';
  if (s === 'rec' || s === 'receptions' || s.includes('rec')) return 'receptions';
  if (s === 'hit' || s === 'hits' || s.includes('hit')) return 'hits';
  if (s === 'tpm' || s === 'threes' || s.includes('three') || s === '3pm') return 'threes';
  if (s === 'reb' || s === 'rebounds' || s.includes('reb')) return 'rebounds';
  if (s === 'ast' || s === 'assists' || s.includes('assist')) return 'assists';
  if (s === 'stl' || s === 'steals' || s.includes('steal')) return 'steals';
  if (s === 'blk' || s === 'blocks' || s.includes('block')) return 'blocks';
  if (s === 'pra') return 'pra';
  return s;
}

/**
 * Exclusive bucket assignment:
 *  1. EDGE if valid odds + valid edge + edge > 0 + prob >= 0.55
 *  2. else SAFE if valid odds + valid edge + prob >= safeThreshold
 *  3. else AVOID
 */
export function classifyPickerBucket(
  prob: number,
  edge: number | null | undefined,
  hasOdds: boolean,
  safeThreshold = 0.58
): { isEdge: boolean; isSafe: boolean; isAvoid: boolean } {
  const validEdge = edge != null && Number.isFinite(edge) && Math.abs(edge) <= 50;
  const pricedValid = hasOdds && validEdge;
  const isEdge = pricedValid && (edge as number) > 0 && prob >= 0.55;
  const isSafe = !isEdge && pricedValid && prob >= safeThreshold;
  const isAvoid = !isEdge && !isSafe;
  return { isEdge, isSafe, isAvoid };
}

/** Normalize a snapshot play in-place/copy so Edge & Safe are strictly mutually exclusive. */
function ensureExclusivePlay(p: GradedPickerPlay): GradedPickerPlay {
  if (p.isEdge && p.isSafe) {
    return { ...p, isSafe: false, isAvoid: false };
  }
  if (!p.isEdge && !p.isSafe && !p.isAvoid) {
    return { ...p, isAvoid: true };
  }
  return p;
}

export function isMatchingPotd(
  p: Pick<PlayItem | GradedPickerPlay, 'player' | 'market' | 'side' | 'line'>,
  potd: PickOfTheDay | null | undefined
): boolean {
  if (!potd) return false;
  if (normalizePlayerName(p.player) !== normalizePlayerName(potd.player)) return false;
  if (normalizeMarketKey(p.market) !== normalizeMarketKey(potd.market)) return false;
  if (String(p.side).toUpperCase() !== String(potd.side).toUpperCase()) return false;
  return Math.abs(Number(p.line) - Number(potd.line)) < 1e-6;
}

const memoryStore = new Map<string, string>();
let seededGbgCache: SeededGameRollup[] | null = null;
let seedClientPromise: Promise<number> | null = null;

function getItem(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return memoryStore.get(key) || null;
}

function setItem(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(key, val); } catch { /* ignore */ }
  }
  memoryStore.set(key, val);
}

/**
 * Loads list of dates that have frozen picker snapshots for this sport.
 */
export function getStoredDates(sport: string): string[] {
  try {
    const raw = getItem(`${INDEX_PREFIX}${sport}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

export function saveStoredDates(sport: string, dates: string[]): void {
  try {
    setItem(`${INDEX_PREFIX}${sport}`, JSON.stringify(Array.from(new Set(dates)).sort()));
  } catch { /* ignore */ }
}

/**
 * Clears today's (or a specific date's) picker snapshot so corrected odds or inputs can re-freeze clean plays.
 */
export function clearDailyPickerSnapshot(sport: string, date: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${PICKER_PREFIX}${sport}_${date}`);
    }
    memoryStore.delete(`${PICKER_PREFIX}${sport}_${date}`);
  } catch { /* ignore */ }
}

/**
 * Loads a frozen snapshot for a specific date and sport (enforces exclusive buckets on read).
 */
export function getDailyPickerSnapshot(sport: string, date: string): DailyPickerSnapshot | null {
  try {
    const raw = getItem(`${PICKER_PREFIX}${sport}_${date}`);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyPickerSnapshot;
      if (parsed && Array.isArray(parsed.plays)) {
        return {
          ...parsed,
          plays: parsed.plays.map(ensureExclusivePlay)
        };
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Freezes membership in today's exclusive picker buckets and persists POTD crown (`isPotd`).
 */
export function freezePickerSnapshot(
  sport: string,
  date: string,
  plays: PlayItem[],
  safeThreshold = 0.58,
  forceOverwrite = false,
  potd?: PickOfTheDay | null
): DailyPickerSnapshot | null {
  if (!date) return null;

  const existing = getDailyPickerSnapshot(sport, date);
  if (existing && existing.plays.length > 0 && !forceOverwrite) {
    // Preserve frozen membership; only stamp `isPotd` if no play is stamped yet and `potd` matches
    if (potd && !existing.plays.some(x => x.isPotd)) {
      let stamped = false;
      const updatedPlays = existing.plays.map(x => {
        if (!stamped && isMatchingPotd(x, potd)) {
          stamped = true;
          return { ...x, isPotd: true };
        }
        return x;
      });
      if (stamped) {
        const updatedSnap: DailyPickerSnapshot = { ...existing, plays: updatedPlays };
        setItem(`${PICKER_PREFIX}${sport}_${date}`, JSON.stringify(updatedSnap));
        return updatedSnap;
      }
    }
    return existing;
  }

  if (plays.length === 0) return null;

  let potdStamped = false;
  const gradedPlays: GradedPickerPlay[] = plays.map(p => {
    const prob = p.pLean ?? p.prob ?? 0.5;
    const hasOdds = (p.hasMarket !== false) && (p.hasOdds !== false) && p.odds != null;
    const { isEdge, isSafe, isAvoid } = classifyPickerBucket(prob, p.edge, hasOdds, safeThreshold);

    const prev = existing?.plays.find(
      x => x.id === p.id || (x.player === p.player && x.market === p.market && x.side === p.side && x.line === p.line)
    );
    const matchedPotd = !potdStamped && (Boolean(p.isPotd) || isMatchingPotd(p, potd));
    if (matchedPotd) potdStamped = true;

    return {
      id: p.id,
      player: p.player,
      team: p.team,
      opp: p.opp,
      market: p.market,
      marketLabel: p.marketLabel,
      side: p.side,
      line: p.line,
      odds: p.odds,
      prob,
      edge: p.edge,
      isEdge,
      isSafe,
      isAvoid,
      isPotd: matchedPotd || prev?.isPotd || false,
      modelMu: p.modelMu ?? prev?.modelMu,
      result: prev?.result ?? null,
      actual: prev?.actual ?? null
    };
  });

  const snapshot: DailyPickerSnapshot = {
    sport,
    date,
    timestamp: Date.now(),
    safeThreshold,
    plays: gradedPlays
  };

  try {
    setItem(`${PICKER_PREFIX}${sport}_${date}`, JSON.stringify(snapshot));
    const dates = getStoredDates(sport);
    if (!dates.includes(date)) {
      dates.push(date);
      saveStoredDates(sport, dates);
    }
  } catch { /* storage quota ignore */ }

  return snapshot;
}

/* ============================================================================
 * SEED CSV PARSERS & IDEMPOTENT HYDRATION (NHL & NBA ONLY — NEVER NFL)
 * ============================================================================ */

function parseCsvRows(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = parseLine(lines[0]);
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length < 4) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
    out.push(obj);
  }
  return out;
}

function parsePctToUnit(val: string): number {
  const clean = (val || '').replace('%', '').trim();
  const n = parseFloat(clean);
  if (!Number.isFinite(n)) return 0.5;
  return n > 1 ? n / 100 : n;
}

function parseSeedResult(res: string): GradedPickerPlay['result'] {
  const s = (res || '').toUpperCase().trim();
  if (s === 'WON' || s === 'HIT' || s === 'WIN') return 'HIT';
  if (s === 'LOST' || s === 'MISS' || s === 'LOSS') return 'MISS';
  if (s === 'VOID' || s === 'DNP') return 'VOID';
  if (s === 'PUSH') return 'PUSH';
  return null;
}

export function parseSeedGameByGameCsv(csv: string): SeededGameRollup[] {
  const rows = parseCsvRows(csv);
  const out: SeededGameRollup[] = [];
  for (const r of rows) {
    const sport = (r.Sport || '').toUpperCase().trim();
    if (sport !== 'NHL' && sport !== 'NBA') continue; // Never seed NFL
    const wrStr = (r.Win_Rate_Pct || '').replace('%', '').trim();
    const wr = parseFloat(wrStr);
    out.push({
      date: (r.Date || '').trim(),
      sport,
      matchup: (r.Matchup || '').trim(),
      totalPlays: parseInt(r.Total_Plays, 10) || 0,
      edgePlays: parseInt(r.Edge_Plays, 10) || 0,
      safePlays: parseInt(r.Safe_Plays, 10) || 0,
      hits: parseInt(r.Hits_Won, 10) || 0,
      misses: parseInt(r.Misses_Lost, 10) || 0,
      pushes: parseInt(r.Pushes, 10) || 0,
      voids: parseInt(r.Voids, 10) || 0,
      pending: parseInt(r.Pending, 10) || 0,
      decided: parseInt(r.Decided, 10) || 0,
      winRatePct: Number.isFinite(wr) ? wr : null
    });
  }
  return out;
}

export function getSeededGameByGameRollups(sport?: string): SeededGameRollup[] {
  if (!seededGbgCache) {
    try {
      const raw = getItem(SEED_GBG_KEY);
      if (raw) seededGbgCache = JSON.parse(raw) as SeededGameRollup[];
    } catch { /* ignore */ }
  }
  const all = seededGbgCache || [];
  if (!sport || sport === 'all') return all;
  return all.filter(r => r.sport.toLowerCase() === sport.toLowerCase());
}

/**
 * Idempotently imports `gatekeep_picker_seed_full_clean.csv` and optional `gatekeep_picker_seed_game_by_game_clean.csv`.
 * - Decided NHL & NBA rows only (skips NFL unconditionally).
 * - Never overwrites pre-existing user snapshots for a given `(sport, date)`.
 * - Classifies exclusively: EDGE > SAFE > AVOID.
 * - Marks single best-EV priced play per `(sport, date)` as `isPotd: true` so History displays POTD crowns.
 */
export function seedPickerHistoryFromCsv(
  fullCsv: string,
  gbgCsv?: string,
  options?: { force?: boolean }
): { importedDates: number; importedPlays: number; skippedDates: number } {
  if (gbgCsv) {
    const rollups = parseSeedGameByGameCsv(gbgCsv);
    seededGbgCache = rollups;
    setItem(SEED_GBG_KEY, JSON.stringify(rollups));
  }

  const rows = parseCsvRows(fullCsv);
  if (rows.length === 0) return { importedDates: 0, importedPlays: 0, skippedDates: 0 };

  // Group decided NHL & NBA rows by `${sport}_${date}`
  const byBucketKey = new Map<string, { sport: string; date: string; plays: GradedPickerPlay[] }>();

  let rowIdx = 0;
  for (const r of rows) {
    rowIdx++;
    const sportRaw = (r.Sport || '').trim().toUpperCase();
    if (sportRaw !== 'NHL' && sportRaw !== 'NBA') continue; // Never seed NFL
    const sport = sportRaw.toLowerCase();
    const date = (r.Date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const result = parseSeedResult(r.Result);
    if (result === null) continue; // Only seed decided rows

    const rawOdds = (r.Odds || '').trim().replace(/^\+/, '');
    const parsedOdds = rawOdds ? Number(rawOdds) : NaN;
    const odds = Number.isFinite(parsedOdds) && parsedOdds !== 0 ? Math.round(parsedOdds) : null;
    const prob = parsePctToUnit(r.Model_Win_Prob);
    const muVal = parseFloat(r.Model_Mu);
    const modelMu = Number.isFinite(muVal) ? muVal : undefined;
    const edgeVal = parseFloat(r.Edge_pp);
    const edge = Number.isFinite(edgeVal) ? edgeVal : 0;
    const lineVal = parseFloat(r.Line);
    const line = Number.isFinite(lineVal) ? lineVal : 0.5;
    const actVal = parseFloat(r.Actual_Stat);
    const actual = Number.isFinite(actVal) ? actVal : null;
    const rawBuckets = (r.Buckets || '').toUpperCase();
    const hasOdds = odds != null;

    // Enforce exclusive bucket assignment (Edge > Safe > Avoid)
    let isEdge = false;
    let isSafe = false;
    let isAvoid = false;
    const validEdge = Number.isFinite(edge) && Math.abs(edge) <= 50;
    if (hasOdds && validEdge && (rawBuckets.includes('EDGE') || (edge > 0 && prob >= 0.55))) {
      isEdge = true;
    } else if (hasOdds && validEdge && (rawBuckets.includes('SAFE') || prob >= 0.58)) {
      isSafe = true;
    } else {
      isAvoid = true;
    }

    const mktNorm = normalizeMarketKey(r.Market);
    const sideUpper = ((r.Side || 'OVER').toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER') as 'OVER' | 'UNDER';
    const player = (r.Player || '').trim();
    const team = (r.Team || '').trim();
    const opp = (r.Opponent || '').trim();

    const play: GradedPickerPlay = {
      id: `seed:${sport}:${date}:${rowIdx}:${normalizePlayerName(player)}:${mktNorm}`,
      player,
      team,
      opp,
      matchup: (r.Matchup || `${team} vs ${opp}`).trim(),
      market: mktNorm,
      marketLabel: mktNorm === 'shots' ? 'Shots on Goal' : mktNorm === 'pts' || mktNorm === 'points' ? 'Points' : r.Market,
      side: sideUpper,
      line,
      odds,
      prob,
      edge,
      modelMu,
      isEdge,
      isSafe,
      isAvoid,
      isPotd: false,
      result,
      actual
    };

    const k = `${sport}_${date}`;
    const entry = byBucketKey.get(k) || { sport, date, plays: [] };
    entry.plays.push(play);
    byBucketKey.set(k, entry);
  }

  let importedDates = 0;
  let importedPlays = 0;
  let skippedDates = 0;

  for (const { sport, date, plays } of byBucketKey.values()) {
    // Select single highest-EV priced non-avoid play on that date for POTD crown
    let bestEv = 0;
    let bestIdx = -1;
    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      if (p.odds == null || p.isAvoid) continue;
      if (Math.abs(p.edge) > 50) continue;
      const ev = p.prob * americanToDecimal(p.odds) - 1;
      if (ev > bestEv) {
        bestEv = ev;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      plays[bestIdx].isPotd = true;
    }

    const existing = getDailyPickerSnapshot(sport, date);
    if (existing && existing.plays.length > 0 && !options?.force) {
      skippedDates++;
      continue;
    }

    const snap: DailyPickerSnapshot = {
      sport,
      date,
      timestamp: Date.parse(`${date}T23:59:00Z`) || Date.now(),
      safeThreshold: 0.58,
      seeded: true,
      plays
    };

    setItem(`${PICKER_PREFIX}${sport}_${date}`, JSON.stringify(snap));
    const dates = getStoredDates(sport);
    if (!dates.includes(date)) {
      dates.push(date);
      saveStoredDates(sport, dates);
    }
    importedDates++;
    importedPlays += plays.length;
  }

  if (importedDates > 0) {
    setItem(SEED_DONE_KEY, '1');
  }

  return { importedDates, importedPlays, skippedDates };
}

export function loadPickerSeedSync(): { importedDates: number; importedPlays: number; skippedDates: number } {
  if (typeof window !== 'undefined') return { importedDates: 0, importedPlays: 0, skippedDates: 0 };
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      let fs: any = null;
      let path: any = null;
      if (typeof (process as any).getBuiltinModule === 'function') {
        fs = (process as any).getBuiltinModule('fs');
        path = (process as any).getBuiltinModule('path');
      } else {
        const req = (eval)('require');
        fs = req('fs');
        path = req('path');
      }
      if (!fs || !path) return { importedDates: 0, importedPlays: 0, skippedDates: 0 };

      const readCsv = (name: string): string | null => {
        for (const dir of ['public/data', 'public/fixtures', 'public/assets/aistudio']) {
          const p = path.resolve(process.cwd(), dir, name);
          try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch { /* ignore */ }
        }
        return null;
      };
      const full = readCsv('gatekeep_picker_seed_full_clean.csv');
      if (!full) return { importedDates: 0, importedPlays: 0, skippedDates: 0 };
      const gbg = readCsv('gatekeep_picker_seed_game_by_game_clean.csv') || undefined;
      return seedPickerHistoryFromCsv(full, gbg);
    }
  } catch { /* ignore */ }
  return { importedDates: 0, importedPlays: 0, skippedDates: 0 };
}

export async function loadPickerSeedClient(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  if (seedClientPromise) return seedClientPromise;

  seedClientPromise = (async () => {
    try {
      const [fullRes, gbgRes] = await Promise.all([
        fetch('/data/gatekeep_picker_seed_full_clean.csv').catch(() => null),
        fetch('/data/gatekeep_picker_seed_game_by_game_clean.csv').catch(() => null)
      ]);
      if (!fullRes?.ok) return 0;
      const fullCsv = await fullRes.text();
      const gbgCsv = gbgRes?.ok ? await gbgRes.text() : undefined;
      // Always pass through idempotent seeder (fills missing dates, never overwrites user snapshots)
      const res = seedPickerHistoryFromCsv(fullCsv, gbgCsv);
      if (res.importedPlays > 0 || gbgCsv) {
        window.dispatchEvent(new CustomEvent('gatekeep_picker_graded', { detail: { source: 'seed', ...res } }));
      }
      return res.importedPlays;
    } catch (err) {
      console.warn('[picker_grading] Seed CSV load skipped:', err);
      return 0;
    }
  })();

  return seedClientPromise;
}

/**
 * Grades all pending picker plays across stored snapshots against official card rows.
 * Matches by player name, date, and market, and grades the play's own line against the recorded actual stat.
 */
export function gradePickerWithCardRows(sport: string, cardRows: CardRow[]): number {
  if (!cardRows || cardRows.length === 0) return 0;

  let totalGraded = 0;
  const dates = getStoredDates(sport);
  for (const d of dates) {
    const snap = getDailyPickerSnapshot(sport, d);
    if (!snap) continue;

    let modified = false;
    for (const play of snap.plays) {
      if (play.result !== null) continue;

      const pName = normalizePlayerName(play.player);
      const pMkt = normalizeMarketKey(play.market);

      const match = cardRows.find(r => {
        if (r.date !== snap.date) return false;
        if (normalizePlayerName(r.name) !== pName) return false;
        return normalizeMarketKey(r.market) === pMkt;
      });

      if (match && match.result !== null) {
        if (match.result === 'VOID' || match.actual === null || match.actual === undefined) {
          play.result = 'VOID';
          play.actual = match.actual ?? null;
        } else {
          play.actual = match.actual;
          const playOver = play.side.toUpperCase() === 'OVER';
          if (play.actual === play.line) {
            play.result = 'PUSH';
          } else if (playOver ? play.actual > play.line : play.actual < play.line) {
            play.result = 'HIT';
          } else {
            play.result = 'MISS';
          }
        }
        modified = true;
        totalGraded++;
      }
    }

    if (modified) {
      try {
        setItem(`${PICKER_PREFIX}${sport}_${d}`, JSON.stringify(snap));
      } catch { /* ignore */ }
    }
  }
  return totalGraded;
}

/**
 * Grades NBA picker plays directly from official box lines (e.g. ESPN game summaries).
 */
export function gradeNbaPickerWithBoxLines(
  lines: Array<{
    date: string;
    playerId?: number;
    name?: string;
    minutes: number;
    dnp: boolean;
    actual: Record<string, number>;
  }>,
  playerNameMap?: Record<number, string> | Map<number, string>
): number {
  if (!lines || lines.length === 0) return 0;

  let totalGraded = 0;
  const dates = getStoredDates('nba');
  for (const d of dates) {
    const snap = getDailyPickerSnapshot('nba', d);
    if (!snap) continue;

    const dateLines = lines.filter(l => l.date === d);
    if (dateLines.length === 0) continue;

    let modified = false;
    for (const play of snap.plays) {
      if (play.result !== null) continue;

      const pName = normalizePlayerName(play.player);
      const pMkt = normalizeMarketKey(play.market);

      const match = dateLines.find(l => {
        if (l.name && normalizePlayerName(l.name) === pName) return true;
        if (l.playerId && playerNameMap) {
          const mappedName = playerNameMap instanceof Map ? playerNameMap.get(l.playerId) : playerNameMap[l.playerId];
          if (mappedName && normalizePlayerName(mappedName) === pName) return true;
        }
        if (l.playerId && (String(play.id).startsWith(String(l.playerId)) || String(play.id).includes(`_${l.playerId}_`) || String(play.id).startsWith(`${l.playerId}:`))) return true;
        return false;
      });

      if (match) {
        if (match.dnp || match.minutes === 0) {
          play.result = 'VOID';
          play.actual = 0;
        } else {
          const statKey =
            pMkt === 'threes' ? 'tpm' :
            pMkt === 'rebounds' ? 'reb' :
            pMkt === 'assists' ? 'ast' :
            pMkt === 'points' ? 'pts' :
            pMkt === 'steals' ? 'stl' :
            pMkt === 'blocks' ? 'blk' : pMkt;
          const actualMap = (match as any).actual || match;
          const val = pMkt === 'pra'
            ? (actualMap.pra !== undefined && Number.isFinite(actualMap.pra)
                ? actualMap.pra
                : (Number.isFinite(actualMap.pts) && Number.isFinite(actualMap.reb) && Number.isFinite(actualMap.ast)
                    ? Number(actualMap.pts) + Number(actualMap.reb) + Number(actualMap.ast)
                    : undefined))
            : (actualMap[statKey] ?? actualMap[pMkt]);
          if (val !== undefined && Number.isFinite(val)) {
            play.actual = val;
            const playOver = play.side.toUpperCase() === 'OVER';
            if (val === play.line) {
              play.result = 'PUSH';
            } else if (playOver ? val > play.line : val < play.line) {
              play.result = 'HIT';
            } else {
              play.result = 'MISS';
            }
            totalGraded++;
          }
        }
        modified = true;
      }
    }

    if (modified) {
      try {
        setItem(`${PICKER_PREFIX}nba_${d}`, JSON.stringify(snap));
      } catch { /* ignore */ }
    }
  }
  return totalGraded;
}

/**
 * Grades NHL picker plays directly from raw NHL API boxscore objects (supports both shots & points).
 */
export function gradeNhlPickerWithRawBoxes(gamesMap: Record<string, any>, targetDate: string): number {
  if (!gamesMap || Object.keys(gamesMap).length === 0) return 0;
  const snap = getDailyPickerSnapshot('nhl', targetDate);
  if (!snap) return 0;

  const finalPlayers = new Map<string, { sog: number; pts: number; toiSec: number }>();
  for (const box of Object.values(gamesMap)) {
    if (!box) continue;
    const state = String(box.gameState || '').toUpperCase();
    const isFinal = ['OFF', 'FINAL', '7', 'OVER'].includes(state);
    if (!isFinal) continue;

    const grps = [
      ...(box.playerByGameStats?.awayTeam?.forwards || []),
      ...(box.playerByGameStats?.awayTeam?.defense || []),
      ...(box.playerByGameStats?.homeTeam?.forwards || []),
      ...(box.playerByGameStats?.homeTeam?.defense || [])
    ];

    for (const p of grps) {
      if (!p) continue;
      const rawName = String(p.name?.default || p.name || p.playerName || '');
      const normName = normalizePlayerName(rawName);
      const sog = Number(p.sog ?? p.shots ?? 0);
      const pts = Number(p.points != null ? p.points : (Number(p.goals || 0) + Number(p.assists || 0)));
      const toiStr = String(p.toi || '0:00');
      const [m, s] = toiStr.split(':').map(Number);
      const toiSec = (m || 0) * 60 + (s || 0);

      if (normName) finalPlayers.set(normName, { sog, pts, toiSec });
      if (p.playerId) finalPlayers.set(String(p.playerId), { sog, pts, toiSec });
    }
  }

  let graded = 0;
  let modified = false;
  for (const play of snap.plays) {
    if (play.result !== null) continue;
    const pName = normalizePlayerName(play.player);
    const mkt = normalizeMarketKey(play.market);

    const pidToken = String(play.id).split(/[:_]/)[0];
    const match = finalPlayers.get(pName) || finalPlayers.get(pidToken);
    if (!match) continue;

    if (match.toiSec === 0) {
      play.result = 'VOID';
      play.actual = 0;
    } else {
      const val = mkt === 'points' || mkt === 'pts' ? match.pts : match.sog;
      play.actual = val;
      const isOver = play.side.toUpperCase() === 'OVER';
      if (val === play.line) {
        play.result = 'PUSH';
      } else if (isOver ? val > play.line : val < play.line) {
        play.result = 'HIT';
      } else {
        play.result = 'MISS';
      }
    }
    graded++;
    modified = true;
  }

  if (modified) {
    try {
      setItem(`${PICKER_PREFIX}nhl_${targetDate}`, JSON.stringify(snap));
    } catch { /* ignore */ }
  }

  return graded;
}

export interface SweepResult {
  totalGraded: number;
  bySport: Record<string, number>;
  timestamp: number;
  sweepType: 'morning_force' | 'scheduled' | 'manual';
}

export interface LastSweepMeta {
  at: number;
  totalGraded: number;
  bySport: Record<string, number>;
  sweepType?: string;
}

export function getLastSweepMeta(): LastSweepMeta | null {
  try {
    const raw = getItem('gatekeep_last_sweep_meta');
    if (raw) return JSON.parse(raw) as LastSweepMeta;
  } catch { /* ignore */ }
  return null;
}

export async function sweepPendingPickerGrades(options?: { force?: boolean; manual?: boolean }): Promise<SweepResult> {
  const now = new Date();
  const currentHour = now.getHours();
  const isMorningSweep = currentHour >= 5 && currentHour <= 12;
  const force = options?.force || isMorningSweep;

  const result: SweepResult = {
    totalGraded: 0,
    bySport: { nba: 0, nhl: 0, nfl: 0, mlb: 0 },
    timestamp: Date.now(),
    sweepType: options?.manual ? 'manual' : isMorningSweep ? 'morning_force' : 'scheduled'
  };

  const todayIso = now.toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // 1. NBA Sweep
  try {
    const nbaDates = getStoredDates('nba');
    const datesToGrade = nbaDates.filter(d => {
      if (d > todayIso) return false;
      if (force && d >= cutoff) return true;
      const snap = getDailyPickerSnapshot('nba', d);
      return snap && snap.plays.some(p => p.result === null);
    });

    if (datesToGrade.length > 0) {
      const res = await fetch(`/api/nba/actuals?dates=${datesToGrade.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.lines) && data.lines.length > 0) {
          const gradedNba = gradeNbaPickerWithBoxLines(data.lines);
          result.bySport.nba = gradedNba;
          result.totalGraded += gradedNba;
        }
      }
    }
  } catch (err) {
    console.warn('[sweep] NBA error:', err);
  }

  // 2. NHL Sweep
  try {
    const nhlDates = getStoredDates('nhl');
    const datesToGrade = nhlDates.filter(d => {
      if (d > todayIso) return false;
      if (force && d >= cutoff) return true;
      const snap = getDailyPickerSnapshot('nhl', d);
      return snap && snap.plays.some(p => p.result === null);
    });

    for (const d of datesToGrade) {
      try {
        const sRes = await fetch(`/api/nhl/schedule?date=${d}`);
        if (sRes.ok) {
          const sData = await sRes.json();
          const gameIds = (sData?.games || []).map((g: any) => g.id || g.gameId).filter(Boolean);
          if (gameIds.length > 0) {
            const bRes = await fetch(`/api/nhl/boxscores?gameIds=${gameIds.join(',')}`);
            if (bRes.ok) {
              const bData = await bRes.json();
              if (bData?.games) {
                const graded = gradeNhlPickerWithRawBoxes(bData.games, d);
                result.bySport.nhl += graded;
                result.totalGraded += graded;
              }
            }
          }
        }
      } catch { /* continue */ }
    }
  } catch (err) {
    console.warn('[sweep] NHL error:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gatekeep_sweep_requested', { detail: { force, manual: options?.manual } }));
  }

  try {
    setItem('gatekeep_last_sweep_meta', JSON.stringify({
      at: Date.now(),
      totalGraded: result.totalGraded,
      bySport: result.bySport,
      sweepType: result.sweepType
    }));
  } catch { /* ignore */ }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gatekeep_picker_graded', { detail: result }));
  }

  return result;
}

function emptyBucket(): BucketStats {
  return { hits: 0, misses: 0, voids: 0, pending: 0, decided: 0, hitRate: null };
}

function addOutcome(b: BucketStats, result: GradedPickerPlay['result']): void {
  if (result === 'HIT') {
    b.hits++;
    b.decided++;
  } else if (result === 'MISS') {
    b.misses++;
    b.decided++;
  } else if (result === 'VOID' || result === 'PUSH') {
    b.voids++;
  } else {
    b.pending++;
  }
}

function finalizeBucket(b: BucketStats): void {
  b.hitRate = b.decided > 0 ? parseFloat(((b.hits / b.decided) * 100).toFixed(1)) : null;
}

function resolveTargetDates(dates: string[], scope: 'today' | '7d' | 'all', todayIso: string): string[] {
  if (scope === 'today') return [todayIso];
  if (scope === '7d') {
    const baseMs = Date.parse(`${todayIso}T00:00:00Z`);
    const cutoffStr = Number.isFinite(baseMs)
      ? new Date(baseMs - 7 * 86400000).toISOString().slice(0, 10)
      : new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const out = dates.filter(d => d >= cutoffStr);
    if (!out.includes(todayIso)) out.push(todayIso);
    return out;
  }
  return dates;
}

/**
 * Calculates summary performance metrics for Today's Plays picker using strictly exclusive buckets.
 */
export function getPickerPerformance(
  sport: string,
  scope: 'today' | '7d' | 'all',
  todayIso: string,
  filterMarket: string = 'all'
): PickerPerformanceSummary {
  const dates = getStoredDates(sport);
  const targetDates = resolveTargetDates(dates, scope, todayIso);
  const normFilterMkt = filterMarket !== 'all' ? normalizeMarketKey(filterMarket) : 'all';

  const edge = emptyBucket();
  const safe = emptyBucket();
  const avoid = emptyBucket();
  const potd = emptyBucket();
  let defaultSafeThresh = 0.58;

  for (const d of targetDates) {
    const snap = getDailyPickerSnapshot(sport, d);
    if (!snap) continue;
    if (snap.safeThreshold) defaultSafeThresh = snap.safeThreshold;

    for (const rawP of snap.plays) {
      const p = ensureExclusivePlay(rawP);
      if (normFilterMkt !== 'all' && normalizeMarketKey(p.market) !== normFilterMkt) continue;

      if (p.isEdge) addOutcome(edge, p.result);
      else if (p.isSafe) addOutcome(safe, p.result);
      else addOutcome(avoid, p.result);

      if (p.isPotd) addOutcome(potd, p.result);
    }
  }

  finalizeBucket(edge);
  finalizeBucket(safe);
  finalizeBucket(avoid);
  finalizeBucket(potd);

  const totalDecided = edge.decided + safe.decided;
  const totalPending = edge.pending + safe.pending + avoid.pending;

  return {
    sport,
    scope,
    safeThreshold: defaultSafeThresh,
    edge,
    safe,
    avoid,
    potd,
    totalDecided,
    totalPending
  };
}

export interface InspectedPickerPlay extends GradedPickerPlay {
  sport: string;
  date: string;
}

/**
 * Loads all plays across stored picker snapshots for interactive inspection and auditing.
 */
export function getPickerPlaysForInspection(
  sport: string, // 'nba' | 'nhl' | 'nfl' | 'mlb' | 'all'
  scope: 'today' | '7d' | 'all',
  todayIso: string,
  filterBucket: 'all' | 'edge' | 'safe' | 'avoid' = 'all',
  filterResult: 'all' | 'HIT' | 'MISS' | 'PUSH' | 'VOID' | 'PENDING' = 'all',
  filterMarket: string = 'all',
  potdOnly: boolean = false
): InspectedPickerPlay[] {
  const sportsToScan = sport === 'all' ? ['nba', 'nhl', 'nfl', 'mlb'] : [sport];
  const out: InspectedPickerPlay[] = [];
  const normFilterMkt = filterMarket !== 'all' ? normalizeMarketKey(filterMarket) : 'all';

  for (const sp of sportsToScan) {
    const dates = getStoredDates(sp);
    const targetDates = resolveTargetDates(dates, scope, todayIso);

    for (const d of targetDates) {
      const snap = getDailyPickerSnapshot(sp, d);
      if (!snap) continue;

      for (const rawP of snap.plays) {
        const p = ensureExclusivePlay(rawP);
        if (potdOnly && !p.isPotd) continue;
        if (normFilterMkt !== 'all' && normalizeMarketKey(p.market) !== normFilterMkt) continue;

        if (filterBucket === 'edge' && !p.isEdge) continue;
        if (filterBucket === 'safe' && !p.isSafe) continue;
        if (filterBucket === 'avoid' && !p.isAvoid) continue;

        if (filterResult === 'HIT' && p.result !== 'HIT') continue;
        if (filterResult === 'MISS' && p.result !== 'MISS') continue;
        if (filterResult === 'PUSH' && p.result !== 'PUSH') continue;
        if (filterResult === 'VOID' && p.result !== 'VOID') continue;
        if (filterResult === 'PENDING' && p.result !== null) continue;

        out.push({
          ...p,
          sport: sp,
          date: d
        });
      }
    }
  }

  // Sort: most recent date first, POTD first within date, then Edge, then prob descending
  out.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (Boolean(a.isPotd) !== Boolean(b.isPotd)) return a.isPotd ? -1 : 1;
    if (a.isEdge !== b.isEdge) return a.isEdge ? -1 : 1;
    if (a.isSafe !== b.isSafe) return a.isSafe ? -1 : 1;
    return b.prob - a.prob;
  });

  return out;
}

/**
 * Aggregates picker performance across ALL sports models.
 */
export function getAllSportsPickerPerformance(
  scope: 'today' | '7d' | 'all',
  todayIso: string,
  filterMarket: string = 'all'
): PickerPerformanceSummary {
  const sports = ['nba', 'nhl', 'nfl', 'mlb'];
  const edge = emptyBucket();
  const safe = emptyBucket();
  const avoid = emptyBucket();
  const potd = emptyBucket();

  for (const sp of sports) {
    const perf = getPickerPerformance(sp, scope, todayIso, filterMarket);
    edge.hits += perf.edge.hits;
    edge.misses += perf.edge.misses;
    edge.voids += perf.edge.voids;
    edge.pending += perf.edge.pending;
    edge.decided += perf.edge.decided;

    safe.hits += perf.safe.hits;
    safe.misses += perf.safe.misses;
    safe.voids += perf.safe.voids;
    safe.pending += perf.safe.pending;
    safe.decided += perf.safe.decided;

    avoid.hits += perf.avoid.hits;
    avoid.misses += perf.avoid.misses;
    avoid.voids += perf.avoid.voids;
    avoid.pending += perf.avoid.pending;
    avoid.decided += perf.avoid.decided;

    if (perf.potd) {
      potd.hits += perf.potd.hits;
      potd.misses += perf.potd.misses;
      potd.voids += perf.potd.voids;
      potd.pending += perf.potd.pending;
      potd.decided += perf.potd.decided;
    }
  }

  finalizeBucket(edge);
  finalizeBucket(safe);
  finalizeBucket(avoid);
  finalizeBucket(potd);

  return {
    sport: 'all',
    scope,
    safeThreshold: 0.58,
    edge,
    safe,
    avoid,
    potd,
    totalDecided: edge.decided + safe.decided,
    totalPending: edge.pending + safe.pending + avoid.pending
  };
}

export function downloadPickerExport(filename: string, content: string, mimeType: string = 'text/csv'): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates full row-by-row dataset CSV of picker plays (strict exclusive bucket + POTD flag).
 */
export function exportPickerFullDatasetCsv(
  sport: string,
  scope: 'today' | '7d' | 'all',
  todayIso: string
): string {
  const plays = getPickerPlaysForInspection(sport, scope, todayIso, 'all', 'all');
  const headers = [
    'Date',
    'Sport',
    'Matchup',
    'Player',
    'Team',
    'Opponent',
    'Market',
    'Side',
    'Line',
    'Odds',
    'Model_Win_Prob',
    'Model_Mu',
    'Edge_pp',
    'Buckets',
    'Result',
    'Actual_Stat',
    'Is_POTD'
  ];

  const rows = plays.map(p => {
    const bStr = p.isEdge ? 'EDGE' : p.isSafe ? 'SAFE' : 'AVOID';
    const matchup = p.matchup || `${p.team || ''} vs ${p.opp || ''}`.trim();
    const resultStr = p.result === 'HIT' ? 'WON' : p.result === 'MISS' ? 'LOST' : p.result ?? 'PENDING';
    const oddsStr = p.odds != null ? (p.odds > 0 ? `+${p.odds}` : `${p.odds}`) : '';
    const probStr = (p.prob * 100).toFixed(1) + '%';
    const edgeStr = p.edge != null ? p.edge.toFixed(1) : '';
    const muStr = p.modelMu != null ? p.modelMu.toFixed(2) : '';
    const actStr = p.actual != null ? String(p.actual) : '';
    const potdStr = p.isPotd ? 'POTD' : '';

    return [
      p.date,
      p.sport.toUpperCase(),
      `"${matchup}"`,
      `"${(p.player || '').replace(/"/g, '""')}"`,
      p.team || '',
      p.opp || '',
      p.marketLabel || p.market,
      p.side.toUpperCase(),
      p.line,
      oddsStr,
      probStr,
      muStr,
      edgeStr,
      bStr,
      resultStr,
      actStr,
      potdStr
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Generates game-by-game aggregated CSV of picker performance with win rate per game matchup (exclusive buckets).
 */
export function exportPickerGameByGameCsv(
  sport: string,
  scope: 'today' | '7d' | 'all',
  todayIso: string
): string {
  const plays = getPickerPlaysForInspection(sport, scope, todayIso, 'all', 'all');

  const gamesMap = new Map<string, {
    date: string;
    sport: string;
    matchup: string;
    totalPlays: number;
    edgePlays: number;
    safePlays: number;
    hits: number;
    misses: number;
    pushes: number;
    voids: number;
    pending: number;
    decided: number;
  }>();

  for (const p of plays) {
    const matchup = p.matchup || `${p.team || 'UNK'} vs ${p.opp || 'UNK'}`;
    const key = `${p.date}_${p.sport}_${matchup}`;
    if (!gamesMap.has(key)) {
      gamesMap.set(key, {
        date: p.date,
        sport: p.sport.toUpperCase(),
        matchup,
        totalPlays: 0,
        edgePlays: 0,
        safePlays: 0,
        hits: 0,
        misses: 0,
        pushes: 0,
        voids: 0,
        pending: 0,
        decided: 0
      });
    }

    const g = gamesMap.get(key)!;
    g.totalPlays++;
    if (p.isEdge) g.edgePlays++;
    else if (p.isSafe) g.safePlays++;
    if (p.result === 'HIT') { g.hits++; g.decided++; }
    else if (p.result === 'MISS') { g.misses++; g.decided++; }
    else if (p.result === 'PUSH') { g.pushes++; }
    else if (p.result === 'VOID') { g.voids++; }
    else { g.pending++; }
  }

  const headers = [
    'Date',
    'Sport',
    'Matchup',
    'Total_Plays',
    'Edge_Plays',
    'Safe_Plays',
    'Hits_Won',
    'Misses_Lost',
    'Pushes',
    'Voids',
    'Pending',
    'Decided',
    'Win_Rate_Pct'
  ];

  const rows: string[] = [];
  for (const g of gamesMap.values()) {
    const winRate = g.decided > 0 ? ((g.hits / g.decided) * 100).toFixed(1) + '%' : '—';
    rows.push([
      g.date,
      g.sport,
      `"${g.matchup}"`,
      g.totalPlays,
      g.edgePlays,
      g.safePlays,
      g.hits,
      g.misses,
      g.pushes,
      g.voids,
      g.pending,
      g.decided,
      winRate
    ].join(','));
  }

  return [headers.join(','), ...rows].join('\n');
}
