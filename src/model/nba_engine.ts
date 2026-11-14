/**
 * NBA props engine (nba_v2): points, rebounds, assists, three-pointers made, PRA, steals, blocks.
 *
 * Every number below was FIT on real ESPN box scores (src/data/nba_fit.ts, written by scripts/nba/fit_nba.py) and
 * validated leave-one-season-out. This file mirrors that script exactly; src/model/nba_engine.test.ts replays 300
 * exported rows and requires the same numbers to 1e-9.
 *
 *   rate  = per-MINUTE rate, shrunk: current-season totals -> last season -> position prior; players with little or no
 *           usable last season (rookies) or a new team lean on THIS season sooner (fitted K multiplier per group)
 *   pm    = projected minutes = W * last-5 minutes + (1 - W) * season average (shrunk toward last season / position)
 *   mu    = rate * pm * opponent-allowed factor^oppCoef * exp(absCoef*L + absSlope*L*(pm/30-1)) * level(group, games)
 *           (L = rotation minutes lost to Out/Doubtful teammates / 100; bench players absorb proportionally more)
 *   Y ~ NegBin(mu, r),  r = groupScale * rA * (pm / 30)^rB     (starters are much less dispersed than bench players)
 *
 * Decisions go through the SAME gate as the other sports: availability -> input quality -> edge, EV at the offered
 * price, no one-sided FADEs, estimated or unknown players can never be STAB / FADE.
 */
import { NBA_FIT, NbaFit } from '../data/nba_fit';
import { priceLine, evaluateNhlMarket, NhlDecision, gradeActual } from './nhl_engine';
import { AvailabilityStatus, InputsSource } from '../lib/availability';
import {
  NbaMarket, NBA_MARKETS, NbaPlayerSnapshot, NbaTeamFactors, NbaMarketProjection, NbaPlayerProjection, NbaCounts, NbaPosGroup, NbaGroup, zeroCounts
} from '../types/nba';
import { getNbaPlayerPrior, shrinkNbaMarketRate } from '../lib/player_priors';

export { gradeActual };

export const NBA_CONFIG = {
  version: 'nba_v2',
  fit: NBA_FIT as NbaFit,
  /** pseudo-games shrinking each team's allowed-per-game toward the league (fitted: K=10) */
  oppK: NBA_FIT.oppK,
  /** a player with fewer than 20 games last season ('new') needs this many games THIS season before his inputs count as REAL.
   *  Held-out coverage for 'new' players was far off at 0-2 games (actual/expected 0.55-0.65) and on target from 3. */
  minGamesNew: 3,
  edgeMinPts: 5.0,
  maxChalk: -200,
  oneSidedHold: 1.07,
  /** multipliers on the fitted values; 1 = exactly what was fitted */
  rScale: 1,
  oppScale: 1,
  absScale: 1,
  /** ignore absences of players who average fewer minutes than this (the fit used 20) */
  absMinAvg: 20
};

export interface NbaTuning {
  rScale: number; oppScale: number; absScale: number; minGamesNew: number; absMinAvg: number;
}
export const NBA_TUNING_DEFAULTS: NbaTuning = {
  rScale: 1, oppScale: 1, absScale: 1, minGamesNew: NBA_CONFIG.minGamesNew, absMinAvg: NBA_CONFIG.absMinAvg
};
export type NbaTuningStatus = 'fitted x scale' | 'setting';
export const NBA_TUNING_META: Record<keyof NbaTuning, { label: string; status: NbaTuningStatus; min: number; max: number; step: number; help: string }> = {
  rScale: { label: 'Dispersion scale (x fitted r)', status: 'fitted x scale', min: 0.5, max: 2, step: 0.05, help: 'Above 1 = tighter distributions. Fitted r depends on projected minutes and market.' },
  oppScale: { label: 'Opponent factor scale', status: 'fitted x scale', min: 0, max: 2, step: 0.05, help: '0 turns the opponent adjustment off; 1 = fitted pass-through.' },
  absScale: { label: 'Teammate-absence scale', status: 'fitted x scale', min: 0, max: 2, step: 0.05, help: 'Fitted on realized injury DNPs, so the live injury-report version may deserve a value below 1.' },
  minGamesNew: { label: 'Games for REAL (rookies / <20 games last season)', status: 'setting', min: 1, max: 20, step: 1, help: 'Veterans and team changers are REAL from game 0. Held-out checks: rookies were badly miscalibrated at 0-2 games and fine from 3.' },
  absMinAvg: { label: 'Absence min. minutes', status: 'setting', min: 10, max: 32, step: 1, help: 'Only teammates averaging at least this many minutes count as a lost rotation player.' }
};
export function applyNbaTuning(t: Partial<NbaTuning>): void {
  const v = { ...NBA_TUNING_DEFAULTS, ...t };
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  NBA_CONFIG.rScale = Math.min(2, Math.max(0.5, n(v.rScale, 1)));
  NBA_CONFIG.oppScale = Math.min(2, Math.max(0, n(v.oppScale, 1)));
  NBA_CONFIG.absScale = Math.min(2, Math.max(0, n(v.absScale, 1)));
  NBA_CONFIG.minGamesNew = Math.min(20, Math.max(1, Math.round(n(v.minGamesNew, 3))));
  NBA_CONFIG.absMinAvg = Math.min(32, Math.max(10, n(v.absMinAvg, 20)));
}

