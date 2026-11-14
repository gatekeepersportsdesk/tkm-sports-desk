import { BettableConfig, BetSport, BestSide, LineEval, bestLine, bettableIssue, juiceIssue, rankKey } from './bettable';
import { AvailabilityStatus, InputsSource } from './availability';

export type DeskSortOption = 'edge' | 'prob' | 'combined' | 'form' | 'process';

export interface DeskFormSample {
  /** Hit rate in [0, 1] over last 10 games vs line/side, or null if no game logs */
  l10HitRate: number | null;
  /** Hit rate in [0, 1] over last 5 games vs line/side, or null if no game logs */
  l5HitRate: number | null;
  l10Games: number;
  l5Games: number;
}

/** Compute DeskFormSample from logs (ordered newest first). Returns null if no logs exist. */
export function formSampleFromLogs(
  logs: number[] | null | undefined,
  line: number,
  side: 'over' | 'under' | 'OVER' | 'UNDER'
): DeskFormSample | null {
  const safe = (logs || []).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (safe.length === 0) return null;
  const isOver = String(side).toUpperCase() === 'OVER';
  const rateFor = (slice: number[]): number | null => {
    if (slice.length === 0) return null;
    let hits = 0;
    for (const v of slice) {
      if (isOver ? v > line : v < line) hits++;
    }
    return hits / slice.length;
  };
  const s10 = safe.slice(0, 10);
  const s5 = safe.slice(0, 5);
  return {
    l10HitRate: rateFor(s10),
    l5HitRate: rateFor(s5),
    l10Games: s10.length,
    l5Games: s5.length
  };
}

/**
 * Blended Process Score:
 *  0.40 * modelWinProb + 0.35 * normalizedEdge + 0.25 * formL10 (+ small boost if L5 agrees)
 * Unpriced plays rank below priced plays; missing form uses available components proportionally
 * with a slight discount vs form-backed equivalents rather than fabricating 0%.
 */
export function computeProcessScore(
  pBest: number,
  edgePp: number,
  priced: boolean,
  form: DeskFormSample | null | undefined
): number {
  const modelComp = Math.max(0, Math.min(1, Number.isFinite(pBest) ? pBest : 0));
  const cleanEdge = priced && Number.isFinite(edgePp) && Math.abs(edgePp) <= 50 ? edgePp : 0;
  const edgeComp = priced ? Math.max(-0.25, Math.min(1, cleanEdge / 20)) : 0;

  const l10 = form?.l10HitRate ?? null;
  const l5 = form?.l5HitRate ?? null;
  const formBase = l10 !== null ? l10 : l5;

  let raw: number;
  if (formBase !== null) {
    const l5Boost = l5 !== null && l5 >= formBase && l5 >= 0.50 ? 0.03 : 0;
    raw = 0.40 * modelComp + 0.35 * edgeComp + 0.25 * formBase + l5Boost;
  } else {
    // Missing form stays proportional on model + edge with minor tie-break discount vs backed rows
    raw = (0.40 * modelComp + 0.35 * edgeComp) * 0.92;
  }

  return priced ? 10 + raw : raw;
}

export function isWeakL10Form(form: DeskFormSample | null | undefined): boolean {
  return form != null && form.l10HitRate !== null && form.l10HitRate < 0.40;
}

export interface DeskItemAccess<P> {
  sport: BetSport; market: string; cfg: BettableConfig;
  linesOf: (p: P) => number[];
  defaultLine: (p: P) => number;
  picked: (p: P) => number | undefined;
  entryAt: (p: P, line: number) => { over?: number | null; under?: number | null } | undefined;
  evalAt: (p: P, line: number) => (LineEval & { pOver: number; pUnder: number }) | null;
  mu: (p: P) => number; pm: (p: P) => number | null;
  inputs: (p: P) => InputsSource | undefined; availability: (p: P) => AvailabilityStatus | undefined;
  sortBy?: DeskSortOption;
  formOf?: (p: P, line: number, side: 'over' | 'under') => DeskFormSample | null;
  deprioritizeWeakForm?: boolean;
}
export interface DeskRow<P> {
  p: P;
  /** the line shown: your explicit pick, else the best-EV posted line, else the model's default line */
  line: number;
  best: ({ line: number } & BestSide) | null;
  /** why this row is not bettable (null = bettable) */
  issue: string | null;
  priced: boolean;
  key: number;
  edge: number;
  pBest: number;
  form: DeskFormSample | null;
  weakForm: boolean;
}

