/**
 * Gatekeeper Hit Props — MLB 0.5-Hit Desk (v5.8 Probability Engine)
 * Exact 11-step engine with Bayesian regressions, K% suppression,
 * park factors, game-mix simulation, reference centering, and Gaussian copula.
 */

export const MLB_DEFAULT_TUNE = {
  baseTop3HitRate: 0.673,
  compressionSlope: 0.85,
  calLo: 0.5,
  calHi: 0.8,
  centerOnRound: false,
  lgBa: 0.255,
  seasonPriorPa: 500,
  xbaPriorPa: 120,
  kPriorBf: 150,
  kLeague: 22,
  kCoef: 2.0,
  recentWeight: 0.1,
  recentPriorAb: 120,
  platoonPrior: 0.003,
  splitPriorAb: 300,
  parkDamp: 0.5,
  marketWeight: 0.5,
  marketWeightEst: 0.7,
  edgeMinPts: 1.5,
  oneSidedHold: 1.07,
  ticketEvMin: 6,
  /** ASSUMED book shading of same-game-parlay payouts (applied to profit); a user-quoted price overrides it */
  sgpHaircut: 0.95,
  /** lines above 0.5 hits are priced, but not validated: PASS unless the user opts in */
  allowHigherLines: false,
  whiffFactor: 0.30,
  starterBfPerIp: 4.3,
  bullpenFatigueMax: 0.04,
  gameMix: [
    { m: 0.72, w: 0.25 },
    { m: 1.0,  w: 0.5  },
    { m: 1.28, w: 0.25 }
  ]
};

export const MLB_PARK_FACTORS: Record<string, number> = {
  COL: 1.244, KC: 1.065, BOS: 1.064, ATH: 1.051, OAK: 1.051, MIN: 1.049, ARI: 1.047, AZ: 1.047,
  PIT: 1.039, MIA: 1.035, CIN: 1.031, DET: 1.022, BAL: 1.021, WSH: 1.019, SF: 1.016, ATL: 1.005,
  STL: 1.002, CLE: 0.997, CWS: 0.995, PHI: 0.985, HOU: 0.981, LAA: 0.98, TOR: 0.962, LAD: 0.959,
  TEX: 0.959, SD: 0.942, MIL: 0.937, CHC: 0.936, NYY: 0.935, NYM: 0.932, SEA: 0.842, TB: 0.98
};

export const MLB_SLOT_SHARES: Record<number, number> = {
  1: 0.134, 2: 0.128, 3: 0.122, 4: 0.116, 5: 0.110,
  6: 0.104, 7: 0.098, 8: 0.095, 9: 0.093
};

export const MLB_ROUNDS: Record<string, { muIp: number; baseW: number }> = {
  F: { muIp: 4.71, baseW: 0.487 },
  D: { muIp: 4.29, baseW: 0.439 },
  L: { muIp: 4.31, baseW: 0.441 },
  W: { muIp: 4.99, baseW: 0.518 }
};

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function mlbPlatoonOf(bat?: string, pit?: string): 'advantage' | 'disadvantage' | 'neutral' {
  if (!bat || !pit) return "neutral";
  const p = pit.startsWith("L") ? "L" : pit.startsWith("R") ? "R" : "";
  if (!p) return "neutral";
  if (bat === "S") return "advantage";
  return bat === p ? "disadvantage" : "advantage";
}

export function mlbStarterWeight(ip: number, round?: string): number {
  const meta = round ? MLB_ROUNDS[round] : undefined;
  if (meta) {
    if (!ip || ip <= 0) return meta.baseW;
    const ratio = clamp(ip / meta.muIp, 0.6, 1.25);
    return Math.round(clamp(meta.baseW * ratio, 0.25, 0.6) * 1000) / 1000;
  }
  if (ip > 0) return Math.round(clamp(ip / 9, 0.35, 0.75) * 1000) / 1000;
  return 0.55;
}

export function mlbPaDist(meanPa: number): number[] {
  const p = clamp((meanPa - 2) / 4, 0.05, 0.95);
  const out = new Array(7).fill(0);
  const c = [1, 4, 6, 4, 1];
  for (let j = 0; j <= 4; j++) {
    out[2 + j] = c[j] * Math.pow(p, j) * Math.pow(1 - p, 4 - j);
  }
  return out;
}

