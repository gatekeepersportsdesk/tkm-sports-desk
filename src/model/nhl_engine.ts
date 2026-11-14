/**
 * NHL props engine v2 (sog_v2): shots on goal + points.
 *
 * What changed from sog_v1 and why:
 *  - Rates are SHRUNK, not raw. A skater with 4 games and a 6.0 shots/game
 *    start is not a 6.0 shooter: current-season rate is pulled toward the
 *    prior-season rate, which is itself pulled toward a position prior.
 *  - Opponent factors come from live team shots-against / goals-against
 *    (shrunk by games played), with the old hand-typed table only as a
 *    half-weight fallback that is labelled as such.
 *  - Points market (NB, r is a PRIOR to be calibrated on the ledger).
 *  - Pricing goes through the shared odds lib: two-way de-vig, EV at the price
 *    actually offered, FADE only with a real under price.
 *  - The universal gate (availability -> input quality -> edge) decides the
 *    final tag; estimated inputs can never be STAB / FADE.
 */
import { forcePassIfUnavailable, AvailabilityStatus, InputsSource } from '../lib/availability';
import { priceMarket, DEFAULT_ONE_SIDED_HOLD } from '../lib/odds';
import { nbinomPmfR, lineProbsFromPmf, LineProbs } from './dist';
import { NHL_FIT, NhlFit } from '../data/nhl_fit';
import { CORR_PRIORS } from './sampler';
import {
  NhlPlayerSnapshot,
  NhlSkaterProjection,
  NhlMarketProjection,
  NhlMarket,
  NhlTeamFactors
} from '../types/nhl';

export const NHL_CONFIG = {
  version: 'sog_v2',
  sog: {
    /** dispersion carried over from sog_v1 (frozen) */
    r: 15.13,
    /** pseudo-games of prior-season evidence behind the current-season rate */
    shrinkK: 20,
    /** pseudo-games of position prior behind the prior-season rate */
    priorK: 20,
    /** position priors (shots / game) used only when data is thin */
    posPrior: { F: 2.0, D: 1.6 } as Record<'F' | 'D', number>,
    lines: [1.5, 2.5, 3.5, 4.5, 5.5]
  },
  pts: {
    /** PRIOR, not fitted: points per game are nearly Poisson; calibrate on the ledger */
    r: 12,
    shrinkK: 40,
    priorK: 40,
    posPrior: { F: 0.45, D: 0.25 } as Record<'F' | 'D', number>,
    lines: [0.5, 1.5, 2.5]
  },
  /** pseudo-games behind a team's shots/goals-against rate */
  teamShrinkK: 15,
  factorClamp: [0.8, 1.25] as [number, number],
  /** a skater needs this many (current + prior) games for REAL inputs */
  minGamesReal: 15,
  edgeMinPts: 5.0,
  maxChalk: -200,
  oneSidedHold: DEFAULT_ONE_SIDED_HOLD,
  /** half weight on the stale hand-typed opponent table */
  staticFactorWeight: 0.5,
  /** same-skater game shots vs game points correlation. PRIOR (not measured), used by the joint sampler */
  rhoShotsPoints: CORR_PRIORS.nhl.shotsPoints,
  /** Monte Carlo draws for joint questions */
  sims: 15000
};