/* ------------------------------ rates and minutes ------------------------------ */

export function posPrior(pos: NbaPosGroup | string | undefined): { rate: Record<string, number>; min: number } {
  const p = NBA_CONFIG.fit.priors;
  return p[String(pos)] ?? p['_all'];
}

/** Projected minutes with a given blend weight and shrinkage (the model uses market-specific values, see projectNbaPlayer). */
export function projectMinutes(p: Pick<NbaPlayerSnapshot, 'gp' | 'cumMin' | 'priorGp' | 'priorMin' | 'recentMinutes' | 'pos'>, KM: number, W: number): number {
  const priorAvg = p.priorGp > 0 ? p.priorMin / p.priorGp : posPrior(p.pos).min;
  const seasonAvg = (p.cumMin + KM * priorAvg) / (p.gp + KM);
  const rm = p.recentMinutes.slice(-5);
  const l5 = rm.length ? rm.reduce((a, b) => a + b, 0) / rm.length : seasonAvg;
  return W * l5 + (1 - W) * seasonAvg;
}

export function groupOf(p: Pick<NbaPlayerSnapshot, 'priorGp' | 'prevTeam' | 'team'>): NbaGroup {
  if (p.priorGp < 20) return 'new';
  return p.prevTeam && p.prevTeam !== p.team ? 'changer' : 'vet';
}

export function perMinuteRate(p: Pick<NbaPlayerSnapshot, 'cumMin' | 'cum' | 'priorMin' | 'prior' | 'pos'>, market: NbaMarket, group: NbaGroup = 'vet'): number {
  const q = NBA_CONFIG.fit.params[market];
  const pr = posPrior(p.pos).rate[market];
  const priorRate = (p.prior[market] + q.PK * pr) / (p.priorMin + q.PK);
  const K = q.K * q.groups[group].kMult;
  return (p.cum[market] + K * priorRate) / (p.cumMin + K);
}

/** Level adjustment for rookies / team changers that fades over the first 20 games (fitted). */
export function levelFactor(market: NbaMarket, group: NbaGroup, gp: number): number {
  const lvl = NBA_CONFIG.fit.params[market].groups[group].lvl;
  return 1 - (1 - lvl) * Math.max(0, 1 - gp / NBA_CONFIG.fit.lvlDecayGames);
}

export function dispersionR(market: NbaMarket, pm: number, group: NbaGroup = 'vet'): number {
  const q = NBA_CONFIG.fit.params[market];
  return NBA_CONFIG.rScale * q.groups[group].rScale * q.rA * Math.pow(Math.max(pm, 5) / 30, q.rB);
}

/** Five lines around the mean (points step 2, the rest step 1). */
export function linesFor(market: NbaMarket, mu: number): { lines: number[]; defaultLine: number } {
  const step = market === 'pts' || market === 'pra' ? 2 : 1;
  const center = Math.max(0.5, Math.floor(mu) + 0.5);
  const lines: number[] = [];
  for (let i = -2; i <= 2; i++) {
    const l = center + i * step;
    if (l >= 0.5) lines.push(l);
  }
  return { lines, defaultLine: center };
}

export function classifyNbaInputs(p: NbaPlayerSnapshot, live: boolean): InputsSource {
  if (!live) return 'ESTIMATED';
  if (!(p.cumMin + p.priorMin > 0)) return 'ESTIMATED';
  if (groupOf(p) === 'new' && p.gp < NBA_CONFIG.minGamesNew) return 'ESTIMATED';
  return 'REAL';
}

/** Neutral opponent when no live table exists. It is flagged, never invented. */
export function neutralFactors(team: string): NbaTeamFactors {
  return { team, gp: 0, factor: { pts: 1, reb: 1, ast: 1, tpm: 1, pra: 1, stl: 1, blk: 1 }, source: 'none' };
}

/**
 * Walk-forward opponent table from the games already played this season. `games` are team-games (one row per team
 * per game) with that team's totals AND the totals it ALLOWED. Shrunk toward the league with oppK pseudo-games.
 */
export function buildNbaTeamFactors(games: { team: string; allowed: NbaCounts }[]): Record<string, NbaTeamFactors> {
  const lg: NbaCounts = zeroCounts();
  const by = new Map<string, { n: number; sum: NbaCounts }>();
  for (const g of games) {
    const e = by.get(g.team) ?? { n: 0, sum: zeroCounts() };
    e.n++;
    for (const m of NBA_MARKETS) { e.sum[m] += g.allowed[m]; lg[m] += g.allowed[m]; }
    by.set(g.team, e);
  }
  const out: Record<string, NbaTeamFactors> = {};
  if (!games.length) return out;
  for (const [team, e] of by) {
    const factor = {} as NbaCounts;
    for (const m of NBA_MARKETS) {
      const league = lg[m] / games.length;
      factor[m] = league > 0 ? ((e.sum[m] + NBA_CONFIG.oppK * league) / (e.n + NBA_CONFIG.oppK)) / league : 1;
    }
    out[team] = { team, gp: e.n, factor, source: 'live' };
  }
  return out;
}

