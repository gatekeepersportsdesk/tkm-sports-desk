/**
 * Pick of the Day Engine (All 4 Sports: NBA, NHL, NFL, MLB)
 *
 * Rules:
 * - POTD may ONLY be computed from rows that have BOTH:
 *     * A posted book line, AND
 *     * A posted American (or decimal) price on the chosen side
 *     from the CURRENT odds import for that sport/slate.
 * - If there is no successful odds import for the current slate date, OR no priced bettable rows:
 *     * Return null (shows empty state: "Import odds to unlock Pick of the Day.")
 *     * Never show a player, side, price, EV, or edge.
 *     * Never reuse yesterday's / stale / cached POTD.
 * - On successful odds import:
 *     * Recompute POTD immediately from the fresh priced set.
 *     * Set Calculated timestamp to post-import compute time (>= import time).
 * - Rank strictly by EV at the actual posted price among bettable rows only (highest EV first).
 * - Single correct edge_pp formula everywhere:
 *     implied_prob = american_to_implied(posted_price_on_chosen_side)
 *     edge_pp = (model_win_prob - implied_prob) * 100
 * - Hard sanity check: |edge_pp| <= 50 on standard player props. Rows with impossible edge are disqualified.
 */

import { BettableConfig, usageIssue, juiceIssue, availabilityOk } from './bettable';
import { NbaPlayerProjection, NbaSettings, NbaMarket, NBA_MARKETS, NBA_MARKET_LABEL, nbaOddsKey } from '../types/nba';
import { evalNbaRow, NbaOddsMap } from './nba_board';
import { NhlSkaterProjection, NhlOddsMap, NhlSettings, NhlMarket, nhlOddsKey } from '../types/nhl';
import { evalNhlRow, marketOf } from './nhl_board';
import { NflPropSnapshot } from '../types/nfl';
import { parseOdds, calculateEdgePp, calculateEv } from './odds';
import { MlbGameMatchup, MlbBatterInput, MlbHitProjection, MlbGateResult } from '../types/mlb';

export interface PickOfTheDay {
  sport: 'nfl' | 'nhl' | 'nba' | 'mlb';
  sportLabel: string;
  player: string;
  team: string;
  opp: string;
  market: string;
  marketLabel: string;
  side: 'over' | 'under';
  line: number;
  odds: number; // American odds, e.g. -115 or +125
  modelProb: number; // 0..1 (e.g. 0.582 for 58.2%)
  edge: number; // percentage points (e.g. 9.4 for +9.4pp)
  ev: number; // decimal EV (e.g. 0.082 for +8.2% EV)
  capturedAt?: number; // epoch ms when captured (must be >= odds import time)
  details?: string;
}

export interface OddsImportMeta {
  at: number; // timestamp in epoch ms
  rows: number;
  date: string;
  sport: string;
}

const POTD_KEY_PREFIX = 'gatekeep_potd_v1_';
const IMPORT_KEY_PREFIX = 'gatekeep_odds_import_';

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

function removeItem(key: string): void {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
  memoryStore.delete(key);
}

/**
 * Records that a successful odds import occurred for a sport and slate date.
 * Automatically clears any stale pre-import POTD cache.
 */
export function recordOddsImport(sport: string, date: string, rows: number, at?: number): void {
  const meta: OddsImportMeta = {
    at: at || Date.now(),
    rows,
    date,
    sport
  };
  setItem(`${IMPORT_KEY_PREFIX}${sport}_${date}`, JSON.stringify(meta));
  // Invalidate old pre-import cached pick
  clearCachedPickOfTheDay(sport, date);
}

/**
 * Returns metadata about the latest odds import for this sport and date.
 */