// ---- fitted overlay -------------------------------------------------------
// src/data/nhl_fit.ts is GENERATED from real MoneyPuck game logs by scripts/fit_nhl_moneypuck.py and is null
// until that has been run. When present, only the keys it actually fitted replace the old priors; each is
// clamped to the same bounds the Settings screen allows so a bad file cannot break pricing.
const FIT_BOUNDS: Record<string, [number, number]> = {
  sogR: [2, 200], ptsR: [2, 200], sogShrinkK: [1, 200], sogPriorK: [1, 200], ptsShrinkK: [1, 300], ptsPriorK: [1, 300],
  posPriorSogF: [0.5, 4], posPriorSogD: [0.3, 3], posPriorPtsF: [0.1, 1.2], posPriorPtsD: [0.05, 0.8], rhoShotsPoints: [-0.5, 0.9]
};
export const NHL_FITTED_KEYS: string[] = [];
/** Applies fitted values in-bounds only; returns the keys it used. Exported so it can be tested. */
export function applyNhlFit(fit: NhlFit | null): string[] {
  const used: string[] = [];
  if (!fit) return used;
  const v = fit.values;
  const get = (k: string): number | null => {
    const x = v[k]; const b = FIT_BOUNDS[k];
    return typeof x === 'number' && Number.isFinite(x) && b && x >= b[0] && x <= b[1] ? x : null;
  };
  const set = (k: string, f: (x: number) => void) => { const x = get(k); if (x !== null) { f(x); used.push(k); } };
  set('sogR', x => { NHL_CONFIG.sog.r = x; });
  set('ptsR', x => { NHL_CONFIG.pts.r = x; });
  set('sogShrinkK', x => { NHL_CONFIG.sog.shrinkK = x; });
  set('sogPriorK', x => { NHL_CONFIG.sog.priorK = x; });
  set('ptsShrinkK', x => { NHL_CONFIG.pts.shrinkK = x; });
  set('ptsPriorK', x => { NHL_CONFIG.pts.priorK = x; });
  set('posPriorSogF', x => { NHL_CONFIG.sog.posPrior.F = x; });
  set('posPriorSogD', x => { NHL_CONFIG.sog.posPrior.D = x; });
  set('posPriorPtsF', x => { NHL_CONFIG.pts.posPrior.F = x; });
  set('posPriorPtsD', x => { NHL_CONFIG.pts.posPrior.D = x; });
  set('rhoShotsPoints', x => { NHL_CONFIG.rhoShotsPoints = x; });
  return used;
}
NHL_FITTED_KEYS.push(...applyNhlFit(NHL_FIT));

/**
 * Every prior / frozen value, flat, so the Settings screen can show and
 * override each one. `status` says what kind of number it is.
 */
export interface NhlTuning {
  sogR: number;
  ptsR: number;
  sogShrinkK: number;
  sogPriorK: number;
  ptsShrinkK: number;
  ptsPriorK: number;
  posPriorSogF: number;
  posPriorSogD: number;
  posPriorPtsF: number;
  posPriorPtsD: number;
  teamShrinkK: number;
  staticFactorWeight: number;
  rhoShotsPoints: number;
  sims: number;
}

export const NHL_TUNING_DEFAULTS: NhlTuning = {
  sogR: NHL_CONFIG.sog.r,
  ptsR: NHL_CONFIG.pts.r,
  sogShrinkK: NHL_CONFIG.sog.shrinkK,
  sogPriorK: NHL_CONFIG.sog.priorK,
  ptsShrinkK: NHL_CONFIG.pts.shrinkK,
  ptsPriorK: NHL_CONFIG.pts.priorK,
  posPriorSogF: NHL_CONFIG.sog.posPrior.F,
  posPriorSogD: NHL_CONFIG.sog.posPrior.D,
  posPriorPtsF: NHL_CONFIG.pts.posPrior.F,
  posPriorPtsD: NHL_CONFIG.pts.posPrior.D,
  teamShrinkK: NHL_CONFIG.teamShrinkK,
  staticFactorWeight: NHL_CONFIG.staticFactorWeight,
  rhoShotsPoints: NHL_CONFIG.rhoShotsPoints,
  sims: NHL_CONFIG.sims
};

