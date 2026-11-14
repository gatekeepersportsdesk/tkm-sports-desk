/**
 * Gatekeep Sports Desk — Self-Grading Engine for Today's Plays Picker
 *
 * Requirements:
 * 1. Freeze membership in that day's Edge / Safe / Avoid snapshots at board lock or at first grade
 *    for the slate date (do not reshuffle historical membership after the fact).
 * 2. When games finalize / box scores grade (same pipeline as daily card grading), grade membership.
 * 3. Use REAL graded outcomes only; void DNP (exclude from hit rate); exclude pending from rates.
 * 4. Aggregate picker performance across scopes:
 *    - 'today': Current slate date
 *    - '7d': Last 7 days
 *    - 'all': Cumulative
 * 5. Track Edge, Safe, and Avoid buckets.
 */

import { PlayItem } from '../components/common/TodaysPlaysSection';
import { CardRow } from './card_core';

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
  result: 'HIT' | 'MISS' | 'PUSH' | 'VOID' | null;
  actual: number | null;
}

export interface DailyPickerSnapshot {
  sport: string;
  date: string;
  timestamp: number;
  safeThreshold: number;
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
  totalDecided: number;
  totalPending: number;
}

const PICKER_PREFIX = 'gatekeep_picker_snap_v1_';
const INDEX_PREFIX = 'gatekeep_picker_dates_v1_';

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
  if (s === 'tpm' || s === 'threes' || s.includes('three')) return 'threes';
  if (s === 'reb' || s === 'rebounds' || s.includes('reb')) return 'rebounds';
  if (s === 'ast' || s === 'assists' || s.includes('assist')) return 'assists';
  if (s === 'pra') return 'pra';
  return s;
}

const memoryStore = new Map<string, string>();

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
    setItem(`${INDEX_PREFIX}${sport}`, JSON.stringify(Array.from(new Set(dates))));
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
 * Loads a frozen snapshot for a specific date and sport.
 */
export function getDailyPickerSnapshot(sport: string, date: string): DailyPickerSnapshot | null {
  try {
    const raw = getItem(`${PICKER_PREFIX}${sport}_${date}`);
    if (raw) {
      return JSON.parse(raw) as DailyPickerSnapshot;
    }
  } catch { /* ignore */ }
  return null;
}


/**
 * Freezes membership in today's picker buckets.
 * - If a snapshot for this date already exists and forceOverwrite is false: returns existing snapshot untouched.
 * - When forceOverwrite is true (e.g. on new odds import or force re-log): re-evaluates buckets with fresh odds
 *   while preserving any already-decided graded results.
 */