export function getOddsImportMeta(sport: string, date: string): OddsImportMeta | null {
  try {
    const raw = getItem(`${IMPORT_KEY_PREFIX}${sport}_${date}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.at === 'number' && parsed.rows > 0) {
        return parsed as OddsImportMeta;
      }
    }
    // Also check generic posted odds key if it matches today's import
    const postedRaw = getItem(`gatekeep_posted_odds_v1_${sport}`);
    if (postedRaw) {
      const parsed = JSON.parse(postedRaw);
      if (parsed && typeof parsed.at === 'number' && parsed.rows > 0) {
        return { at: parsed.at, rows: parsed.rows, date, sport };
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Strict odds gate check: returns true only if odds were imported for this sport & slate date.
 */
export function hasOddsImport(sport: string, date: string): boolean {
  const meta = getOddsImportMeta(sport, date);
  return meta !== null && meta.rows > 0;
}

/**
 * Purges cached POTD for a given sport and date.
 */
export function clearCachedPickOfTheDay(sport: string, date: string): void {
  removeItem(`${POTD_KEY_PREFIX}${sport}_${date}`);
}

/**
 * Gets cached Pick of the Day with strict odds gating:
 * - If no odds import exists for this date, returns null (not undefined) and purges cache.
 * - If cached pick was captured BEFORE the import time, purges cache and returns undefined so it recomputes.
 * - If cached pick has impossible edge (|edge| > 50) or invalid EV, purges cache and returns undefined.
 */
export function getCachedPickOfTheDay(sport: string, date: string): PickOfTheDay | null | undefined {
  if (!date) return undefined;

  // Strict odds gate: Must have an import record for this date
  const importMeta = getOddsImportMeta(sport, date);
  if (!importMeta || importMeta.rows <= 0) {
    clearCachedPickOfTheDay(sport, date);
    return null;
  }

  try {
    const raw = getItem(`${POTD_KEY_PREFIX}${sport}_${date}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && !parsed.none && parsed.player && parsed.odds != null && parsed.ev > 0) {
        // Ensure cached pick was captured AFTER or at the import time and has valid edge
        const validEdge = parsed.edge != null && Math.abs(parsed.edge) <= 50;
        const validTime = parsed.capturedAt && parsed.capturedAt >= importMeta.at;
        if (validEdge && validTime) {
          return parsed as PickOfTheDay;
        } else {
          // Stale pre-import pick or corrupted edge: purge and recompute
          clearCachedPickOfTheDay(sport, date);
          return undefined;
        }
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Saves cached Pick of the Day ensuring post-import timestamp.
 */
export function saveCachedPickOfTheDay(sport: string, date: string, pick: PickOfTheDay | null): void {
  try {
    if (pick && pick.odds != null && pick.ev > 0 && Math.abs(pick.edge) <= 50) {
      const importMeta = getOddsImportMeta(sport, date);
      const postImportTime = importMeta ? Math.max(importMeta.at, Date.now()) : Date.now();
      setItem(`${POTD_KEY_PREFIX}${sport}_${date}`, JSON.stringify({
        ...pick,
        capturedAt: pick.capturedAt && pick.capturedAt >= (importMeta?.at || 0) ? pick.capturedAt : postImportTime
      }));
    }
  } catch { /* ignore */ }
}

/**
 * NBA Pick of the Day:
 * Scans all players and all 7 markets on the slate.
 * Strictly requires BOTH a posted line and a posted price from the current import.
 * Only accepts rows passing REAL inputs, known active availability, usage floor,
 * juice limit, valid edge (|edge_pp| <= 50), and positive EV (ev > 0).
 * Ranks strictly by EV descending.
 */
export function getNbaPickOfTheDay(
  projections: NbaPlayerProjection[],
  oddsMap: NbaOddsMap,
  settings: NbaSettings,
  bet: BettableConfig,
  date?: string
): PickOfTheDay | null {
  if (date) {
    if (!hasOddsImport('nba', date)) return null;
    const cached = getCachedPickOfTheDay('nba', date);
    if (cached !== undefined) return cached;
  }
  const candidates: PickOfTheDay[] = [];

  for (const p of projections) {
    if (p.inputsSource !== 'REAL' || !availabilityOk(p.availability)) continue;

    for (const m of NBA_MARKETS) {
      const mp = p.markets[m];
      if (!mp) continue;
      if (usageIssue('nba', m, mp.mu, mp.pm, bet) !== null) continue;

      for (const line of mp.lines) {
        const entry = oddsMap[nbaOddsKey(m, p.playerId, line)];
        if (!entry || (entry.over == null && entry.under == null)) continue;

        const evaluated = evalNbaRow(p, m, line, entry, settings);
        if (!evaluated.decision.hasMarket) continue;

        // Evaluate Over side: Requires posted book price on Over
        if (entry.over != null) {
          const edgePp = calculateEdgePp(evaluated.pOver, entry.over);
          const evVal = evaluated.decision.evOver ?? calculateEv(evaluated.pOver, entry.over);
          if (edgePp !== null && evVal !== null && evVal > 0) {
            if (juiceIssue(entry.over, bet) === null) {
              candidates.push({
                sport: 'nba',
                sportLabel: 'NBA Props',
                player: p.name,
                team: p.team,
                opp: p.opp,
                market: m,
                marketLabel: NBA_MARKET_LABEL[m] || m.toUpperCase(),
                side: 'over',
                line,
                odds: entry.over,
                modelProb: evaluated.pOver,
                edge: edgePp,
                ev: evVal
              });
            }
          }
        }

        // Evaluate Under side: Requires posted book price on Under
        if (entry.under != null) {
          const edgePp = calculateEdgePp(evaluated.pUnder, entry.under);
          const evVal = evaluated.decision.evUnder ?? calculateEv(evaluated.pUnder, entry.under);
          if (edgePp !== null && evVal !== null && evVal > 0) {
            if (juiceIssue(entry.under, bet) === null) {
              candidates.push({
                sport: 'nba',
                sportLabel: 'NBA Props',
                player: p.name,
                team: p.team,
                opp: p.opp,
                market: m,
                marketLabel: NBA_MARKET_LABEL[m] || m.toUpperCase(),
                side: 'under',
                line,
                odds: entry.under,
                modelProb: evaluated.pUnder,
                edge: edgePp,
                ev: evVal
              });
            }
          }
        }
      }
    }
  }

  const best = candidates.length > 0 ? candidates.sort((a, b) => b.ev - a.ev)[0] : null;
  if (best) {
    const importMeta = date ? getOddsImportMeta('nba', date) : null;
    best.capturedAt = importMeta ? Math.max(importMeta.at, Date.now()) : Date.now();
  }
  if (date) saveCachedPickOfTheDay('nba', date, best);
  return best;
}

/**
 * NHL Pick of the Day:
 * Scans all skaters and markets ('sog' and 'pts') on the slate.
 * Strictly requires BOTH a posted line and a posted price from the current import.
 * Only accepts rows passing REAL inputs, known active availability, usage floor,
 * juice limit, valid edge (|edge_pp| <= 50), and positive EV (ev > 0).
 * Ranks strictly by EV descending.
 */
export function getNhlPickOfTheDay(
  projections: NhlSkaterProjection[],
  oddsMap: NhlOddsMap,
  settings: NhlSettings,
  bet: BettableConfig,
  date?: string
): PickOfTheDay | null {
  if (date) {
    if (!hasOddsImport('nhl', date)) return null;
    const cached = getCachedPickOfTheDay('nhl', date);
    if (cached !== undefined) return cached;
  }
  const candidates: PickOfTheDay[] = [];

  for (const p of projections) {
    if (p.inputsSource !== 'REAL' || !availabilityOk(p.availability)) continue;

    const markets: NhlMarket[] = ['sog', 'pts'];
    for (const m of markets) {
      const mp = marketOf(p, m);
      if (!mp) continue;
      if (usageIssue('nhl', m, mp.mu, null, bet) !== null) continue;

      for (const line of mp.lines) {
        const entry = oddsMap[nhlOddsKey(m, p.playerId, line)];
        if (!entry || (entry.over == null && entry.under == null)) continue;

        const evaluated = evalNhlRow(p, m, line, entry, settings);
        if (!evaluated || !evaluated.decision.hasMarket) continue;

        // Evaluate Over side: Requires posted book price on Over
        if (entry.over != null) {
          const edgePp = calculateEdgePp(evaluated.pOver, entry.over);
          const evVal = evaluated.decision.evOver ?? calculateEv(evaluated.pOver, entry.over);
          if (edgePp !== null && evVal !== null && evVal > 0) {
            if (juiceIssue(entry.over, bet) === null) {
              candidates.push({
                sport: 'nhl',
                sportLabel: 'NHL Shots+Points',
                player: p.name,
                team: p.team,
                opp: p.opp,
                market: m,
                marketLabel: m === 'sog' ? 'Shots on Goal' : 'Points',
                side: 'over',
                line,
                odds: entry.over,
                modelProb: evaluated.pOver,
                edge: edgePp,
                ev: evVal
              });
            }
          }
        }

        // Evaluate Under side: Requires posted book price on Under
        if (entry.under != null) {
          const edgePp = calculateEdgePp(evaluated.pUnder, entry.under);
          const evVal = evaluated.decision.evUnder ?? calculateEv(evaluated.pUnder, entry.under);
          if (edgePp !== null && evVal !== null && evVal > 0) {
            if (juiceIssue(entry.under, bet) === null) {
              candidates.push({
                sport: 'nhl',
                sportLabel: 'NHL Shots+Points',
                player: p.name,
                team: p.team,
                opp: p.opp,
                market: m,
                marketLabel: m === 'sog' ? 'Shots on Goal' : 'Points',
                side: 'under',
                line,
                odds: entry.under,
                modelProb: evaluated.pUnder,
                edge: edgePp,
                ev: evVal
              });
            }
          }
        }
      }
    }
  }

  const best = candidates.length > 0 ? candidates.sort((a, b) => b.ev - a.ev)[0] : null;
  if (best) {
    const importMeta = date ? getOddsImportMeta('nhl', date) : null;
    best.capturedAt = importMeta ? Math.max(importMeta.at, Date.now()) : Date.now();
  }
  if (date) saveCachedPickOfTheDay('nhl', date, best);
  return best;
}

/**
 * NFL Pick of the Day:
 * Scans NFL prop snapshots.
 * Strictly requires BOTH a posted line and a posted price from the current import.
 * Only accepts rows passing BET status, real inputs, known active availability,
 * valid edge (|edge_pp| <= 50), and positive EV (ev > 0).
 * Ranks strictly by EV descending.
 */
export function getNflPickOfTheDay(
  snapshots: NflPropSnapshot[],
  bet?: BettableConfig,
  date?: string
): PickOfTheDay | null {
  if (date) {
    if (!hasOddsImport('nfl', date)) return null;
    const cached = getCachedPickOfTheDay('nfl', date);
    if (cached !== undefined) return cached;
  }
  const candidates: PickOfTheDay[] = [];

  for (const s of snapshots) {
    if (s.cardStatus !== 'BET') continue;
    if (s.hasMarket === false) continue;
    if (s.inputsSource !== 'REAL') continue;
    if (!availabilityOk(s.availability)) continue;

    const rawOdds = s.lean === 'OVER' ? s.overOdds : s.underOdds;
    if (!rawOdds || !rawOdds.trim()) continue; // Posted book price required
    const parsedOdds = parseOdds(rawOdds);
    if (!parsedOdds) continue;
    const oddsNum = parsedOdds.us;
    if (bet && juiceIssue(oddsNum, bet) !== null) continue;

    const prob = s.lean === 'OVER' ? s.p_over : s.p_under;
    const edgePp = calculateEdgePp(prob, oddsNum);
    const evVal = (s.ev !== null && s.ev !== undefined) ? s.ev : calculateEv(prob, oddsNum);
    if (edgePp === null || evVal === null || evVal <= 0) continue;

    candidates.push({
      sport: 'nfl',
      sportLabel: 'NFL Receptions',
      player: s.player,
      team: s.team,
      opp: s.gameKey,
      market: 'rec',
      marketLabel: 'Receptions',
      side: s.lean.toLowerCase() as 'over' | 'under',
      line: s.line,
      odds: oddsNum,
      modelProb: prob,
      edge: edgePp,
      ev: evVal
    });
  }

  const best = candidates.length > 0 ? candidates.sort((a, b) => b.ev - a.ev)[0] : null;
  if (best) {
    const importMeta = date ? getOddsImportMeta('nfl', date) : null;
    best.capturedAt = importMeta ? Math.max(importMeta.at, Date.now()) : Date.now();
  }
  if (date) saveCachedPickOfTheDay('nfl', date, best);
  return best;
}

/**
 * MLB Pick of the Day:
 * Scans MLB batter rows.
 * Strictly requires BOTH a posted line and a posted price from the current import.
 * Only accepts rows passing PLAY call, real inputs, known active availability,
 * valid edge (|edge_pp| <= 50), and positive EV (ev > 0).
 * Ranks strictly by EV descending.
 */
export function getMlbPickOfTheDay(
  allRows: {
    batter: MlbBatterInput;
    hit: MlbHitProjection;
    gate: MlbGateResult;
    game: MlbGameMatchup;
    price: { over: string; under: string; line?: number };
  }[],
  date?: string
): PickOfTheDay | null {
  if (date) {
    if (!hasOddsImport('mlb', date)) return null;
    const cached = getCachedPickOfTheDay('mlb', date);
    if (cached !== undefined) return cached;
  }
  const candidates: PickOfTheDay[] = [];

  for (const r of allRows) {
    if (r.gate.call !== 'PLAY') continue;
    if (!r.hit.inputsReal) continue;
    if (r.batter.availability === 'OUT' || r.batter.availability === 'NOT_IN_LINEUP') continue;
    if (!r.price.over || !r.price.over.trim()) continue; // Posted book price required

    const parsedOdds = parseOdds(r.price.over);
    if (!parsedOdds) continue;
    const oddsNum = parsedOdds.us;

    const prob = r.gate.calP;
    const edgePp = calculateEdgePp(prob, oddsNum);
    const evVal = (r.gate.ev !== null && r.gate.ev !== undefined) ? r.gate.ev : calculateEv(prob, oddsNum);
    if (edgePp === null || evVal === null || evVal <= 0) continue;

    candidates.push({
      sport: 'mlb',
      sportLabel: 'MLB 0.5-Hits',
      player: r.batter.name,
      team: r.batter.team,
      opp: r.batter.isHome ? r.game.away : r.game.home,
      market: 'hit',
      marketLabel: '0.5 Hits',
      side: 'over',
      line: r.price.line !== undefined ? r.price.line : 0.5,
      odds: oddsNum,
      modelProb: prob,
      edge: edgePp,
      ev: evVal
    });
  }

  const best = candidates.length > 0 ? candidates.sort((a, b) => b.ev - a.ev)[0] : null;
  if (best) {
    const importMeta = date ? getOddsImportMeta('mlb', date) : null;
    best.capturedAt = importMeta ? Math.max(importMeta.at, Date.now()) : Date.now();
  }
  if (date) saveCachedPickOfTheDay('mlb', date, best);
  return best;
}

/**
 * Identifies the single overall best play across all 4 sports by highest EV.
 */
export function getOverallBestPick(picks: (PickOfTheDay | null)[]): PickOfTheDay | null {
  const valid = picks.filter((p): p is PickOfTheDay => p !== null && p.ev > 0 && Math.abs(p.edge) <= 50);
  if (valid.length === 0) return null;
  valid.sort((a, b) => b.ev - a.ev);
  return valid[0];
}