export function scoreMlbCore(
  batter: {
    slot: number;
    isHome?: boolean;
    hand?: string;
    seasonBa?: number;
    seasonPa?: number;
    xba?: number;
    xbaPa?: number;
    recentBa?: number;
    recentAb?: number;
    bbPct?: number;
    recentReal?: boolean;
    vsLBa?: number;
    vsLAb?: number;
    vsRBa?: number;
    vsRAb?: number;
    bullpenBaa?: number;
    bullpenAb?: number;
    bullpenFatigue?: number;
    tempF?: number;
  },
  pitcher: {
    hand?: string;
    kPct?: number;
    kBf?: number;
    recentIp?: number;
  },
  park: number = 1.0,
  round?: string,
  teamTotal?: number,
  tune = MLB_DEFAULT_TUNE
) {
  const meta = round ? MLB_ROUNDS[round] : undefined;
  const isPost = Boolean(meta);

  // 1. Season BA Regression
  const seasonRaw = batter.seasonBa ?? tune.lgBa;
  const seasonPa = batter.seasonPa ?? null;
  const season = seasonPa !== null
    ? (seasonPa * seasonRaw + tune.seasonPriorPa * tune.lgBa) / (seasonPa + tune.seasonPriorPa)
    : seasonRaw;

  // 2. xBA blend
  const xbaRaw = batter.xba ?? season;
  const xbaPa = batter.xbaPa ?? null;
  const xba = xbaPa !== null
    ? (xbaPa * xbaRaw + tune.xbaPriorPa * season) / (xbaPa + tune.xbaPriorPa)
    : xbaRaw;

  // 3. Recent form shrinkage
  const recent = batter.recentBa ?? season;
  const recentAb = batter.recentAb ?? 35;
  const shrunkRecent = (recentAb * recent + tune.recentPriorAb * season) / (recentAb + tune.recentPriorAb);

  const base = (1 - tune.recentWeight) * (0.625 * xba + 0.375 * season) + tune.recentWeight * shrunkRecent;

  // 4. Starter K% Suppression
  const k = pitcher.kPct && pitcher.kPct > 0 ? pitcher.kPct : tune.kLeague;
  const ipRaw = pitcher.recentIp && pitcher.recentIp > 0 ? pitcher.recentIp : meta?.muIp || 5.2;
  const ipEff = meta ? 0.5 * ipRaw + 0.5 * meta.muIp : ipRaw;
  const w = mlbStarterWeight(ipRaw, round);
  const kBf = pitcher.kPct && pitcher.kPct > 0 ? (pitcher.kBf ?? 150) : 0;
  const shrunkK = (kBf * k + tune.kPriorBf * tune.kLeague) / (kBf + tune.kPriorBf);
  const kSup = 1 - tune.kCoef * ((shrunkK - tune.kLeague) / 100);

  // 5. Bullpen Factor
  const lgBp = isPost ? 0.226 : 0.238;
  const bpObs = batter.bullpenBaa && batter.bullpenBaa > 0 ? batter.bullpenBaa : null;
  const bpAb = batter.bullpenAb || 0;
  const bpW = bpObs ? bpAb / (bpAb + 1500) : 0;
  const bpRel = bpObs ? bpW * (bpObs / 0.238) + (1 - bpW) : 1;
  const fatigue = clamp(batter.bullpenFatigue ?? 0, 0, 1);
  const bpSup = ((lgBp * bpRel) / 0.244) * (1 + tune.bullpenFatigueMax * fatigue);

  // 6. Platoon match
  const platoon = mlbPlatoonOf(batter.hand, pitcher.hand);
  const prior = platoon === "advantage" ? tune.platoonPrior : platoon === "disadvantage" ? -tune.platoonPrior : 0;
  let bump = prior;
  let splitReal = false;
  const hp = pitcher.hand ? (pitcher.hand.startsWith("L") ? "L" : "R") : "";
  const sBa = hp === "L" ? batter.vsLBa : hp === "R" ? batter.vsRBa : null;
  const sAb = hp === "L" ? batter.vsLAb || 0 : hp === "R" ? batter.vsRAb || 0 : 0;
  if (sBa != null && sAb > 0) {
    const shr = (sAb * sBa + tune.splitPriorAb * season) / (sAb + tune.splitPriorAb);
    bump = 0.5 * prior + 0.5 * clamp(shr - season, -0.03, 0.03);
    splitReal = true;
  }

  // 7. Park and Temperature
  const parkMul = 1 + tune.parkDamp * ((park || 1) - 1);
  const tempAdj = batter.tempF != null ? clamp(((batter.tempF - 70) / 10) * 0.002, -0.006, 0.006) : 0;

  // 8. Opportunity & PA model
  const posted = Number(teamTotal);
  const total = posted >= 1.5 && posted <= 10 ? posted : isPost ? 4 : 4.4;
  const slotN = batter.slot >= 1 && batter.slot <= 9 ? batter.slot : 3;
  let pa = (27 + total * 2.05) * (MLB_SLOT_SHARES[batter.slot] ?? 0.122);
  if (batter.isHome) pa -= 0.14;
  const bb = batter.bbPct && batter.bbPct > 0 && batter.bbPct < 0.35 ? batter.bbPct : 0;
  const share = bb > 0 ? clamp(1 - bb - 0.01 - 0.008, 0.7, 0.95) : isPost ? 0.883 : 0.865;

  // 9. PA by PA Simulation
  const tto = [0.985, 1.01, 1.04, 1.04, 1.04, 1.04];
  const bfExp = ipEff * tune.starterBfPerIp;
  const dist = mlbPaDist(pa);
  const hitR: number[] = [];
  const pS: number[] = [];
  for (let r = 1; r <= 6; r++) {
    const pos = (r - 1) * 9 + slotN;
    const ps = 1 / (1 + Math.exp(-(bfExp - pos + 0.5) / 1.6));
    const baS = base * kSup * tto[r - 1] + bump;
    const baB = base * bpSup + bump;
    const ba = clamp((ps * baS + (1 - ps) * baB + tempAdj) * parkMul, 0.05, 0.55);
    pS.push(ps);
    hitR.push(ba * share);
  }

  let raw = 0;
  for (const mix of tune.gameMix) {
    let noHit = 1;
    for (let n = 1; n <= 6; n++) {
      noHit *= 1 - clamp(hitR[n - 1] * mix.m, 0, 0.7);
      raw += mix.w * dist[n] * (1 - noHit);
    }
  }

  const nShow = Math.max(1, Math.round(pa));
  const avgBa = hitR.slice(0, nShow).reduce((s, x) => s + x, 0) / nShow / share;

  return {
    raw,
    ba: Math.round(avgBa * 1000) / 1000,
    ab: Math.round(pa * share * 100) / 100,
    platoon,
    k,
    ip: Math.round(ipRaw * 100) / 100,
    total,
    spWeight: w,
    splitReal,
    inputsReal: Boolean(
      pitcher.kPct && pitcher.recentIp && batter.recentReal && batter.hand && pitcher.hand &&
      batter.seasonPa != null && batter.seasonPa > 0
    ),
    // per-PA hit probabilities by turn through the order, PA-count distribution, game-mix
    hitR,
    paDist: dist,
    gameMix: tune.gameMix
  };
}