export type NhlTuningStatus = 'fitted from data' | 'frozen from sog_v1' | 'prior — not fitted' | 'prior — not measured' | 'setting';
export const NHL_TUNING_META: Record<keyof NhlTuning, { label: string; status: NhlTuningStatus; min: number; max: number; step: number; help: string }> = {
  sogR: { label: 'SOG dispersion r', status: 'frozen from sog_v1', min: 2, max: 200, step: 0.01, help: 'Higher = closer to Poisson. Lower = fatter tails.' },
  ptsR: { label: 'Points dispersion r', status: 'prior — not fitted', min: 2, max: 200, step: 0.5, help: 'Fit it from the ledger interval coverage.' },
  sogShrinkK: { label: 'SOG shrink K (games)', status: 'prior — not fitted', min: 1, max: 200, step: 1, help: 'Pseudo-games of last-season evidence behind the current rate.' },
  sogPriorK: { label: 'SOG prior-season K (games)', status: 'prior — not fitted', min: 1, max: 200, step: 1, help: 'Pseudo-games of position prior behind last season.' },
  ptsShrinkK: { label: 'Points shrink K (games)', status: 'prior — not fitted', min: 1, max: 300, step: 1, help: 'Points are noisier than shots, so this is larger.' },
  ptsPriorK: { label: 'Points prior-season K (games)', status: 'prior — not fitted', min: 1, max: 300, step: 1, help: '' },
  posPriorSogF: { label: 'Forward SOG/game prior', status: 'prior — not fitted', min: 0.5, max: 4, step: 0.05, help: 'Used only for thin data (rookies).' },
  posPriorSogD: { label: 'Defense SOG/game prior', status: 'prior — not fitted', min: 0.3, max: 3, step: 0.05, help: '' },
  posPriorPtsF: { label: 'Forward pts/game prior', status: 'prior — not fitted', min: 0.1, max: 1.2, step: 0.01, help: '' },
  posPriorPtsD: { label: 'Defense pts/game prior', status: 'prior — not fitted', min: 0.05, max: 0.8, step: 0.01, help: '' },
  teamShrinkK: { label: 'Opponent factor K (games)', status: 'prior — not fitted', min: 1, max: 82, step: 1, help: 'Early season, team shot/goal rates are mostly noise.' },
  staticFactorWeight: { label: 'Stale opponent table weight', status: 'setting', min: 0, max: 1, step: 0.05, help: 'Only used when the live team table is down. 0 = ignore it.' },
  rhoShotsPoints: { label: 'Shots↔points correlation', status: 'prior — not measured', min: -0.5, max: 0.9, step: 0.01, help: 'Same skater, same game. Drives the shots+points combo panel only.' },
  sims: { label: 'Monte Carlo draws', status: 'setting', min: 1000, max: 100000, step: 1000, help: 'More draws = less sampling noise on joint probabilities.' }
};

for (const k of NHL_FITTED_KEYS) {
  const meta = (NHL_TUNING_META as Record<string, { status: NhlTuningStatus; help: string }>)[k];
  if (meta) { meta.status = 'fitted from data'; meta.help = `Fitted on ${NHL_FIT!.source} (${NHL_FIT!.nTrainRows.toLocaleString()} skater-games). ${meta.help}`.trim(); }
}

/** Push a tuning object into the live config (the engine reads NHL_CONFIG). */
export function applyNhlTuning(t: Partial<NhlTuning>): void {
  const v = { ...NHL_TUNING_DEFAULTS, ...t };
  const num = (x: number, d: number) => (Number.isFinite(x) ? x : d);
  NHL_CONFIG.sog.r = Math.max(1, num(v.sogR, NHL_TUNING_DEFAULTS.sogR));
  NHL_CONFIG.pts.r = Math.max(1, num(v.ptsR, NHL_TUNING_DEFAULTS.ptsR));
  NHL_CONFIG.sog.shrinkK = Math.max(0, num(v.sogShrinkK, NHL_TUNING_DEFAULTS.sogShrinkK));
  NHL_CONFIG.sog.priorK = Math.max(0, num(v.sogPriorK, NHL_TUNING_DEFAULTS.sogPriorK));
  NHL_CONFIG.pts.shrinkK = Math.max(0, num(v.ptsShrinkK, NHL_TUNING_DEFAULTS.ptsShrinkK));
  NHL_CONFIG.pts.priorK = Math.max(0, num(v.ptsPriorK, NHL_TUNING_DEFAULTS.ptsPriorK));
  NHL_CONFIG.sog.posPrior = { F: Math.max(0.05, num(v.posPriorSogF, 2)), D: Math.max(0.05, num(v.posPriorSogD, 1.6)) };
  NHL_CONFIG.pts.posPrior = { F: Math.max(0.01, num(v.posPriorPtsF, 0.45)), D: Math.max(0.01, num(v.posPriorPtsD, 0.25)) };
  NHL_CONFIG.teamShrinkK = Math.max(0, num(v.teamShrinkK, NHL_TUNING_DEFAULTS.teamShrinkK));
  NHL_CONFIG.staticFactorWeight = Math.min(1, Math.max(0, num(v.staticFactorWeight, 0.5)));
  NHL_CONFIG.rhoShotsPoints = Math.min(0.95, Math.max(-0.95, num(v.rhoShotsPoints, NHL_TUNING_DEFAULTS.rhoShotsPoints)));
  NHL_CONFIG.sims = Math.min(200000, Math.max(1000, Math.round(num(v.sims, NHL_TUNING_DEFAULTS.sims))));
}

