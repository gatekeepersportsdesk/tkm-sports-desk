/**
 * Sport-agnostic core of the automatic daily card. Every sport (NBA, NFL, MLB, NHL) logs rows in this shape before the
 * game and grades them from official results afterwards; only the capture (what the model priced) and the outcome lookup
 * (where the official result comes from) differ per sport. Nothing here prices anything.
 *
 * Honesty rules shared by every sport:
 *  - only pre-game rows are captured and a captured row is never rewritten;
 *  - a player who did not play is VOID (never a zero, never a miss) and is excluded from every statistic;
 *  - headline numbers use REAL inputs with a known availability only; estimated / unknown rows are kept but reported apart;
 *  - the win rate is measured at the model's own line (about its mean). Counts are right-skewed, so UNDER wins more than half
 *    the time there for ANY model: the always-UNDER / always-OVER baselines are returned beside it. MAE against a naive
 *    average and interval coverage are the real quality tests.
 */
import { AvailabilityStatus, InputsSource } from './availability';
import { gradeActual, nbinomPmf } from '../model/nhl_engine';
import { discretePit, pitCoverage, hashUnit } from '../model/calibration';

export interface CardRow {
  id: string;
  date: string;
  capturedAt: number;
  gameId: string;
  market: string;
  playerId: number | string;
  name: string;
  team: string;
  opp: string;
  mu: number;
  /** negative-binomial size; null when the market is not a count distribution (MLB hit yes/no) */
  r: number | null;
  line: number;
  lean: 'OVER' | 'UNDER';
  /** P(over the line), push removed */
  pOver: number;
  /** projected exposure (minutes for NBA / NHL, at-bats for MLB, null when the sport has none) */
  pm: number | null;
  /** naive comparator: season / recent per-game average of the stat before the game (null = none) */
  avg: number | null;
  inputs: InputsSource;
  avail: AvailabilityStatus;
  result: 'HIT' | 'MISS' | 'PUSH' | 'VOID' | null;
  actual: number | null;
  /** actual exposure (minutes / at-bats) */
  minutes: number | null;
  /** actual - mu */
  err: number | null;
  reason?: string;
  gradedAt?: number;
  /** NFL only: needed to fetch the week's official grades */
  season?: number;
  week?: number;
}

export type Outcome =
  | { state: 'final'; actual: number; exposure: number | null; detail?: string }
  | { state: 'dnp' }
  | { state: 'postponed' }
  | { state: 'notfinal' }
  /** the official source has nothing for this game (yet) */
  | { state: 'missing' };

export interface CardLabels {
  /** word for the exposure in reasons: 'minutes' | 'ice time' | 'at-bats' */
  exposure: string;
  /** short suffix for the actual exposure: 'm' | 'm' | ' AB' */
  exposureSuffix: string;
  /** reasons only blame exposure when this is true */
  blameExposure: boolean;
}
export const LABELS: Record<'nba' | 'nhl' | 'nfl' | 'mlb', CardLabels> = {
  nba: { exposure: 'minutes', exposureSuffix: 'm', blameExposure: true },
  nhl: { exposure: 'ice time', exposureSuffix: 'm', blameExposure: true },
  nfl: { exposure: '', exposureSuffix: '', blameExposure: false },
  mlb: { exposure: 'at-bats', exposureSuffix: ' AB', blameExposure: true }
};

const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const f2 = (x: number) => (Math.round(x * 100) / 100).toString();