/* -------------------------------------------------------------------------- */
/* Hit-count distribution (Poisson-binomial over the PA model)                */
/* -------------------------------------------------------------------------- */

/** P(at least k hits) under the engine's PA model, with per-PA hit rates scaled by `scale`. */
export function mlbProbAtLeast(
  core: { hitR: number[]; paDist: number[]; gameMix: { m: number; w: number }[] },
  k: number,
  scale = 1
): number {
  if (k <= 0) return 1;
  let total = 0;
  for (const mix of core.gameMix) {
    // dp[h] = P(exactly h hits so far), truncated at k (k means >= k)
    let dp = new Array(k + 1).fill(0);
    dp[0] = 1;
    for (let n = 1; n <= 6; n++) {
      const q = clamp(core.hitR[n - 1] * mix.m * scale, 0, 0.7);
      const nx = new Array(k + 1).fill(0);
      for (let h = 0; h <= k; h++) {
        if (dp[h] === 0) continue;
        nx[Math.min(k, h + 1)] += dp[h] * q;
        nx[h] += dp[h] * (1 - q);
      }
      dp = nx;
      total += mix.w * core.paDist[n] * dp[k];
    }
  }
  return total;
}

/**
 * The desk's calibration maps raw P(>=1 hit) onto a target (calP). Scaling the
 * per-PA hit rate until P(>=1) equals that target carries the calibration through
 * to P(>=2), P(>=3) coherently (no Poisson shortcut).
 */