/**
 * Hand-typed opponent shots-allowed multipliers from sog_v1. They are old
 * and unsourced, so they are ONLY used (at half weight) when the live team
 * table could not be loaded, and the UI says so.
 */
export const NHL_STATIC_OPP_SOG: Record<string, number> = {
  ANA: 1.14, SJS: 1.18, CHI: 1.11, CBJ: 1.09, MTL: 1.08,
  OTT: 1.04, BUF: 1.03, UTA: 1.02, DET: 1.01,
  VAN: 1.00, EDM: 0.98, TOR: 0.96, BOS: 0.94, NYR: 0.95,
  VGK: 0.93, CAR: 0.88, NJD: 0.91, COL: 0.95, FLA: 0.92,
  TBL: 0.97, DAL: 0.92, WPG: 0.93, LAK: 0.89, MIN: 0.97,
  NSH: 0.96, CGY: 0.99, STL: 1.02, PIT: 1.01, WSH: 0.99,
  PHI: 0.98, NYI: 1.02, SEA: 0.96
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/* ------------------------------------------------------------------ */
/* Shrinkage                                                           */
/* ------------------------------------------------------------------ */

export interface ShrunkRate {
  mu0: number;
  /** effective games of evidence (current + discounted prior) */
  nEff: number;
}

/**
 * Bayesian chain: posterior(prior season | position prior) is the prior for
 * the current season. rate = (n*cur + K*prior) / (n + K).
 */
export function shrinkRate(args: {
  gp: number;
  total: number;
  priorGp?: number;
  priorTotal?: number | null;
  posPrior: number;
  shrinkK: number;
  priorK: number;
}): ShrunkRate {
  const gp = Math.max(0, args.gp || 0);
  const priorGp = Math.max(0, args.priorGp || 0);
  const priorTotal = args.priorTotal ?? 0;
  const priorRate = (priorTotal + args.priorK * args.posPrior) / (priorGp + args.priorK);
  const mu0 = (args.total + args.shrinkK * priorRate) / (gp + args.shrinkK);
  // effective evidence: games played plus the part of the prior season that actually carries weight
  return { mu0, nEff: gp + Math.min(priorGp, args.shrinkK) };
}

export function skaterBaseRate(p: NhlPlayerSnapshot, market: NhlMarket): ShrunkRate | null {
  if (market === 'sog') {
    return shrinkRate({
      gp: p.gp,
      total: p.shots,
      priorGp: p.priorGp,
      priorTotal: p.priorShots ?? 0,
      posPrior: NHL_CONFIG.sog.posPrior[p.pos],
      shrinkK: NHL_CONFIG.sog.shrinkK,
      priorK: NHL_CONFIG.sog.priorK
    });
  }
  if (p.points === null || p.points === undefined) return null;
  return shrinkRate({
    gp: p.gp,
    total: p.points,
    priorGp: p.priorGp,
    priorTotal: p.priorPoints ?? 0,
    posPrior: NHL_CONFIG.pts.posPrior[p.pos],
    shrinkK: NHL_CONFIG.pts.shrinkK,
    priorK: NHL_CONFIG.pts.priorK
  });
}

/** REAL only with a live feed and enough games; otherwise ESTIMATED (cannot be STAB/FADE). */
export function classifyInputs(p: NhlPlayerSnapshot, live: boolean): InputsSource {
  if (!live) return 'ESTIMATED';
  const games = (p.gp || 0) + (p.priorGp || 0);
  return games >= NHL_CONFIG.minGamesReal ? 'REAL' : 'ESTIMATED';
}

/* ------------------------------------------------------------------ */
/* Opponent factors                                                    */
/* ------------------------------------------------------------------ */

export interface TeamRates {
  gp: number;
  shotsAgainstPerGame: number | null;
  goalsAgainstPerGame: number | null;
}

/** ratio vs league, shrunk toward 1 by games played */
export function shrunkFactor(teamRate: number, leagueRate: number, gp: number): number {
  if (!(teamRate > 0) || !(leagueRate > 0)) return 1;
  const w = gp / (gp + NHL_CONFIG.teamShrinkK);
  const f = 1 + (teamRate / leagueRate - 1) * w;
  return clamp(f, NHL_CONFIG.factorClamp[0], NHL_CONFIG.factorClamp[1]);
}

/** Build per-team opponent factors from a live team table. */
export function buildTeamFactors(table: Record<string, TeamRates>): Record<string, NhlTeamFactors> {
  const teams = Object.entries(table).filter(([, t]) => t.gp > 0);
  const league = (pick: (t: TeamRates) => number | null) => {
    let num = 0, den = 0;
    for (const [, t] of teams) {
      const v = pick(t);
      if (v !== null && v > 0) { num += v * t.gp; den += t.gp; }
    }
    return den > 0 ? num / den : 0;
  };
  const lgSog = league(t => t.shotsAgainstPerGame);
  const lgGoals = league(t => t.goalsAgainstPerGame);
  const out: Record<string, NhlTeamFactors> = {};
  for (const [abbr, t] of teams) {
    out[abbr] = {
      sog: t.shotsAgainstPerGame ? shrunkFactor(t.shotsAgainstPerGame, lgSog, t.gp) : 1,
      pts: t.goalsAgainstPerGame ? shrunkFactor(t.goalsAgainstPerGame, lgGoals, t.gp) : 1,
      source: 'live'
    };
  }
  return out;
}

export function opponentFactors(opp: string, live?: Record<string, NhlTeamFactors>): NhlTeamFactors {
  const key = (opp || '').toUpperCase();
  if (live && live[key]) return live[key];
  const st = NHL_STATIC_OPP_SOG[key];
  if (st !== undefined) {
    return { sog: 1 + (st - 1) * NHL_CONFIG.staticFactorWeight, pts: 1, source: 'static' };
  }
  return { sog: 1, pts: 1, source: 'none' };
}

/* ------------------------------------------------------------------ */
/* Distribution                                                        */
/* ------------------------------------------------------------------ */

export function nbinomPmf(k: number, mu: number, r: number = NHL_CONFIG.sog.r): number {
  if (k < 0 || mu <= 0) return 0;
  return nbinomPmfR(k, mu, r);
}

/** P(Y > line) for a half line (kept for compatibility with v1 call sites). */
export function pOverLine(line: number, mu: number, r: number = NHL_CONFIG.sog.r): number {
  const probs = lineProbsFromPmf(k => nbinomPmf(k, mu, r), line);
  return Math.min(Math.max(probs.p_over, 1e-6), 1 - 1e-6);
}

export function priceLine(mu: number, r: number, line: number): LineProbs {
  return lineProbsFromPmf(k => nbinomPmf(k, mu, r), line);
}

import { getNhlContextAdjustments, NhlContextAdjustment } from '../lib/nhl_context_priors';

function projectMarket(
  p: NhlPlayerSnapshot,
  market: NhlMarket,
  oppFactor: number,
  contextFactor: number = 1.0,
  contextAdjustments: NhlContextAdjustment[] = []
): NhlMarketProjection | null {
  const rate = skaterBaseRate(p, market);
  if (!rate) return null;
  const cfg = NHL_CONFIG[market];
  const mu = Math.max(0.02, rate.mu0 * oppFactor * contextFactor);
  const probs: Record<number, LineProbs> = {};
  for (const l of cfg.lines) probs[l] = priceLine(mu, cfg.r, l);
  const defaultLine = cfg.lines.reduce((best, l) =>
    Math.abs(probs[l].p_over - 0.5) < Math.abs(probs[best].p_over - 0.5) ? l : best, cfg.lines[0]);
  return {
    market,
    mu0: rate.mu0,
    nEff: rate.nEff,
    oppFactor,
    contextFactor,
    contextAdjustments,
    mu,
    r: cfg.r,
    lines: cfg.lines,
    defaultLine,
    probs
  };
}

export function projectNhlSkater(
  player: NhlPlayerSnapshot,
  oppTeam: string,
  liveFactors?: Record<string, NhlTeamFactors>
): NhlSkaterProjection {
  const f = opponentFactors(oppTeam, liveFactors);
  const ctx = getNhlContextAdjustments(player.name, player.team, oppTeam, player.pos);
  const sog = projectMarket(player, 'sog', f.sog, ctx.totalFactor, ctx.adjustments)!;
  const pts = projectMarket(player, 'pts', f.pts, ctx.totalFactor, ctx.adjustments);
  return {
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    opp: (oppTeam || '').toUpperCase(),
    pos: player.pos,
    toiAvg: player.toiAvg,
    recentShots: player.recentShots || [],
    recentPoints: player.recentPoints || [],
    oppSource: f.source,
    contextAdjustments: ctx.adjustments,
    contextFactor: ctx.totalFactor,
    sog,
    pts,
    availability: player.availability ?? 'UNKNOWN',
    inputsSource: player.inputsSource ?? 'ESTIMATED'
  };
}

/* ------------------------------------------------------------------ */
/* Odds + decision                                                     */
/* ------------------------------------------------------------------ */

export function parseAmericanOdds(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const raw = String(input).trim().replace(/[−–—]/g, '-').replace(/^\+/, '');
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return Math.round(n);
}

export interface NhlDecisionInput {
  pOver: number;
  pUnder: number;
  pPush?: number;
  over: number | null | undefined;
  under: number | null | undefined;
  edgeMinPts?: number;
  /** worst acceptable favourite price, e.g. -200 */
  maxChalk?: number;
  availability?: AvailabilityStatus;
  inputsSource?: InputsSource;
  hold?: number;
}

export interface NhlDecision {
  tag: 'STAB' | 'FADE' | 'PASS';
  side: 'over' | 'under' | null;
  /** edge in percentage points on the tagged side (best priced side when PASS) */
  edge: number;
  ev: number | null;
  edgeOver: number | null;
  edgeUnder: number | null;
  evOver: number | null;
  evUnder: number | null;
  fairOver: number | null;
  twoWay: boolean;
  hasMarket: boolean;
  reason: string;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}pp`;

export function evaluateNhlMarket(inp: NhlDecisionInput): NhlDecision {
  const edgeMin = inp.edgeMinPts ?? NHL_CONFIG.edgeMinPts;
  const maxChalk = inp.maxChalk ?? NHL_CONFIG.maxChalk;
  const price = priceMarket(inp.over ?? null, inp.under ?? null, inp.hold ?? NHL_CONFIG.oneSidedHold);
  const base: NhlDecision = {
    tag: 'PASS', side: null, edge: 0, ev: null,
    edgeOver: null, edgeUnder: null, evOver: null, evUnder: null,
    fairOver: null, twoWay: false, hasMarket: false, reason: ''
  };

  if (!price) {
    const gated = forcePassIfUnavailable('PASS', 'No market odds entered', inp.availability ?? 'ACTIVE', inp.inputsSource ?? 'REAL');
    return { ...base, reason: gated.reason };
  }

  // pushes (integer lines) are removed from both sides: the bet is refunded
  const push = inp.pPush ?? 0;
  const live = Math.max(1e-9, 1 - push);
  const pOver = inp.pOver / live;
  const pUnder = inp.pUnder / live;

  const edgeOver = price.over ? (pOver - price.fairOver) * 100 : null;
  const edgeUnder = price.under ? (pUnder - price.fairUnder) * 100 : null;
  const evOver = price.over ? pOver * price.over.dec - 1 : null;
  const evUnder = price.under ? pUnder * price.under.dec - 1 : null;

  const overOk = price.over !== null && edgeOver !== null && edgeOver >= edgeMin && (evOver ?? -1) > 0 &&
    !(price.over.us < 0 && price.over.us < maxChalk);
  const underOk = price.under !== null && edgeUnder !== null && edgeUnder >= edgeMin && (evUnder ?? -1) > 0 &&
    !(price.under.us < 0 && price.under.us < maxChalk);

  let wants: 'STAB' | 'FADE' | null = null;
  let side: 'over' | 'under' | null = null;
  if (overOk && underOk) side = (evOver ?? 0) >= (evUnder ?? 0) ? 'over' : 'under';
  else if (overOk) side = 'over';
  else if (underOk) side = 'under';
  if (side) wants = side === 'over' ? 'STAB' : 'FADE';

  // best priced side, shown on the row even when it does not qualify
  const shownSide: 'over' | 'under' | null =
    side ?? (edgeOver !== null && (edgeUnder === null || edgeOver >= edgeUnder) ? 'over' : edgeUnder !== null ? 'under' : null);
  const shownEdge = shownSide === 'over' ? edgeOver : shownSide === 'under' ? edgeUnder : 0;
  const shownEv = shownSide === 'over' ? evOver : shownSide === 'under' ? evUnder : null;

  let reason: string;
  if (wants) {
    const o = side === 'over' ? price.over! : price.under!;
    reason =
      `${side === 'over' ? 'Over' : 'Under'} ${o.us > 0 ? '+' : ''}${o.us}: model beats the de-vigged price by ${pct(shownEdge ?? 0)}, ` +
      `EV ${((shownEv ?? 0) * 100).toFixed(1)}% at the offered price.` +
      (price.twoWay ? '' : ` One-sided price: assumed ${((price.hold - 1) * 100).toFixed(0)}% hold.`);
  } else if (shownSide === null) {
    reason = 'No usable price.';
  } else if ((shownEdge ?? 0) >= edgeMin && (shownEv ?? 0) <= 0) {
    reason = `Edge ${pct(shownEdge ?? 0)} does not survive the vig (EV ${((shownEv ?? 0) * 100).toFixed(1)}%).`;
  } else if ((shownEdge ?? 0) >= edgeMin) {
    reason = `Edge ${pct(shownEdge ?? 0)} on the ${shownSide} disqualified: price is worse than ${maxChalk} chalk.`;
  } else if (price.over && !price.under && (edgeOver ?? 0) <= -edgeMin) {
    reason = `Model is ${Math.abs(edgeOver ?? 0).toFixed(1)}pp below the over price, but the under is not priced — enter it to qualify a FADE.`;
  } else {
    reason = `Within neutral margin (${pct(shownEdge ?? 0)}).`;
  }

  // Universal gate: availability -> input quality -> edge
  const gated = forcePassIfUnavailable(
    wants ? 'BET' : 'PASS',
    reason,
    inp.availability ?? 'UNKNOWN',
    inp.inputsSource ?? 'ESTIMATED',
    { requireKnownAvailability: true }
  );
  const final = gated.status === 'BET' && wants ? wants : 'PASS';

  return {
    tag: final,
    side: final === 'PASS' ? null : side,
    edge: shownEdge ?? 0,
    ev: shownEv,
    edgeOver, edgeUnder, evOver, evUnder,
    fairOver: price.fairOver,
    twoWay: price.twoWay,
    hasMarket: true,
    reason: gated.reason
  };
}

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

export function gradeActual(actual: number, line: number): 'OVER' | 'UNDER' | 'PUSH' {
  if (actual > line) return 'OVER';
  if (actual < line) return 'UNDER';
  return 'PUSH';
}

/** Units won (+) or lost (-) per 1u on the tagged side; 0 on push / void / unqualified. */
export function ledgerUnits(row: {
  tag: 'STAB' | 'FADE' | 'PASS';
  side: 'over' | 'under' | null;
  result: 'OVER' | 'UNDER' | 'PUSH' | 'VOID' | null;
  overOdds: number | null;
  underOdds: number | null;
}): number | null {
  if (row.tag === 'PASS' || !row.side || row.result === null) return null;
  if (row.result === 'PUSH' || row.result === 'VOID') return 0;
  const odds = row.side === 'over' ? row.overOdds : row.underOdds;
  if (odds === null) return null;
  const dec = odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
  const won = (row.side === 'over' && row.result === 'OVER') || (row.side === 'under' && row.result === 'UNDER');
  return won ? dec - 1 : -1;
}