export function freezePickerSnapshot(
  sport: string,
  date: string,
  plays: PlayItem[],
  safeThreshold = 0.58,
  forceOverwrite = false
): DailyPickerSnapshot | null {
  if (!date) return null;

  // 1. Check if already frozen for this slate date
  const existing = getDailyPickerSnapshot(sport, date);
  if (existing && existing.plays.length > 0 && !forceOverwrite) {
    return existing; // Frozen, do not reshuffle historical membership
  }

  if (plays.length === 0) return null;

  // 2. Classify each play into the buckets
  const gradedPlays: GradedPickerPlay[] = plays.map(p => {
    const prob = p.pLean ?? p.prob ?? 0.5;
    const hasOdds = (p.hasMarket !== false) && (p.hasOdds !== false) && p.odds != null;

    const isAvoid = !hasOdds || prob < 0.50;
    const isEdge = !isAvoid && p.edge > 0 && prob >= 0.55;
    const isSafe = !isAvoid && prob >= safeThreshold;

    // Retain previous result if this identical play was already graded
    const prev = existing?.plays.find(x => x.id === p.id || (x.player === p.player && x.market === p.market && x.side === p.side && x.line === p.line));

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
      if (play.result !== null) continue; // Already graded

      const pName = normalizePlayerName(play.player);
      const pMkt = normalizeMarketKey(play.market);

      // Find matching card row by player name and market
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

      // Find player line in dateLines
      const match = dateLines.find(l => {
        if (l.name && normalizePlayerName(l.name) === pName) return true;
        if (l.playerId && playerNameMap) {
          const mappedName = playerNameMap instanceof Map ? playerNameMap.get(l.playerId) : playerNameMap[l.playerId];
          if (mappedName && normalizePlayerName(mappedName) === pName) return true;
        }
        if (l.playerId && (String(play.id).startsWith(String(l.playerId)) || String(play.id).includes(`_${l.playerId}_`))) return true;
        return false;
      });

      if (match) {
        if (match.dnp || match.minutes === 0) {
          play.result = 'VOID';
          play.actual = 0;
        } else {
          const statKey = pMkt === 'threes' ? 'tpm' : pMkt === 'rebounds' ? 'reb' : pMkt === 'assists' ? 'ast' : pMkt === 'points' ? 'pts' : pMkt;
          const actualMap = (match as any).actual || match;
          const val = actualMap[statKey] ?? actualMap[pMkt];
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
 * Grades NHL picker plays directly from raw NHL API boxscore objects.
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

    const match = finalPlayers.get(pName) || finalPlayers.get(String(play.id).split('_')[0]);
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

/**
 * Shared overnight & morning-safe grading pipeline across all sports.
 * On any run after 05:00 local (or when force=true), force-sweeps the last 7 days so
 * prior slate dates (like yesterday's games) are settled and never left sitting Pending.
 */
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

  // 3. Dispatch sweep request for mounted desk controllers (e.g. CardBoard, scoreboards)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gatekeep_sweep_requested', { detail: { force, manual: options?.manual } }));
  }

  // Save sweep metadata
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

/**
 * Calculates summary performance metrics for Today's Plays picker.
 */
export function getPickerPerformance(
  sport: string,
  scope: 'today' | '7d' | 'all',
  todayIso: string
): PickerPerformanceSummary {
  const dates = getStoredDates(sport);

  let targetDates: string[] = [];
  if (scope === 'today') {
    targetDates = [todayIso];
  } else if (scope === '7d') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    targetDates = dates.filter(d => d >= cutoffStr);
    if (!targetDates.includes(todayIso)) targetDates.push(todayIso);
  } else {
    targetDates = dates;
  }

  const edge = emptyBucket();
  const safe = emptyBucket();
  const avoid = emptyBucket();
  let defaultSafeThresh = 0.58;

  for (const d of targetDates) {
    const snap = getDailyPickerSnapshot(sport, d);
    if (!snap) continue;
    if (snap.safeThreshold) defaultSafeThresh = snap.safeThreshold;

    for (const p of snap.plays) {
      if (p.isEdge) addOutcome(edge, p.result);
      if (p.isSafe) addOutcome(safe, p.result);
      if (p.isAvoid) addOutcome(avoid, p.result);
    }
  }

  finalizeBucket(edge);
  finalizeBucket(safe);
  finalizeBucket(avoid);

  const totalDecided = edge.decided + safe.decided;
  const totalPending = edge.pending + safe.pending + avoid.pending;

  return {
    sport,
    scope,
    safeThreshold: defaultSafeThresh,
    edge,
    safe,
    avoid,
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
  filterResult: 'all' | 'HIT' | 'MISS' | 'PUSH' | 'VOID' | 'PENDING' = 'all'
): InspectedPickerPlay[] {
  const sportsToScan = sport === 'all' ? ['nba', 'nhl', 'nfl', 'mlb'] : [sport];
  const out: InspectedPickerPlay[] = [];

  for (const sp of sportsToScan) {
    const dates = getStoredDates(sp);
    let targetDates: string[] = [];
    if (scope === 'today') {
      targetDates = [todayIso];
    } else if (scope === '7d') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      targetDates = dates.filter(d => d >= cutoffStr);
      if (!targetDates.includes(todayIso)) targetDates.push(todayIso);
    } else {
      targetDates = dates;
    }

    for (const d of targetDates) {
      const snap = getDailyPickerSnapshot(sp, d);
      if (!snap) continue;

      for (const p of snap.plays) {
        // Bucket filter
        if (filterBucket === 'edge' && !p.isEdge) continue;
        if (filterBucket === 'safe' && !p.isSafe) continue;
        if (filterBucket === 'avoid' && !p.isAvoid) continue;

        // Result filter
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

  // Sort: most recent date first, then by Edge status, then prob descending
  out.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.isEdge !== b.isEdge) return a.isEdge ? -1 : 1;
    return b.prob - a.prob;
  });

  return out;
}

/**
 * Aggregates picker performance across ALL sports models.
 */
export function getAllSportsPickerPerformance(
  scope: 'today' | '7d' | 'all',
  todayIso: string
): PickerPerformanceSummary {
  const sports = ['nba', 'nhl', 'nfl', 'mlb'];
  const edge = emptyBucket();
  const safe = emptyBucket();
  const avoid = emptyBucket();

  for (const sp of sports) {
    const perf = getPickerPerformance(sp, scope, todayIso);
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
  }

  finalizeBucket(edge);
  finalizeBucket(safe);
  finalizeBucket(avoid);

  return {
    sport: 'all',
    scope,
    safeThreshold: 0.58,
    edge,
    safe,
    avoid,
    totalDecided: edge.decided + safe.decided,
    totalPending: edge.pending + safe.pending + avoid.pending
  };
}

/**
 * Client-side browser download helper for CSV or JSON files.
 */
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
 * Generates full row-by-row dataset CSV of picker plays for auditing and record-keeping.
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
    'Actual_Stat'
  ];

  const rows = plays.map(p => {
    const buckets: string[] = [];
    if (p.isEdge) buckets.push('EDGE');
    if (p.isSafe) buckets.push('SAFE');
    if (p.isAvoid) buckets.push('AVOID');
    const bStr = buckets.length ? buckets.join('+') : 'ALL';
    const matchup = `${p.team || ''} vs ${p.opp || ''}`.trim();
    const resultStr = p.result === 'HIT' ? 'WON' : p.result === 'MISS' ? 'LOST' : p.result ?? 'PENDING';
    const oddsStr = p.odds != null ? (p.odds > 0 ? `+${p.odds}` : `${p.odds}`) : '';
    const probStr = (p.prob * 100).toFixed(1) + '%';
    const edgeStr = p.edge != null ? p.edge.toFixed(1) : '';
    const muStr = p.modelMu != null ? p.modelMu.toFixed(2) : '';
    const actStr = p.actual != null ? String(p.actual) : '';

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
      actStr
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Generates game-by-game aggregated CSV of picker performance with win rate per game matchup.
 */
export function exportPickerGameByGameCsv(
  sport: string,
  scope: 'today' | '7d' | 'all',
  todayIso: string
): string {
  const plays = getPickerPlaysForInspection(sport, scope, todayIso, 'all', 'all');

  // Group by date + sport + matchup
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
    const matchup = `${p.team || 'UNK'} vs ${p.opp || 'UNK'}`;
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
    if (p.isSafe) g.safePlays++;
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


