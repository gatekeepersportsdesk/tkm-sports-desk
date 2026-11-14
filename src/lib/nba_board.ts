/**
 * Shared NBA board logic: one function decides a row, used by the desk, the row component and the ledger logger so
 * they can never disagree. Also builds the projections for a slate from the loaded game logs, schedule and injuries.
 */
import {
  NbaMarket, NBA_MARKETS, NbaPlayerProjection, NbaMarketProjection, NbaOddsEntry, NbaSettings, NbaLedgerRow, nbaOddsKey
} from '../types/nba';
import {
  evaluateNbaMarket, NbaDecision, buildNbaTeamFactors, lostRotation, projectNbaPlayer
} from '../model/nba_engine';
import { priceLine } from '../model/nhl_engine';
import { NbaState, NbaGame, NbaInjury, applyNbaInjuries } from './nba_data';

export type NbaOddsMap = Record<string, NbaOddsEntry>;
export interface NbaMatchup extends NbaGame {}

/** A player below this projected-minutes level is not offered as a prop by books; keep the board readable. */
export const NBA_BOARD_MIN_PM = 14;

export function marketOf(p: NbaPlayerProjection, market: NbaMarket): NbaMarketProjection {
  return p.markets[market];
}

export interface NbaRowEval {
  mp: NbaMarketProjection;
  pOver: number;
  pUnder: number;
  pPush: number;
  decision: NbaDecision;
}

export function evalNbaRow(
  p: NbaPlayerProjection, market: NbaMarket, line: number, entry: NbaOddsEntry | undefined, settings: NbaSettings
): NbaRowEval {
  const mp = marketOf(p, market);
  const probs = mp.probs[line] ?? priceLine(mp.mu, mp.r, line);
  const decision = evaluateNbaMarket({
    pOver: probs.p_over, pUnder: probs.p_under, pPush: probs.p_push,
    over: entry?.over ?? null, under: entry?.under ?? null,
    edgeMinPts: settings.edgeThreshold, maxChalk: settings.maxJuice,
    availability: p.availability, inputsSource: p.inputsSource
  });
  return { mp, pOver: probs.p_over, pUnder: probs.p_under, pPush: probs.p_push, decision };
}

/** Build a pending ledger row for a priced line; null when no price was entered. */
export function buildNbaLedgerRow(
  p: NbaPlayerProjection, market: NbaMarket, line: number, entry: NbaOddsEntry | undefined, settings: NbaSettings, date: string
): NbaLedgerRow | null {
  if (!p.gameId) return null;
  const ev = evalNbaRow(p, market, line, entry, settings);
  if (!ev.decision.hasMarket) return null;
  const live = Math.max(1e-9, 1 - ev.pPush);
  return {
    id: `${date}:${market}:${p.playerId}:${line}`, date, gameId: p.gameId, market, playerId: p.playerId, playerName: p.name,
    team: p.team, opp: p.opp, line, modelMu: ev.mp.mu, r: ev.mp.r, probOver: ev.pOver / live,
    overOdds: entry?.over ?? null, underOdds: entry?.under ?? null, pMarketOver: ev.decision.fairOver,
    tag: ev.decision.tag, side: ev.decision.side, edge: ev.decision.edge, ev: ev.decision.ev,
    inputsSource: p.inputsSource, availability: p.availability, actual: null, result: null
  };
}