/** A short, factual explanation built only from numbers we have (no invented causes). */
export function reasonFor(
  r: Pick<CardRow, 'mu' | 'r' | 'line' | 'lean' | 'pm'>, actual: number, exposure: number | null, result: 'HIT' | 'MISS' | 'PUSH', lab: CardLabels, fmt: (x: number) => string = f1
): string {
  const ex = exposure !== null && lab.exposureSuffix ? ` in ${Math.round(exposure)}${lab.exposureSuffix}` : '';
  const head = `Model ${fmt(r.mu)} vs ${r.line}. Actual ${actual}${ex}`;
  if (result === 'PUSH') return `PUSH (${r.lean}): ${head} — landed exactly on the line.`;
  if (result === 'HIT') return `WON (${r.lean}): ${head} — ${r.lean === 'OVER' ? 'cleared' : 'stayed under'}.`;
  const higher = actual > r.line; // the outcome landed above the line (the lean was UNDER)
  const parts: string[] = [];
  if (lab.blameExposure && exposure !== null && r.pm && r.pm > 0) {
    const dm = exposure - r.pm;
    if (Math.abs(dm) >= Math.max(lab.exposure === 'at-bats' ? 1 : 4, 0.12 * r.pm) && (dm > 0) === higher) parts.push(`${lab.exposure} ${higher ? 'higher' : 'lower'} than projected (${Math.round(exposure)} vs ${Math.round(r.pm)})`);
    const projRate = r.mu / r.pm;
    const ratio = projRate > 0 && exposure > 0 ? actual / exposure / projRate : 1;
    if (higher ? ratio >= 1.15 : ratio <= 0.85) parts.push(`per-${lab.exposure === 'at-bats' ? 'at-bat' : 'minute'} production ${higher ? 'higher' : 'lower'} than projected`);
  }
  const sd = r.r !== null ? Math.sqrt(r.mu + (r.mu * r.mu) / r.r) : Math.sqrt(Math.max(r.mu * (1 - Math.min(r.mu, 0.99)), 0.05));
  const tail = parts.length ? parts.join('; ') : `within normal variance (model sd about ${f1(sd)})`;
  return `LOST (${r.lean}): ${head} — ${tail}.`;
}

/** New rows are added; an existing row is never overwritten (graded or not). */
export function mergeCardRows<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map(r => r.id));
  const add = incoming.filter(r => !seen.has(r.id));
  return add.length ? [...existing, ...add] : existing;
}

/** Grade pending rows with a sport-specific outcome lookup. DNP / zero exposure = VOID; a game that never appears long after its date = VOID. */
export function gradeCardRows<T extends CardRow>(
  rows: T[], resolve: (row: T) => Outcome, today: string, lab: CardLabels, opts: { staleDays?: number; now?: number; fmt?: (x: number) => string } = {}
): { rows: T[]; graded: number; pending: number; voided: number } {
  const stale = opts.staleDays ?? 7, now = opts.now ?? Date.now();
  let graded = 0, pending = 0, voided = 0;
  const age = (d: string) => Math.floor((Date.parse(today) - Date.parse(d)) / 86400000);
  const out = rows.map(r => {
    if (r.result !== null) return r;
    const o = resolve(r);
    if (o.state === 'notfinal') { pending++; return r; }
    if (o.state === 'missing') {
      if (age(r.date) > stale) { voided++; return { ...r, result: 'VOID' as const, reason: 'VOID: the game never appeared in the official results (postponed / cancelled?).', gradedAt: now }; }
      pending++; return r;
    }
    if (o.state === 'postponed') { voided++; return { ...r, result: 'VOID' as const, reason: 'VOID: game postponed / cancelled.', gradedAt: now }; }
    if (o.state === 'dnp') { voided++; return { ...r, result: 'VOID' as const, minutes: 0, reason: 'VOID: did not play. Excluded from every statistic.', gradedAt: now }; }
    graded++;
    const side = gradeActual(o.actual, r.line);
    const result = side === 'PUSH' ? 'PUSH' : (side === 'OVER') === (r.lean === 'OVER') ? 'HIT' : 'MISS';
    return { ...r, actual: o.actual, minutes: o.exposure, err: o.actual - r.mu, result: result as 'HIT' | 'MISS' | 'PUSH', reason: reasonFor(r, o.actual, o.exposure, result, lab, opts.fmt), gradedAt: now };
  });
  return { rows: out, graded, pending, voided };
}

/** Headline statistics use REAL inputs with a known availability only. */
export const isHeadline = (r: Pick<CardRow, 'inputs' | 'avail'>) => r.inputs === 'REAL' && r.avail !== 'UNKNOWN';

export interface MarketStats { market: string; n: number; mae: number | null; bias: number | null; maeNaive: number | null; nNaive: number; maeOnNaive: number | null; coverage: (number | null)[] }
export interface CardSummary {
  logged: number; pending: number; voided: number; pushed: number; decided: number; hits: number; winRate: number | null;
  over: { n: number; hits: number }; under: { n: number; hits: number };
  brier: number | null; meanPOver: number | null; overRate: number | null;
  /** win rate of blindly leaning UNDER (resp. OVER) on every decided row at these lines */
  alwaysUnder: number | null; alwaysOver: number | null;
  byMarket: MarketStats[];
}

