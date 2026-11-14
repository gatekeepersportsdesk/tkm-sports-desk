/**
 * Parlay picker core. NOT a new model: it combines the single-leg probabilities the desks already show, using
 *  - NBA: the existing Gaussian copula with MEASURED correlations (nba_joint.ts); teammates / opponents ~ 0
 *  - NHL: same-skater shots<->points through the copula (the desk's shots-points correlation, a prior in the settings),
 *         teammates with the MEASURED +0.018 (shots) / +0.096 (points); opponents ~ 0
 *  - NFL: teammates +0.03 (measured), opponents 0
 *  - MLB: the existing same-game / same-team factor simulation (simMlbCard)
 *  - legs from different games are independent: the ticket price is the product of per-game blocks.
 * Every ticket shows the correlated price next to the plain product so the effect of dependence is visible.
 * A ticket never gets an STAB / FADE / PLAY / BET tag; only legs can be "edge" (a priced single that already qualified),
 * and EV exists only when the user supplies a real book parlay price. Estimated / unknown legs never enter edge or safe tickets.
 */
import { CardRow } from './card_core';
import { InputsSource, AvailabilityStatus } from './availability';
import { jointProbability, fairAmerican, Leg as SLeg, CORR_PRIORS } from '../model/sampler';
import { priceNbaJoint, NbaJointLeg } from '../model/nba_joint';
import { simMlbCard } from '../model/mlb_engine';
import { NHL_CONFIG } from '../model/nhl_engine';
import { GAMESIM_PARAMS } from '../model/gamesim_params';
import { NbaMarket } from '../types/nba';
import { BettableConfig, DEFAULT_BETTABLE, bettableIssue, juiceIssue } from './bettable';

export type PSport = 'nba' | 'nhl' | 'nfl' | 'mlb';
export type ParlayMode = 'edge' | 'safe' | 'sgp' | 'cross';
export const MODES: ParlayMode[] = ['edge', 'safe', 'sgp', 'cross'];

export interface ParlayLeg {
  /** card row id, or priced-ledger row id for edge legs */
  id: string;
  src: 'card' | 'ledger';
  sport: PSport;
  date: string;
  gameId: string;
  playerId: number | string;
  playerName: string;
  team: string;
  opp: string;
  market: string;
  side: 'OVER' | 'UNDER';
  line: number;
  mu: number;
  /** projected minutes / at-bats when the sport has them */
  pm?: number | null;
  r: number | null;
  /** probability this leg wins (push removed), exactly the number the desk shows for that side */
  pLean: number;
  tag: 'EDGE' | 'NONE';
  inputs: InputsSource;
  availability: AvailabilityStatus;
  /** American prices of both sides when the row was priced two-way, else null */
  overOdds: number | null;
  underOdds: number | null;
  teamKey: string;
  caution?: string;
}

export interface ParlayTicket {
  id: string;
  sport: PSport;
  mode: ParlayMode;
  legs: ParlayLeg[];
  jointP: number;
  indepP: number;
  fairAmerican: number | null;
  bookAmerican?: number | null;
  ev?: number | null;
  correlated: boolean;
  warnings: string[];
  createdAt: number;
  /** Monte Carlo standard error of jointP (0 for exact products) */
  se: number;
}

export interface ParlayRules {
  minP: number;          // safe mode: minimum single-leg win probability
  maxJuice: number;      // safe mode: chosen side may not be priced worse than -maxJuice (priced rows only)
  minLegs: number;
  markets: string[] | null; // null = all
  /** shared bettable rules (usage floors, availability, max juice for edge tickets) */
  bet: BettableConfig;
}
export const DEFAULT_RULES: ParlayRules = { minP: 0.58, maxJuice: 115, minLegs: 2, markets: null, bet: DEFAULT_BETTABLE };

const BLOCKED = new Set<AvailabilityStatus>(['UNKNOWN', 'OUT', 'IR', 'INACTIVE', 'SCRATCHED', 'NOT_IN_LINEUP']);
export const knownAvailability = (a: AvailabilityStatus) => !BLOCKED.has(a);

/* ------------------------------ leg builders ------------------------------ */