export function mlbScaleToTarget(
  core: { hitR: number[]; paDist: number[]; gameMix: { m: number; w: number }[] },
  target: number
): number {
  let lo = 0.3, hi = 2.2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (mlbProbAtLeast(core, 1, mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const refCache = new Map<string, number>();

/** every tune field that influences scoreMlbCore (the cache must see tune changes) */
function tuneKey(t: typeof MLB_DEFAULT_TUNE): string {
  return JSON.stringify([
    t.lgBa, t.seasonPriorPa, t.xbaPriorPa, t.kPriorBf, t.kLeague, t.kCoef, t.recentWeight, t.recentPriorAb,
    t.platoonPrior, t.splitPriorAb, t.parkDamp, t.whiffFactor, t.starterBfPerIp, t.bullpenFatigueMax, t.gameMix
  ]);
}

export function getMlbRefRaw(round?: string, tune = MLB_DEFAULT_TUNE): number {
  const useRound = tune.centerOnRound ? round : undefined;
  const key = `${useRound || "R"}|${tuneKey(tune)}`;
  if (refCache.has(key)) return refCache.get(key)!;
  const meta = useRound ? MLB_ROUNDS[useRound] : undefined;
  const r = scoreMlbCore(
    {
      slot: 2, isHome: false, hand: "", seasonBa: tune.lgBa, seasonPa: 600, xba: tune.lgBa, xbaPa: 600,
      recentBa: tune.lgBa, recentAb: 40, bbPct: 0.085, recentReal: true
    },
    { hand: "", kPct: tune.kLeague, kBf: 600, recentIp: meta?.muIp || 5.2 },
    1,
    useRound,
    undefined,
    tune
  ).raw;
  refCache.set(key, r);
  return r;
}

export function scoreMlbHit(
  batter: any,
  pitcher: any,
  park: number = 1.0,
  round?: string,
  teamTotal?: number,
  tune = MLB_DEFAULT_TUNE
) {
  const core = scoreMlbCore(batter, pitcher, park, round, teamTotal, tune);
  const { raw, hitR, paDist, gameMix, ...rest } = core;
  const cal = clamp(
    tune.baseTop3HitRate + (raw - getMlbRefRaw(round, tune)) * tune.compressionSlope,
    tune.calLo,
    tune.calHi
  );
  const scale = mlbScaleToTarget({ hitR, paDist, gameMix }, cal);
  const at = (k: number) => Math.round(clamp(mlbProbAtLeast({ hitR, paDist, gameMix }, k, scale), 0, 1) * 10000) / 10000;
  return {
    ...rest,
    raw: Math.round(raw * 10000) / 10000,
    calP: Math.round(cal * 10000) / 10000,
    rawP: Math.round(raw * 10000) / 10000,
    /** calibrated P(>=1), P(>=2), P(>=3 hits) from one coherent PA model */
    pAtLeast: [at(1), at(2), at(3)] as [number, number, number]
  };
}

export function parseAmericanOdds(val: string | number | null | undefined) {
  if (val === null || val === undefined) return null;
  const clean = String(val).trim().replace(/[−–—]/g, "-").replace(/^\+/, "");
  const num = parseFloat(clean);
  if (!Number.isFinite(num) || num === 0) return null;
  if (num > 1.01 && num < 20 && !clean.startsWith("-")) {
    const imp = 1 / num;
    const us = imp >= 0.5 ? -Math.round((imp / (1 - imp)) * 100) : Math.round(((1 - imp) / imp) * 100);
    return { o: us, dec: num, imp };
  }
  const dec = num < 0 ? 1 + 100 / -num : 1 + num / 100;
  const imp = num < 0 ? -num / (-num + 100) : 100 / (num + 100);
  return { o: Math.round(num), dec, imp };
}

export function devigMlb(over: string | number, under?: string | number, hold: number = 1.07) {
  const ov = parseAmericanOdds(over);
  if (!ov) return null;
  const un = under ? parseAmericanOdds(under) : null;
  const fair = un ? ov.imp / (ov.imp + un.imp) : ov.imp / hold;
  return { fair, dec: ov.dec, o: ov.o, twoWay: Boolean(un) };
}

/** hits needed to cash an Over on a half-point line (0.5 -> 1, 1.5 -> 2, 2.5 -> 3). */
export function hitsNeeded(line: number): number | null {
  if (!Number.isFinite(line) || line < 0.5) return null;
  return Number.isInteger(line) ? null : Math.floor(line) + 1;
}

export type MlbAvailability = 'ACTIVE' | 'NOT_IN_LINEUP' | 'OUT' | 'UNKNOWN';

export function gateMlbRow(opts: {
  confirmed: boolean;
  slot: number;
  live?: boolean;
  inning?: number;
  line?: number;
  over?: string | number;
  under?: string | number;
  hold?: number;
  round?: string;
  /** official lineup status; a batter who is not in the posted lineup cannot qualify */
  availability?: MlbAvailability;
  hit: { calP: number; inputsReal: boolean; platoon: string; pAtLeast?: [number, number, number] };
  tune?: typeof MLB_DEFAULT_TUNE;
}) {
  const tune = opts.tune || MLB_DEFAULT_TUNE;
  const targetLine = opts.line !== undefined ? opts.line : 0.5;
  const need = hitsNeeded(targetLine);
  // P(over line) comes from the same PA model that produced calP (no Poisson shortcut)
  const lineAdjustedModelP =
    need === null ? NaN
    : need === 1 ? opts.hit.calP
    : need <= 3 && opts.hit.pAtLeast ? opts.hit.pAtLeast[need - 1]
    : NaN;
  const isPost = Boolean(opts.round && MLB_ROUNDS[opts.round]);
  const ceiling = isPost ? -180 : -220;
  const hold = opts.hold ?? tune.oneSidedHold;
  const priced = opts.over && Number.isFinite(lineAdjustedModelP) ? devigMlb(opts.over, opts.under, hold) : null;
  const reasons: string[] = [];
  const availability = opts.availability ?? 'ACTIVE';

  if (!opts.confirmed) reasons.push("NOT_CONFIRMED");
  if (availability === 'OUT' || availability === 'NOT_IN_LINEUP') reasons.push("UNAVAILABLE");
  if (opts.slot < 1 || opts.slot > 3) reasons.push("SLOT");
  if (!Number.isFinite(lineAdjustedModelP)) reasons.push("LINE");
  else if (need !== null && need > 1 && !tune.allowHigherLines) reasons.push("LINE_UNVALIDATED");
  if (!priced) reasons.push("NO_PRICE");
  else if (need === 1 && !(priced.o <= -140 && priced.o >= ceiling)) reasons.push("JUICE");

  const quality = opts.hit.inputsReal ? "REAL" : "EST";
  if (quality === "EST") reasons.push("EST_INPUTS"); // universal gate: estimated inputs never qualify
  const mw = quality === "REAL" ? tune.marketWeight : tune.marketWeightEst;
  const modelP = Number.isFinite(lineAdjustedModelP) ? lineAdjustedModelP : 0;
  const finalP = priced ? mw * priced.fair + (1 - mw) * modelP : modelP;
  const edge = priced ? (finalP - priced.fair) * 100 : 0;
  // EV at the price actually offered: an edge over the de-vigged line is not +EV once vig is paid
  const ev = priced ? finalP * priced.dec - 1 : null;
  if (priced && edge < tune.edgeMinPts) reasons.push("EDGE");
  if (priced && ev !== null && ev <= 0 && !reasons.includes("EDGE")) reasons.push("EV");

  const play = reasons.length === 0;
  const b = priced ? priced.dec - 1 : 0;
  const f = b > 0 ? Math.max(0, (b * finalP - (1 - finalP)) / b) : 0;
  const q = Math.min(1.5, Math.round(0.25 * f * 100 * 100) / 100);

  const warn: string[] = [];
  if (opts.live) {
    const n = opts.inning || 0;
    warn.push(n >= 2 ? `Game in inning ${n}. 1-3 hitter likely batted already.` : "First pitch is in.");
  }
  if (priced && !priced.twoWay) {
    warn.push(`1-sided price only. Assumed ${((hold - 1) * 100).toFixed(1)}% hold.`);
  }
  if (priced && Math.abs(modelP - priced.fair) > 0.08) {
    warn.push(`Model says ${(modelP * 100).toFixed(0)}%, book fair implies ${(priced.fair * 100).toFixed(0)}%.`);
  }

  const why: string[] = [];
  const slotOnly = reasons.length === 1 && reasons[0] === "SLOT";
  if (play) {
    why.push("Confirmed in the 1-3 hole with real inputs.");
    why.push(`Price inside juice window (${opts.over}).`);
    why.push(`Edge is +${edge.toFixed(1)} pts after market blend; EV ${(ev! * 100).toFixed(1)}% at the offered price.`);
  } else {
    if (slotOnly) why.push(`Would have been a play. Only miss is slot ${opts.slot} (desk plays 1-3).`);
    if (reasons.includes("NOT_CONFIRMED")) why.push("Lineup not yet officially confirmed by MLB.");
    if (reasons.includes("UNAVAILABLE")) why.push(`Not in the posted lineup (${availability}).`);
    if (reasons.includes("SLOT") && !slotOnly) why.push(`Slot ${opts.slot}. Only 1-3 eligible.`);
    if (reasons.includes("NO_PRICE")) why.push("No odds entered on this row.");
    if (reasons.includes("LINE")) why.push("Only x.5 lines up to 2.5 hits are priced.");
    if (reasons.includes("LINE_UNVALIDATED")) why.push(`Lines above 0.5 are priced but not validated yet — enable in Settings once the ledger supports it.`);
    if (reasons.includes("JUICE")) why.push(`Odds ${opts.over || 'none'} outside playable juice window [-140 to ${ceiling}].`);
    if (reasons.includes("EST_INPUTS")) why.push("Estimated inputs (live stats missing) — cannot qualify.");
    if (reasons.includes("EDGE")) why.push(`Edge +${edge.toFixed(1)} pts is under the ${tune.edgeMinPts} pts minimum.`);
    if (reasons.includes("EV")) why.push(`EV ${ev !== null ? (ev * 100).toFixed(1) : '—'}% at the offered price — the edge does not survive the vig.`);
  }

  return {
    call: play ? ("PLAY" as const) : ("PASS" as const),
    reasons,
    warn,
    why,
    slotOnly,
    edge: Math.round(edge * 100) / 100,
    ev: ev === null ? null : Math.round(ev * 10000) / 10000,
    fair: priced?.fair ?? 0,
    twoWay: priced?.twoWay ?? false,
    stake: play ? `${q}u` : "0u",
    calP: Math.round(finalP * 10000) / 10000,
    modelP: Math.round(modelP * 10000) / 10000,
    line: targetLine,
    platoon: opts.hit.platoon,
    quality
  };
}

// Monte Carlo Parlay Simulator with Gaussian copula
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp((-x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function zFor(p: number): number {
  let lo = -6, hi = 6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (phi(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** small deterministic RNG so a ticket always prices the same way */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simMlbCard(
  legs: { name: string; team: string; p: number; game?: number | string }[],
  draws = 6000,
  seed = 20260101
) {
  if (!legs || legs.length < 2) return null;
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, 1 - rnd()))) * Math.cos(2 * Math.PI * rnd());
  const GAME_FACTOR = 0.03;
  const TEAM_FACTOR = 0.07;
  const same = legs.every((l, i) => i === 0 || String(l.game ?? l.team) === String(legs[0].game ?? legs[0].team));
  const thresholds = legs.map((l) => zFor(clamp(l.p, 0.001, 0.999)));
  let wins = 0;
  for (let i = 0; i < draws; i++) {
    const gameZ = new Map<string, number>();
    const teamZ = new Map<string, number>();
    let ok = true;
    for (let j = 0; j < legs.length && ok; j++) {
      const leg = legs[j];
      const gk = String(leg.game || leg.team);
      if (!gameZ.has(gk)) gameZ.set(gk, gauss());
      if (!teamZ.has(leg.team)) teamZ.set(leg.team, gauss());
      const x =
        Math.sqrt(GAME_FACTOR) * gameZ.get(gk)! +
        Math.sqrt(TEAM_FACTOR) * teamZ.get(leg.team)! +
        Math.sqrt(1 - GAME_FACTOR - TEAM_FACTOR) * gauss();
      if (x >= thresholds[j]) ok = false;
    }
    if (ok) wins++;
  }
  const indep = legs.reduce((acc, l) => acc * l.p, 1);
  const sim = wins / draws;
  // Monte Carlo standard error, so a +0.4pt "lift" isn't read as signal
  const se = Math.sqrt(Math.max(sim * (1 - sim), 1e-9) / draws);
  return { sim, indep, lift: sim - indep, same, se };
}

/**
 * EV per 1u of a parlay: simulated win probability against a decimal price.
 * `price` is whatever is actually being offered (the book's quoted parlay price,
 * or the straight product of the legs). A same-game ticket shaded by `shading`
 * (1 = no shading) reduces the *profit* part of the payout.
 */
export function parlayEv(pWin: number, decimalPrice: number, shading = 1): number {
  const dec = 1 + (decimalPrice - 1) * shading;
  return pWin * dec - 1;
}