/** Rotation minutes lost to teammates who are Out / Doubtful, in units of 100 minutes (the fitted feature). */
export function lostRotation(teammates: { name: string; avgMin: number; availability?: AvailabilityStatus }[], selfName: string): number {
  let total = 0;
  for (const t of teammates) {
    if (t.name === selfName) continue;
    if (t.availability !== 'OUT' && t.availability !== 'IR' && t.availability !== 'INACTIVE' && t.availability !== 'DOUBTFUL') continue;
    if (t.avgMin >= NBA_CONFIG.absMinAvg) total += t.avgMin;
  }
  return total / 100;
}

/* ------------------------------------ projection ------------------------------------ */

export function projectNbaPlayer(
  p: NbaPlayerSnapshot,
  opp: string,
  oppFactors: NbaTeamFactors | undefined,
  lost: number,
  opts: { gameId?: string; home?: boolean; live?: boolean } = {}
): NbaPlayerProjection {
  const of = oppFactors ?? neutralFactors(opp);
  // Look up external rate prior (nba_player_rates_prior.csv & current)
  const priorData = p.name ? getNbaPlayerPrior(p.name) : undefined;

  // dispersion uses the points-fit minutes projection for every market (as fitted); each market's mean uses its own
  const q0 = NBA_CONFIG.fit.params.pts;
  const pmR = projectMinutes(p, q0.KM, q0.W);
  const group = groupOf(p);
  const markets = {} as Record<NbaMarket, NbaMarketProjection>;
  for (const m of NBA_MARKETS) {
    const q = NBA_CONFIG.fit.params[m];
    const pm = projectMinutes(p, q.KM, q.W);
    const baseRate = perMinuteRate(p, m, group);

    // External rate prior shrinkage (PTS, REB, AST, FG3M)
    const shrink = shrinkNbaMarketRate(baseRate, m, pm, priorData?.prior, priorData?.current, 20.0);
    const rate = shrink.shrunkRate;
    const mu0 = rate * pm;
    const oppFactor = Math.exp(q.oppCoef * NBA_CONFIG.oppScale * Math.log(Math.max(1e-6, of.factor[m])));
    const absFactor = Math.exp(NBA_CONFIG.absScale * (q.absCoef * lost + q.absSlope * lost * (pmR / 30 - 1)));
    const level = levelFactor(m, group, p.gp);
    const mu = Math.max(0.05, mu0 * oppFactor * absFactor * level);
    const r = dispersionR(m, pmR, group);
    const { lines, defaultLine } = linesFor(m, mu);
    const probs: NbaMarketProjection['probs'] = {};
    for (const l of lines) probs[l] = priceLine(mu, r, l);
    markets[m] = {
      market: m,
      rate,
      pm,
      mu0,
      oppFactor,
      absFactor,
      level,
      mu,
      r,
      lines,
      defaultLine,
      probs,
      priorSource: shrink.source !== 'none' ? shrink.source : undefined,
      priorWeight: shrink.weight > 0 ? shrink.weight : undefined,
      priorRate: shrink.weight > 0 ? shrink.priorPerMin : undefined,
      priorPerGame: shrink.weight > 0 ? shrink.priorPerGame : undefined,
      priorGp: shrink.weight > 0 ? shrink.priorGp : undefined
    };
  }
  const availability = (p.availability ?? 'UNKNOWN') as AvailabilityStatus;
  return {
    playerId: p.playerId, name: p.name, team: p.team, opp, gameId: opts.gameId, home: opts.home, pos: p.pos, group,
    pm: pmR, gp: p.gp, priorGp: p.priorGp, recentMinutes: p.recentMinutes, recentLogs: p.recentLogs, oppSource: of.source, lostRotation: lost, markets,
    availability, availabilityNote: p.availabilityNote,
    inputsSource: p.inputsSource ?? classifyNbaInputs(p, !!opts.live)
  };
}

/* -------------------------------------- decision -------------------------------------- */

export interface NbaDecisionInput {
  pOver: number; pUnder: number; pPush?: number;
  over: number | null | undefined; under: number | null | undefined;
  edgeMinPts?: number; maxChalk?: number;
  availability?: AvailabilityStatus; inputsSource?: InputsSource;
}
export type NbaDecision = NhlDecision;

/** Same gate as every other sport (availability -> input quality -> edge, EV at the offered price). */
export function evaluateNbaMarket(inp: NbaDecisionInput): NbaDecision {
  return evaluateNhlMarket({
    ...inp,
    edgeMinPts: inp.edgeMinPts ?? NBA_CONFIG.edgeMinPts,
    maxChalk: inp.maxChalk ?? NBA_CONFIG.maxChalk,
    hold: NBA_CONFIG.oneSidedHold
  });
}