export function legFromCard(r: CardRow, sport: PSport): ParlayLeg {
  const pLean = r.lean === 'OVER' ? r.pOver : 1 - r.pOver;
  return {
    id: r.id, src: 'card', sport, date: r.date, gameId: String(r.gameId), playerId: r.playerId, playerName: r.name, team: r.team, opp: r.opp,
    market: r.market, side: r.lean, line: r.line, mu: r.mu, pm: r.pm, r: r.r, pLean, tag: 'NONE', inputs: r.inputs, availability: r.avail,
    overOdds: null, underOdds: null, teamKey: `${r.gameId}|${r.team}`
  };
}

/** NBA / NHL priced ledger rows (same shape): only qualifying STAB / FADE with EV > 0 at the offered price and a two-way price. */
export function legsFromPricedLedger(rows: any[], sport: 'nba' | 'nhl', today: string, pmFor?: (playerId: number | string, market: string) => number | null): ParlayLeg[] {
  const out: ParlayLeg[] = [];
  for (const x of rows) {
    if (!x || x.demo || x.result !== null || x.date !== today || x.tag === 'PASS' || !x.side) continue;
    if (!(typeof x.ev === 'number' && x.ev > 0) || x.overOdds == null || x.underOdds == null) continue;
    const over = x.side === 'over';
    out.push({
      id: x.id, src: 'ledger', sport, date: x.date, gameId: String(x.gameId), playerId: x.playerId, playerName: x.playerName, team: x.team, opp: x.opp,
      market: x.market, side: over ? 'OVER' : 'UNDER', line: x.line, mu: x.modelMu, pm: pmFor?.(x.playerId, x.market) ?? null, r: x.r, pLean: over ? x.probOver : 1 - x.probOver, tag: 'EDGE',
      inputs: x.inputsSource, availability: x.availability, overOdds: x.overOdds, underOdds: x.underOdds, teamKey: `${x.gameId}|${x.team}`
    });
  }
  return out;
}

/* ------------------------------- eligibility ------------------------------ */

export function legIssue(l: ParlayLeg, mode: ParlayMode, rules: ParlayRules): string | null {
  if (rules.markets && !rules.markets.includes(l.market)) return 'market filtered out';
  if (l.inputs !== 'REAL') return 'estimated inputs: display only';
  if (!knownAvailability(l.availability)) return `availability ${l.availability.toLowerCase().replace(/_/g, ' ')}: display only`;
  if (mode === 'edge' || mode === 'safe') {
    // the shared "bettable" rules: doubtful players and legs with no real usage never enter a qualified ticket
    const b = bettableIssue({ sport: l.sport, market: l.market, mu: l.mu, pm: l.pm, inputs: l.inputs, availability: l.availability }, rules.bet);
    if (b) return `${b}: not bettable`;
  }
  if (mode === 'edge') {
    if (l.tag !== 'EDGE') return 'no qualified priced single (needs a real two-way price and EV > 0)';
    const j = juiceIssue(l.side === 'OVER' ? l.overOdds : l.underOdds, rules.bet);
    if (j) return j;
  }
  if (mode === 'safe') {
    if (l.pLean < rules.minP) return `win probability ${(l.pLean * 100).toFixed(0)}% is below ${(rules.minP * 100).toFixed(0)}%`;
    const one = (l.overOdds == null) !== (l.underOdds == null);
    if (one) return 'one-sided price';
    const chosen = l.side === 'OVER' ? l.overOdds : l.underOdds;
    if (chosen != null && chosen < -rules.maxJuice) return `priced ${chosen}: juice above ${rules.maxJuice}`;
  }
  return null;
}

