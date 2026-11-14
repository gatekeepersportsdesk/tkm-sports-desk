import { BettableConfig, BetSport, BestSide, LineEval, bestLine, bettableIssue, juiceIssue, rankKey } from './bettable';
import { AvailabilityStatus, InputsSource } from './availability';

export type DeskSortOption = 'edge' | 'prob' | 'combined';

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
}

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
    const pBest = shown ? Math.max(shown.pOver, shown.pUnder) : 0;
    const edgeVal = (bestHere?.edge ?? (shown ? Math.max(shown.edgeOver ?? 0, shown.edgeUnder ?? 0) : 0)) * (bestHere?.edge && bestHere.edge <= 1 ? 100 : 1);

    let sortKey: number;
    if (sortBy === 'prob') {
      // Model probability (highest first); priced rows sort above unpriced
      sortKey = pricedLines.length > 0 ? (10 + pBest) : pBest;
    } else if (sortBy === 'combined') {
      // Combined: edge * probability (highest first)
      sortKey = pricedLines.length > 0 ? (edgeVal * pBest) : -Infinity;
    } else {
      // Default: Edge (highest first)
      sortKey = rankKey('edge', bestHere, pBest);
    }

    return {
      p,
      line,
      best,
      issue,
      priced: pricedLines.length > 0,
      key: sortKey,
      edge: edgeVal,
      pBest
    };
  }).sort((x, y) => (y.key - x.key) || (a.mu(y.p) - a.mu(x.p)));
}
