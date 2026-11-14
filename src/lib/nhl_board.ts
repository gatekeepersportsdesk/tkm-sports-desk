/**
 * Shared NHL board logic: one function decides a row, used by the desk, the
 * row component and the ledger logger so they can never disagree.
 */
import {
  NhlSkaterProjection,
  NhlMarket,
  NhlMarketProjection,
  NhlOddsEntry,
  NhlSettings,
  NhlLedgerRow,
  nhlOddsKey
} from '../types/nhl';
import { evaluateNhlMarket, NhlDecision, priceLine } from '../model/nhl_engine';

export function marketOf(p: NhlSkaterProjection, market: NhlMarket): NhlMarketProjection | null {
  return market === 'sog' ? p.sog : p.pts;
}

export interface NhlRowEval {
  mp: NhlMarketProjection;
  pOver: number;
  pUnder: number;
  pPush: number;
  decision: NhlDecision;
}

export function evalNhlRow(
  p: NhlSkaterProjection,
  market: NhlMarket,
  line: number,
  entry: NhlOddsEntry | undefined,
  settings: NhlSettings
): NhlRowEval | null {
  const mp = marketOf(p, market);
  if (!mp) return null;
  const probs = mp.probs[line] ?? priceLine(mp.mu, mp.r, line);
  const decision = evaluateNhlMarket({
    pOver: probs.p_over,
    pUnder: probs.p_under,
    pPush: probs.p_push,
    over: entry?.over ?? null,
    under: entry?.under ?? null,
    edgeMinPts: settings.edgeThreshold,
    maxChalk: settings.maxJuice,
    availability: p.availability,
    inputsSource: p.inputsSource
  });
  return { mp, pOver: probs.p_over, pUnder: probs.p_under, pPush: probs.p_push, decision };
}

/** Build a pending ledger row for a priced line; null when no price was entered. */
export function buildLedgerRow(
  p: NhlSkaterProjection,
  market: NhlMarket,
  line: number,
  entry: NhlOddsEntry | undefined,
  settings: NhlSettings,
  date: string
): NhlLedgerRow | null {
  if (!p.gameId) return null;
  const ev = evalNhlRow(p, market, line, entry, settings);
  if (!ev || !ev.decision.hasMarket) return null;
  const live = Math.max(1e-9, 1 - ev.pPush);
  return {
    id: `${date}:${market}:${p.playerId}:${line}`,
    date,
    gameId: p.gameId,
    market,
    playerId: p.playerId,
    playerName: p.name,
    team: p.team,
    opp: p.opp,
    line,
    modelMu: ev.mp.mu,
    r: ev.mp.r,
    probOver: ev.pOver / live,
    overOdds: entry?.over ?? null,
    underOdds: entry?.under ?? null,
    pMarketOver: ev.decision.fairOver,
    tag: ev.decision.tag,
    side: ev.decision.side,
    edge: ev.decision.edge,
    ev: ev.decision.ev,
    inputsSource: p.inputsSource,
    availability: p.availability,
    actual: null,
    result: null,
    modelLean: ev.mp.mu >= line ? 'OVER' : 'UNDER',
    isPredictionOnly: false
  };
}

/** Build a ledger row for a model prediction regardless of whether odds were entered */
export function buildNhlPredictionRow(
  p: NhlSkaterProjection,
  market: NhlMarket,
  line: number,
  entry: NhlOddsEntry | undefined,
  settings: NhlSettings,
  date: string
): NhlLedgerRow | null {
  if (!p.gameId) return null;
  const ev = evalNhlRow(p, market, line, entry, settings);
  if (!ev) return null;
  const live = Math.max(1e-9, 1 - ev.pPush);
  const modelLean: 'OVER' | 'UNDER' = ev.mp.mu >= line ? 'OVER' : 'UNDER';
  return {
    id: `${date}:${market}:${p.playerId}:${line}`,
    date,
    gameId: p.gameId,
    market,
    playerId: p.playerId,
    playerName: p.name,
    team: p.team,
    opp: p.opp,
    line,
    modelMu: ev.mp.mu,
    r: ev.mp.r,
    probOver: ev.pOver / live,
    overOdds: entry?.over ?? null,
    underOdds: entry?.under ?? null,
    pMarketOver: ev.decision.fairOver,
    tag: ev.decision.hasMarket ? ev.decision.tag : 'PASS',
    side: ev.decision.hasMarket && ev.decision.side ? ev.decision.side : (modelLean === 'OVER' ? 'over' : 'under'),
    edge: ev.decision.edge,
    ev: ev.decision.ev,
    inputsSource: p.inputsSource,
    availability: p.availability,
    actual: null,
    result: null,
    modelLean,
    isPredictionOnly: !ev.decision.hasMarket
  };
}

/** Every priced (market, line) on the board, ready to log. */
export function collectLedgerRows(
  projections: NhlSkaterProjection[],
  odds: Record<string, NhlOddsEntry>,
  settings: NhlSettings,
  date: string
): NhlLedgerRow[] {
  const rows: NhlLedgerRow[] = [];
  for (const p of projections) {
    for (const market of ['sog', 'pts'] as NhlMarket[]) {
      const mp = marketOf(p, market);
      if (!mp) continue;
      for (const line of mp.lines) {
        const entry = odds[nhlOddsKey(market, p.playerId, line)];
        if (!entry || (entry.over == null && entry.under == null)) continue;
        const row = buildLedgerRow(p, market, line, entry, settings, date);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

/** Collect all model predictions across the slate for self-grading analysis */
export function collectAllNhlPredictions(
  projections: NhlSkaterProjection[],
  odds: Record<string, NhlOddsEntry>,
  settings: NhlSettings,
  date: string
): NhlLedgerRow[] {
  const rows: NhlLedgerRow[] = [];
  for (const p of projections) {
    for (const market of ['sog', 'pts'] as NhlMarket[]) {
      const mp = marketOf(p, market);
      if (!mp) continue;
      const lines = new Set<number>([mp.defaultLine]);
      for (const l of mp.lines) {
        const entry = odds[nhlOddsKey(market, p.playerId, l)];
        if (entry && (entry.over != null || entry.under != null)) lines.add(l);
      }
      for (const line of lines) {
        const entry = odds[nhlOddsKey(market, p.playerId, line)];
        const row = buildNhlPredictionRow(p, market, line, entry, settings, date);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

/** Merge new snapshots in; already-graded rows are never overwritten. */
export function mergeLedger(existing: NhlLedgerRow[], incoming: NhlLedgerRow[]): NhlLedgerRow[] {
  const byId = new Map(existing.map(r => [r.id, r]));
  for (const r of incoming) {
    const old = byId.get(r.id);
    if (old && old.result !== null) continue;
    byId.set(r.id, r);
  }
  return Array.from(byId.values());
}

/** Guess the market from OCR text; 0.5 lines are points, everything else shots. */
export function inferNhlMarket(prop: string | undefined, line: number): NhlMarket {
  const t = (prop || '').toLowerCase();
  if (/point|pts/.test(t)) return 'pts';
  if (/shot|sog/.test(t)) return 'sog';
  return line <= 0.5 ? 'pts' : 'sog';
}
