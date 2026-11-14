/**
 * Gatekeep Sports Desk — shared odds math (single source of truth).
 *
 * Every engine used to carry its own odds parser, and each one silently turned
 * garbage / blank input into "+100". That fabricated a 50% market price, so a
 * missing under price became a fake two-way market. Here, anything we cannot
 * parse returns null and callers must decide what to do about it.
 */

export interface ParsedOdds {
  /** American odds, e.g. -115 or +130 */
  us: number;
  /** Decimal odds, e.g. 1.87 */
  dec: number;
  /** Implied probability INCLUDING the book's vig */
  imp: number;
}

export function americanToImplied(us: number): number {
  return us < 0 ? -us / (-us + 100) : 100 / (us + 100);
}

export function americanToDecimal(us: number): number {
  return us < 0 ? 1 + 100 / -us : 1 + us / 100;
}

export function decimalToAmerican(dec: number): number {
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

export function impliedToAmerican(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p));
  return q >= 0.5 ? -Math.round((q / (1 - q)) * 100) : Math.round(((1 - q) / q) * 100);
}

/**
 * Parse American ("-115", "+130", "−115" with a unicode minus) or decimal
 * ("1.87") odds. Returns null for blank / invalid input.
 *  - |x| >= 100            -> American
 *  - 1.01 <= x < 100, x > 0 -> decimal
 *  - anything else          -> null (never a silent default)
 */
export function parseOdds(input: string | number | null | undefined): ParsedOdds | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[−–—]/g, '-').replace(/^\+/, '');
  if (!raw) return null;
  const o = Number(raw);
  if (!Number.isFinite(o) || o === 0) return null;

  if (Math.abs(o) >= 100) {
    const us = Math.round(o);
    return { us, dec: americanToDecimal(us), imp: americanToImplied(us) };
  }
  if (o >= 1.01) {
    return { us: decimalToAmerican(o), dec: o, imp: 1 / o };
  }
  return null;
}

export interface MarketPrice {
  over: ParsedOdds | null;
  under: ParsedOdds | null;
  /** Vig-free probability of the over / under */
  fairOver: number;
  fairUnder: number;
  /** true when both sides were priced and de-vigged exactly */
  twoWay: boolean;
  /** Sum of both implied probabilities (2-way) or the assumed hold (1-way) */
  hold: number;
}

export const DEFAULT_ONE_SIDED_HOLD = 1.07;

/**
 * De-vig a prop market. With both sides we de-vig exactly; with only one side
 * we divide by an assumed hold and flag the result as not two-way so callers
 * can refuse to qualify a bet on it. Returns null when neither side parses.
 */
export function priceMarket(
  overInput: string | number | null | undefined,
  underInput: string | number | null | undefined,
  oneSidedHold: number = DEFAULT_ONE_SIDED_HOLD
): MarketPrice | null {
  const over = parseOdds(overInput);
  const under = parseOdds(underInput);
  if (!over && !under) return null;

  if (over && under) {
    const hold = over.imp + under.imp;
    const fairOver = over.imp / hold;
    return { over, under, fairOver, fairUnder: 1 - fairOver, twoWay: true, hold };
  }
  if (over) {
    const fairOver = Math.min(0.99, over.imp / oneSidedHold);
    return { over, under: null, fairOver, fairUnder: 1 - fairOver, twoWay: false, hold: oneSidedHold };
  }
  const fairUnder = Math.min(0.99, under!.imp / oneSidedHold);
  return { over: null, under, fairOver: 1 - fairUnder, fairUnder, twoWay: false, hold: oneSidedHold };
}

/** Expected value of a 1-unit bet at the given decimal odds. */
export function expectedValue(p: number, dec: number): number {
  return p * dec - 1;
}

export function fmtAmerican(us: number | null | undefined): string {
  if (us === null || us === undefined || !Number.isFinite(us)) return '—';
  return us > 0 ? `+${us}` : `${us}`;
}

/**
 * Standard edge in probability points (pp) as defined across Gatekeep Sports Desk:
 *   implied_prob = american_to_implied_probability(posted_price_on_chosen_side)
 *   edge_pp = (model_win_prob - implied_prob) * 100
 *
 * Rules:
 * - model_win_prob in [0, 1]
 * - posted_price must be a valid American or decimal price on the chosen side
 * - If no valid price or invalid probability -> returns null
 * - Hard sanity check: If |edge_pp| > 50 on standard player props, treated as invalid (null)
 */
export function calculateEdgePp(
  modelWinProb: number | null | undefined,
  postedOdds: number | string | null | undefined
): number | null {
  if (modelWinProb === null || modelWinProb === undefined || !Number.isFinite(modelWinProb)) return null;
  if (postedOdds === null || postedOdds === undefined || postedOdds === '') return null;
  const parsed = parseOdds(postedOdds);
  if (!parsed) return null;
  const pWin = modelWinProb > 1 && modelWinProb <= 100 ? modelWinProb / 100 : modelWinProb;
  if (pWin < 0 || pWin > 1) return null;

  const impliedProb = parsed.imp; // americanToImplied(parsed.us)
  const edgePp = (pWin - impliedProb) * 100;

  // Sanity check: If |edge_pp| > 50, treat as invalid
  if (Math.abs(edgePp) > 50) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.warn(`[calculateEdgePp] Impossible edge_pp detected: ${edgePp.toFixed(1)}pp (model: ${pWin}, price: ${parsed.us})`);
    }
    return null;
  }

  return edgePp;
}

/**
 * Expected value (EV) of a 1-unit bet at the offered price.
 * Consistent with model_win_prob and decimal payout (p * dec - 1).
 * Returns null if price or probability is missing or invalid.
 */
export function calculateEv(
  modelWinProb: number | null | undefined,
  postedOdds: number | string | null | undefined
): number | null {
  if (modelWinProb === null || modelWinProb === undefined || !Number.isFinite(modelWinProb)) return null;
  if (postedOdds === null || postedOdds === undefined || postedOdds === '') return null;
  const parsed = parseOdds(postedOdds);
  if (!parsed) return null;
  const pWin = modelWinProb > 1 && modelWinProb <= 100 ? modelWinProb / 100 : modelWinProb;
  if (pWin < 0 || pWin > 1) return null;
  return expectedValue(pWin, parsed.dec);
}