export function summarizeCard<T extends CardRow>(all: T[], markets: string[], includeEstimated = false): CardSummary {
  const rows = all.filter(r => includeEstimated || isHeadline(r));
  const decided = rows.filter(r => r.result === 'HIT' || r.result === 'MISS');
  const hits = decided.filter(r => r.result === 'HIT').length;
  const side = (s: 'OVER' | 'UNDER') => { const d = decided.filter(r => r.lean === s); return { n: d.length, hits: d.filter(r => r.result === 'HIT').length }; };
  const played = rows.filter(r => (r.result === 'HIT' || r.result === 'MISS' || r.result === 'PUSH') && r.actual !== null);
  const bin = played.filter(r => r.result !== 'PUSH');
  const brier = bin.length ? bin.reduce((s, r) => s + (r.pOver - (r.actual! > r.line ? 1 : 0)) ** 2, 0) / bin.length : null;
  const byMarket = markets.map(m => {
    const d = played.filter(r => r.market === m);
    const ae = d.map(r => Math.abs(r.actual! - r.mu));
    const withAvg = d.filter(r => r.avg !== null);
    const nb = d.filter(r => r.r !== null);
    const cov = nb.length ? pitCoverage(nb.map(r => discretePit(k => nbinomPmf(k, r.mu, r.r!), r.actual!, hashUnit(r.id)))).map(c => c.observed) : [null, null, null];
    return {
      market: m, n: d.length,
      mae: d.length ? ae.reduce((a, b) => a + b, 0) / d.length : null,
      bias: d.length ? d.reduce((s, r) => s + r.err!, 0) / d.length : null,
      maeNaive: withAvg.length ? withAvg.reduce((s, r) => s + Math.abs(r.actual! - r.avg!), 0) / withAvg.length : null,
      nNaive: withAvg.length,
      maeOnNaive: withAvg.length ? withAvg.reduce((s, r) => s + Math.abs(r.actual! - r.mu), 0) / withAvg.length : null,
      coverage: cov as (number | null)[]
    };
  });
  return {
    logged: rows.length, pending: rows.filter(r => r.result === null).length, voided: rows.filter(r => r.result === 'VOID').length, pushed: rows.filter(r => r.result === 'PUSH').length,
    decided: decided.length, hits, winRate: decided.length ? hits / decided.length : null, over: side('OVER'), under: side('UNDER'),
    brier, meanPOver: bin.length ? bin.reduce((s, r) => s + r.pOver, 0) / bin.length : null,
    overRate: bin.length ? bin.filter(r => r.actual! > r.line).length / bin.length : null,
    alwaysUnder: bin.length ? bin.filter(r => r.actual! < r.line).length / bin.length : null,
    alwaysOver: bin.length ? bin.filter(r => r.actual! > r.line).length / bin.length : null,
    byMarket
  };
}

export type CardFilter = 'all' | 'won' | 'missed' | 'pending' | 'edge';
export function filterCardRows<T extends CardRow>(rows: T[], f: CardFilter, market: string, edge: Set<string>, includeEstimated: boolean): T[] {
  return rows.filter(r => {
    if (!includeEstimated && !isHeadline(r)) return false;
    if (market !== 'all' && r.market !== market) return false;
    if (f === 'won') return r.result === 'HIT';
    if (f === 'missed') return r.result === 'MISS';
    if (f === 'pending') return r.result === null;
    if (f === 'edge') return edge.has(r.id);
    return true;
  });
}

import { persistWithAutoArchive } from './storage_archive';

/** every row stays for 120 days; if the browser refuses the write, auto-archives older than 14d and retries */
export function persistRows<T extends { date: string }>(key: string, rows: T[], today: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage): { kept: number; trimmed: boolean; ok: boolean } {
  const res = persistWithAutoArchive(key, rows, today, { storage });
  return { kept: res.remainingRows.length, trimmed: res.trimmed, ok: res.ok };
}

export { f2 };