/** NFL priced snapshots (receptions): two-way or one-sided market rows with a real line. BET → EDGE tag. */
export function legsFromNflSnapshots(snaps: any[], today: string): ParlayLeg[] {
  const out: ParlayLeg[] = [];
  for (const s of snaps || []) {
    if (!s || s.hasMarket === false) continue;
    if (s.line == null || !Number.isFinite(Number(s.line))) continue;
    if (!Number.isFinite(Number(s.mu))) continue;
    const overParsed = typeof s.overOdds === 'number' ? s.overOdds : (s.overOdds != null && String(s.overOdds).trim() !== '' ? Number(String(s.overOdds).replace(/[−–—]/g, '-').replace(/^\+/, '')) : null);
    const underParsed = typeof s.underOdds === 'number' ? s.underOdds : (s.underOdds != null && String(s.underOdds).trim() !== '' ? Number(String(s.underOdds).replace(/[−–—]/g, '-').replace(/^\+/, '')) : null);
    const overOdds = Number.isFinite(overParsed as number) && Math.abs(overParsed as number) >= 100 ? Math.round(overParsed as number) : null;
    const underOdds = Number.isFinite(underParsed as number) && Math.abs(underParsed as number) >= 100 ? Math.round(underParsed as number) : null;
    if (overOdds == null && underOdds == null) continue;
    const playerId = String(s.player || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const side: 'OVER' | 'UNDER' = (s.lean === 'UNDER' ? 'UNDER' : 'OVER');
    const pOver = typeof s.p_over === 'number' ? s.p_over : 0.5;
    const pLean = side === 'OVER' ? pOver : 1 - pOver;
    const tag: 'EDGE' | 'NONE' = s.cardStatus === 'BET' ? 'EDGE' : 'NONE';
    const inputs = (s.inputsSource === 'REAL' || s.inputsSource === 'ESTIMATED' || s.inputsSource === 'UNKNOWN') ? s.inputsSource : 'UNKNOWN';
    const availability = s.availability || 'UNKNOWN';
    const season = s.season ?? 0;
    const week = s.week ?? 0;
    const gameId = String(s.gameKey || `${season}-${week}-${s.team}`);
    out.push({
      id: `${season}-${week}:rec:${playerId}:${side}:${s.line}`,
      src: 'ledger',
      sport: 'nfl',
      date: today,
      gameId,
      playerId,
      playerName: s.player,
      team: s.team,
      opp: '',
      market: 'rec',
      side,
      line: Number(s.line),
      mu: Number(s.mu),
      pm: null,
      r: typeof s.alpha === 'number' && s.alpha > 0 ? 1 / s.alpha : null,
      pLean,
      tag,
      inputs,
      availability,
      overOdds,
      underOdds,
      teamKey: `${season}-${week}|${s.team}`,
    });
  }
  return out;
}

export function buildPool(cardLegs: ParlayLeg[], priced: ParlayLeg[]): ParlayLeg[] {
  const hasPriced = new Set(priced.map(l => `${l.playerId}|${l.market}`));
  return [...priced, ...cardLegs.filter(l => !hasPriced.has(`${l.playerId}|${l.market}`))];
}

/** Why this exact set of legs cannot be a ticket in this mode, or null. */
export function ticketConflict(legs: ParlayLeg[], mode: ParlayMode): string | null {
  const seen = new Set<string>();
  for (const l of legs) {
    const k = `${l.playerId}|${l.market}`;
    if (seen.has(k)) return 'Two legs on the same player and stat: pick one line.';
    seen.add(k);
  }
  if (legs.some(l => l.sport !== legs[0].sport)) return 'Cross-sport tickets are not supported.';
  if (legs[0]?.sport === 'nba') {
    const parts = ['pts', 'reb', 'ast'];
    for (const l of legs) if (l.market === 'pra' && legs.some(o => o.playerId === l.playerId && parts.includes(o.market))) return 'PRA already includes points, rebounds and assists for that player: drop one leg.';
  }
  const games = new Set(legs.map(l => l.gameId));
  if (mode === 'sgp' && games.size !== 1) return 'Same-game mode needs every leg from one game.';
  if (mode === 'cross' && games.size !== legs.length) return 'Cross-game mode needs every leg from a different game.';
  if (mode === 'edge' || mode === 'safe') {
    const perTeam = new Map<string, number>();
    for (const l of legs) perTeam.set(l.teamKey, (perTeam.get(l.teamKey) ?? 0) + 1);
    if ([...perTeam.values()].some(n => n > 2)) return 'More than two legs on one team in one game: too concentrated for this mode.';
  }
  return null;
}

/* --------------------------------- pricing -------------------------------- */

const sl = (l: ParlayLeg): SLeg => ({ marginal: { mu: l.mu, r: l.r! }, line: l.line, side: l.side === 'OVER' ? 'over' : 'under' });

function blockCorr(legs: ParlayLeg[]): number[][] {
  const shotsTm = GAMESIM_PARAMS.nhl.shotsTeammateCorr, ptsTm = GAMESIM_PARAMS.nhl.pointsTeammateCorrTarget;
  return legs.map((a, i) => legs.map((b, j) => {
    if (i === j) return 1;
    if (a.team !== b.team) return 0;
    if (a.sport === 'nhl') {
      if (a.playerId === b.playerId) return a.market === b.market ? 1 : NHL_CONFIG.rhoShotsPoints;
      if (a.market === 'sog' && b.market === 'sog') return shotsTm;
      if (a.market === 'pts' && b.market === 'pts') return ptsTm;
      return 0; // cross-stat teammates: not measured, left at 0
    }
    if (a.sport === 'nfl') return CORR_PRIORS.nfl.teammates;
    return 0;
  }));
}

/** P(all legs of ONE game win) and the product of the same legs; method says how the dependence was handled. */
function priceGame(legs: ParlayLeg[], sims: number): { p: number; pIndep: number; se: number; correlated: boolean; note?: string } {
  const prodLean = legs.reduce((a, l) => a * l.pLean, 1);
  if (legs.length === 1) return { p: legs[0].pLean, pIndep: legs[0].pLean, se: 0, correlated: false };
  const sport = legs[0].sport;
  if (sport === 'mlb') {
    const s = simMlbCard(legs.map(l => ({ name: l.playerName, team: l.team, p: l.pLean, game: l.gameId })), Math.max(4000, sims));
    if (!s) return { p: prodLean, pIndep: prodLean, se: 0, correlated: false };
    return { p: s.sim, pIndep: s.indep, se: s.se, correlated: true, note: 'MLB same-game factors from the existing simulation (game 3%, team 7%).' };
  }
  if (sport === 'nba') {
    const res = priceNbaJoint(legs.map(l => ({ playerId: l.playerId as number, team: l.team, gameId: l.gameId, market: l.market as NbaMarket, mu: l.mu, r: l.r!, line: l.line, side: l.side === 'OVER' ? 'over' : 'under' } as NbaJointLeg)), { sims });
    if (res.conflict) return { p: 0, pIndep: 0, se: 0, correlated: false, note: res.conflict };
    return { p: res.p, pIndep: res.pIndep, se: res.se, correlated: true };
  }
  const corr = blockCorr(legs);
  const res = jointProbability(legs.map(sl), corr, { sims });
  const off = corr.some((row, i) => row.some((v, j) => i !== j && v !== 0));
  return { p: res.p, pIndep: res.pIndep, se: res.se, correlated: off };
}

export const americanToDecimal = (o: number): number => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));