export function collectNbaLedgerRows(
  projections: NbaPlayerProjection[], odds: NbaOddsMap, settings: NbaSettings, date: string
): NbaLedgerRow[] {
  const rows: NbaLedgerRow[] = [];
  for (const p of projections) {
    for (const market of NBA_MARKETS) {
      for (const line of p.markets[market].lines) {
        const entry = odds[nbaOddsKey(market, p.playerId, line)];
        if (!entry || (entry.over == null && entry.under == null)) continue;
        const row = buildNbaLedgerRow(p, market, line, entry, settings, date);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

/** Merge new snapshots in; already-graded rows are never overwritten. */
export function mergeNbaLedger(existing: NbaLedgerRow[], incoming: NbaLedgerRow[]): NbaLedgerRow[] {
  const byId = new Map(existing.map(r => [r.id, r]));
  for (const r of incoming) {
    const old = byId.get(r.id);
    if (old && old.result !== null) continue;
    byId.set(r.id, r);
  }
  return Array.from(byId.values());
}

/** Guess the market from OCR text. Returns null when the prop text names a market this desk does not price. */
export function inferNbaMarket(prop: string | undefined): NbaMarket | null {
  const t = (prop || '').toLowerCase().replace(/\s+/g, ' ');
  if (/turnover|fantasy|double|triple|first|quarter|half|\+ ?(stl|steal|blk|block)/.test(t)) return null;
  // points+rebounds+assists is its own market; any other two-part combination is not priced here
  if (/pra\b|pts ?\+ ?reb ?\+ ?ast|points ?\+ ?rebounds ?\+ ?assists|points, rebounds,? (and|&) assists/.test(t)) return 'pra';
  if (/(pts|point|reb|ast|rebound|assist).*[+&].*(pts|point|reb|ast|rebound|assist)|combo/.test(t)) return null;
  if (/steal|stl/.test(t)) return 'stl';
  if (/block|blk/.test(t)) return 'blk';
  if (/three|3[- ]?pt|3pm|3[- ]?point/.test(t)) return 'tpm';
  if (/rebound|reb/.test(t)) return 'reb';
  if (/assist|ast/.test(t)) return 'ast';
  if (/point|pts/.test(t)) return 'pts';
  return null;
}

/**
 * Projections for every player on a team playing in `games`. The injury feed being null makes everyone UNKNOWN
 * (they stay visible but cannot qualify). `state.players` already come from the CURRENT season's box scores.
 */
export function buildNbaSlate(state: NbaState, games: NbaGame[], injuries: NbaInjury[] | null): NbaPlayerProjection[] {
  const players = applyNbaInjuries(state.players, injuries);
  const factors = buildNbaTeamFactors(state.teamGames);
  const out: NbaPlayerProjection[] = [];
  for (const g of games) {
    if (g.postponed) continue;
    for (const side of [g.home, g.away] as const) {
      const opp = side === g.home ? g.away : g.home;
      const mates = players.filter(p => p.team === side);
      const mateInfo = mates.map(p => ({ name: p.name, avgMin: state.avgMinByName[p.name] ?? 0, availability: p.availability }));
      for (const p of mates) {
        if (p.gp + p.priorGp === 0) continue; // no evidence at all (a DNP-only rookie): nothing to price
        const lost = lostRotation(mateInfo, p.name);
        const proj = projectNbaPlayer(p, opp, factors[opp], lost, { gameId: g.gameId, home: side === g.home, live: true });
        if (proj.pm < NBA_BOARD_MIN_PM) continue;
        out.push(proj);
      }
    }
  }
  return out;
}

/**
 * A book's posted line may sit off the five-line ladder the desk shows. Every priced line in the odds map is added
 * to its player's ladder (priced from the same mu and r), so an imported or typed line is never silently dropped.
 */
export function withOddsLines(projections: NbaPlayerProjection[], odds: NbaOddsMap): NbaPlayerProjection[] {
  const extra = new Map<string, number[]>();
  for (const key of Object.keys(odds)) {
    const [m, id, l] = key.split('|');
    const line = Number(l);
    if (!Number.isFinite(line)) continue;
    const k = `${m}|${id}`;
    (extra.get(k) ?? extra.set(k, []).get(k)!).push(line);
  }
  if (!extra.size) return projections;
  return projections.map(p => {
    let changed = false;
    const markets = { ...p.markets };
    for (const m of NBA_MARKETS) {
      const add = (extra.get(`${m}|${p.playerId}`) ?? []).filter(l => !p.markets[m].lines.includes(l));
      if (!add.length) continue;
      const mp = p.markets[m];
      const probs = { ...mp.probs };
      for (const l of add) probs[l] = priceLine(mp.mu, mp.r, l);
      markets[m] = { ...mp, lines: [...mp.lines, ...add].sort((a, b) => a - b), probs };
      changed = true;
    }
    return changed ? { ...p, markets } : p;
  });
}