export const DESK_SORT_LABELS: Record<DeskSortOption, string> = {
  edge: 'Edge',
  prob: 'Model Prob',
  combined: 'Combined (Edge × Prob)',
  form: 'Form (L10 · L5)',
  process: 'Process (0.40 Model + 0.35 Edge + 0.25 Form)'
};

/** One row per player with the line to show, its best posted line, bettable status and a sort key. Pure: no state, no model changes. */
export function rankDeskRows<P>(items: P[], a: DeskItemAccess<P>): DeskRow<P>[] {
  const sortBy: DeskSortOption = a.sortBy || 'edge';

  return items.map(p => {
    const pricedLines = a.linesOf(p).filter(l => { const e = a.entryAt(p, l); return !!e && (e.over != null || e.under != null); });
    const best = bestLine(pricedLines, l => a.evalAt(p, l));
    const pick = a.picked(p);
    const line = pick ?? best?.line ?? a.defaultLine(p);
    const shown = a.evalAt(p, line);
    const bestHere = pick !== undefined || !best ? (shown ? bestLine([line], () => shown) : null) : best;
    let issue = bettableIssue({ sport: a.sport, market: a.market, mu: a.mu(p), pm: a.pm(p), inputs: a.inputs(p), availability: a.availability(p) }, a.cfg);
    if (!issue && bestHere) { const e = a.entryAt(p, bestHere.line); issue = juiceIssue(bestHere.side === 'over' ? e?.over : e?.under, a.cfg); }
    const side: 'over' | 'under' = bestHere?.side ?? (shown && shown.pUnder > shown.pOver ? 'under' : 'over');
    const pBest = shown ? (bestHere ? (bestHere.side === 'under' ? shown.pUnder : shown.pOver) : Math.max(shown.pOver, shown.pUnder)) : 0;
    const rawEdge = bestHere?.edge ?? (shown ? Math.max(shown.edgeOver ?? 0, shown.edgeUnder ?? 0) : 0);
    const edgeVal = rawEdge * (Math.abs(rawEdge) > 0 && Math.abs(rawEdge) <= 1 ? 100 : 1);

    const form = a.formOf ? a.formOf(p, line, side) : null;
    const weakForm = isWeakL10Form(form);
    const priced = pricedLines.length > 0;

    let sortKey: number;
    if (sortBy === 'prob') {
      // Model probability (highest first); priced rows sort above unpriced
      sortKey = priced ? (10 + pBest) : pBest;
    } else if (sortBy === 'combined') {
      // Combined: edge * probability (highest first)
      sortKey = priced ? (edgeVal * pBest) : -Infinity;
    } else if (sortBy === 'form') {
      const l10 = form?.l10HitRate ?? null;
      const l5 = form?.l5HitRate ?? null;
      if (l10 === null && l5 === null) {
        sortKey = -1;
      } else {
        // Primary L10 hit rate, tie-break L5 hit rate
        sortKey = (l10 ?? l5 ?? 0) * 1000 + (l5 ?? 0) * 10 + (priced ? 1 : 0);
      }
    } else if (sortBy === 'process') {
      sortKey = computeProcessScore(pBest, edgeVal, priced, form);
    } else {
      // Default: Edge (highest first)
      sortKey = rankKey('edge', bestHere, pBest);
    }

    if (a.deprioritizeWeakForm && weakForm) {
      sortKey = Number.isFinite(sortKey) ? sortKey - 10000 : sortKey;
    }

    return {
      p,
      line,
      best,
      issue,
      priced,
      key: sortKey,
      edge: edgeVal,
      pBest,
      form,
      weakForm
    };
  }).sort((x, y) => {
    if (y.key !== x.key) {
      if (!Number.isFinite(x.key) && !Number.isFinite(y.key)) return a.mu(y.p) - a.mu(x.p);
      return y.key - x.key;
    }
    return a.mu(y.p) - a.mu(x.p);
  });
}