export function priceTicket(legs: ParlayLeg[], mode: ParlayMode, opts: { sims?: number; bookAmerican?: number | null; now?: number } = {}): ParlayTicket {
  const sims = opts.sims ?? 20000;
  const warnings: string[] = [];
  const conflict = legs.length ? ticketConflict(legs, mode) : 'No legs.';
  const byGame = new Map<string, ParlayLeg[]>();
  for (const l of legs) byGame.set(l.gameId, [...(byGame.get(l.gameId) ?? []), l]);
  let p = 1, pIndep = 1, varRel = 0, correlated = false;
  if (!conflict) {
    for (const g of byGame.values()) {
      const r = priceGame(g, sims);
      if (r.note && r.p === 0) { warnings.push(r.note); p = 0; continue; }
      p *= r.p; pIndep *= r.pIndep; if (r.p > 0) varRel += (r.se / r.p) ** 2;
      correlated = correlated || (g.length > 1 && r.correlated);
      if (r.note) warnings.push(r.note);
    }
  } else { warnings.push(conflict); p = 0; pIndep = 0; }
  const se = p * Math.sqrt(varRel);
  if (!conflict) {
    if (legs.some(l => l.inputs !== 'REAL' || !knownAvailability(l.availability))) warnings.push('Contains an estimated / unknown-availability leg: display only, not a qualified ticket.');
    if (byGame.size === legs.length) warnings.push('Every leg is from a different game: the price is the plain product of the legs.');
    else if (!correlated) warnings.push('Same-game legs with no measured dependence (teammates / opponents ≈ 0): priced close to the product.');
    if (legs.some(l => l.sport === 'nhl') && [...byGame.values()].some(g => g.some(a => g.some(b => a !== b && a.playerId === b.playerId))))
      warnings.push('Same-skater shots↔points uses the shots-points correlation from NHL Settings (a prior, not measured); open the player drawer for the game simulation.');
    if (legs.some(l => Number.isInteger(l.line))) warnings.push('A whole-number line can push; a push voids the leg at most books. Correlated blocks here count a push as not winning.');
    if (legs.some(l => l.src === 'card')) warnings.push('Model-only legs: no book price was used. This is a fair probability, not an edge.');
    warnings.push('Each extra leg multiplies the book\'s margin: unless the single legs are individually qualified, the same plays as straight bets carry less risk.');
  }
  const book = opts.bookAmerican ?? null;
  const ev = book !== null && p > 0 ? p * americanToDecimal(book) - 1 : null;
  if (book === null) warnings.push('No book parlay price entered: fair price only, EV not computed.');
  return {
    id: legs.map(l => l.id).join('+'), sport: legs[0]?.sport ?? 'nba', mode, legs, jointP: p, indepP: pIndep, fairAmerican: fairAmerican(p),
    bookAmerican: book, ev, correlated, warnings, createdAt: opts.now ?? Date.now(), se
  };
}

/* ------------------------------- suggestions ------------------------------ */

function combos<T>(items: T[], k: number, cap: number, ok: (c: T[]) => boolean): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (out.length >= cap) return;
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < items.length && out.length < cap; i++) {
      cur.push(items[i]);
      if (ok(cur)) rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

/**
 * Best tickets for a mode and leg count, deterministic. Candidates are pre-ranked by the plain product (cheap), the best
 * few dozen are priced properly and ranked by their real joint probability. Suggested tickets share at most L-1 legs.
 * With `disjoint`, no leg is used twice (used for the automatic paper tickets, so their outcomes are not copies of each other).
 */
export function suggestTickets(pool: ParlayLeg[], mode: ParlayMode, L: number, rules: ParlayRules, opts: { top?: number; disjoint?: boolean; sims?: number } = {}): ParlayTicket[] {
  const top = opts.top ?? 5;
  const legs = pool.filter(l => legIssue(l, mode, rules) === null).sort((a, b) => b.pLean - a.pLean || a.id.localeCompare(b.id));
  if (legs.length < L) return [];
  const cap = 4000;
  const cands: ParlayLeg[][] = [];
  if (mode === 'sgp') {
    const games = new Map<string, ParlayLeg[]>();
    for (const l of legs) games.set(l.gameId, [...(games.get(l.gameId) ?? []), l]);
    for (const g of [...games.keys()].sort()) {
      const items = games.get(g)!.slice(0, 14);
      if (items.length >= L) cands.push(...combos(items, L, cap / 4, c => ticketConflict(c, 'sgp') === null || c.length < L && !c.some((x, i) => c.some((y, j) => i < j && x.playerId === y.playerId && x.market === y.market))));
    }
  } else {
    cands.push(...combos(legs.slice(0, 40), L, cap, c => (mode === 'cross' ? new Set(c.map(x => x.gameId)).size === c.length : true) && !c.some((x, i) => c.some((y, j) => i < j && x.playerId === y.playerId && x.market === y.market))));
  }
  const valid = cands.filter(c => ticketConflict(c, mode) === null);
  valid.sort((a, b) => b.reduce((s, l) => s * l.pLean, 1) - a.reduce((s, l) => s * l.pLean, 1));
  const priced = valid.slice(0, 40).map(c => priceTicket(c, mode, { sims: opts.sims ?? 6000, now: 0 })).filter(t => t.jointP > 0);
  priced.sort((a, b) => b.jointP - a.jointP || a.id.localeCompare(b.id));
  const picked: ParlayTicket[] = [];
  for (const t of priced) {
    const ids = new Set(t.legs.map(l => l.id));
    const clash = picked.some(p => opts.disjoint ? p.legs.some(l => ids.has(l.id)) : p.legs.filter(l => ids.has(l.id)).length >= L);
    if (!clash) picked.push(t);
    if (picked.length >= top) break;
  }
  return picked;
}

/* ------------------------------ paper tickets ----------------------------- */

export interface PaperLeg { id: string; src: 'card' | 'ledger'; name: string; market: string; side: 'OVER' | 'UNDER'; line: number; pLean: number; gameId: string }
export interface PaperTicket {
  id: string; date: string; sport: PSport; mode: ParlayMode; L: number; legs: PaperLeg[];
  /** correlated joint at capture time, the plain product, and whether dependence was modelled */
  jointP: number; indepP: number; correlated: boolean;
  result: 'HIT' | 'MISS' | 'VOID' | null; gradedAt?: number;
}
export type LegState = 'HIT' | 'MISS' | 'PUSH' | 'VOID' | null;

/** Deterministic daily tickets from pre-game information only (leg probabilities at capture time). A fixed menu, three per slot at most, disjoint legs. */
export const PAPER_MENU: { mode: ParlayMode; L: number }[] = [
  { mode: 'safe', L: 2 }, { mode: 'cross', L: 3 }, { mode: 'sgp', L: 2 }, { mode: 'edge', L: 2 }
];
export function paperTicketsFor(sport: PSport, pool: ParlayLeg[], existing: PaperTicket[], date: string, rules: ParlayRules = DEFAULT_RULES): PaperTicket[] {
  const out: PaperTicket[] = [];
  for (const { mode, L } of PAPER_MENU) {
    // slots already filled today for this menu item, and the legs they use (a later build must not reuse them)
    const mine = existing.filter(t => t.date === date && t.sport === sport && t.mode === mode && t.L === L);
    if (mine.length >= 3) continue;
    const used = new Set(mine.flatMap(t => t.legs.map(l => l.id)));
    const sug = suggestTickets(pool.filter(l => !used.has(l.id)), mode, L, rules, { top: 3 - mine.length, disjoint: true, sims: 8000 });
    sug.forEach((t, k) => {
      out.push({ id: `${date}:${sport}:${mode}${L}:${mine.length + k}`, date, sport, mode, L, jointP: t.jointP, indepP: t.indepP, correlated: t.correlated, result: null,
        legs: t.legs.map(l => ({ id: l.id, src: l.src, name: l.playerName, market: l.market, side: l.side, line: l.line, pLean: l.pLean, gameId: l.gameId })) });
    });
  }
  return out;
}

/** MISS if any leg missed (a lost ticket is lost); VOID if any leg is void / pushed (excluded from calibration); HIT if all hit. */
export function gradePaperTickets(tickets: PaperTicket[], legState: (l: PaperLeg) => LegState, now = Date.now(), stale?: { today: string; days: number }): { tickets: PaperTicket[]; graded: number; voided: number; pending: number } {
  let graded = 0, voided = 0, pending = 0;
  const out = tickets.map(t => {
    if (t.result !== null) return t;
    const st = t.legs.map(legState);
    // a void / pushed leg excludes the ticket whatever the other legs did, so voids cannot bias the hit rate
    if (st.some(s => s === 'VOID' || s === 'PUSH')) { voided++; return { ...t, result: 'VOID' as const, gradedAt: now }; }
    if (st.some(s => s === 'MISS')) { graded++; return { ...t, result: 'MISS' as const, gradedAt: now }; }
    if (st.every(s => s === 'HIT')) { graded++; return { ...t, result: 'HIT' as const, gradedAt: now }; }
    // a leg that never resolves (row pruned, game never reported) must not hang the ticket forever
    if (stale && Date.parse(stale.today) - Date.parse(t.date) > stale.days * 86400000) { voided++; return { ...t, result: 'VOID' as const, gradedAt: now }; }
    pending++; return t;
  });
  return { tickets: out, graded, voided, pending };
}

export interface PaperStats { key: string; sport: PSport; mode: ParlayMode; L: number; n: number; hits: number; predicted: number | null; realized: number | null; noise: number | null; brier: number | null; brierIndep: number | null; correlated: number }
export function summarizePaper(tickets: PaperTicket[]): PaperStats[] {
  const groups = new Map<string, PaperTicket[]>();
  for (const t of tickets) if (t.result === 'HIT' || t.result === 'MISS') { const k = `${t.sport}|${t.mode}|${t.L}`; groups.set(k, [...(groups.get(k) ?? []), t]); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, ts]) => {
    const n = ts.length, hits = ts.filter(t => t.result === 'HIT').length;
    const o = (t: PaperTicket) => (t.result === 'HIT' ? 1 : 0);
    const realized = hits / n;
    return {
      key, sport: ts[0].sport, mode: ts[0].mode, L: ts[0].L, n, hits,
      predicted: ts.reduce((s, t) => s + t.jointP, 0) / n, realized, noise: Math.sqrt(realized * (1 - realized) / n),
      brier: ts.reduce((s, t) => s + (t.jointP - o(t)) ** 2, 0) / n, brierIndep: ts.reduce((s, t) => s + (t.indepP - o(t)) ** 2, 0) / n,
      correlated: ts.filter(t => t.correlated).length
    };
  });
}
