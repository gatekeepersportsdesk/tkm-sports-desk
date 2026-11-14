import { AvailabilityStatus, InputsSource } from '../lib/availability';
import { LineProbs } from '../model/dist';
import type { CardRow } from '../lib/card_core';

export type NbaMarket = 'pts' | 'reb' | 'ast' | 'tpm' | 'pra' | 'stl' | 'blk';
export const NBA_MARKETS: NbaMarket[] = ['pts', 'reb', 'ast', 'tpm', 'pra', 'stl', 'blk'];
export const NBA_MARKET_LABEL: Record<NbaMarket, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', tpm: '3-Pointers', pra: 'Pts+Reb+Ast', stl: 'Steals', blk: 'Blocks' };
export const NBA_MARKET_UNIT: Record<NbaMarket, string> = { pts: 'PTS', reb: 'REB', ast: 'AST', tpm: '3PM', pra: 'PRA', stl: 'STL', blk: 'BLK' };
export const zeroCounts = (): NbaCounts => ({ pts: 0, reb: 0, ast: 0, tpm: 0, pra: 0, stl: 0, blk: 0 });
/** vet = 20+ games last season on the same team; changer = 20+ last season, different team; new = fewer than 20 games last season (rookies, returners) */
export type NbaGroup = 'vet' | 'changer' | 'new';
export type NbaPosGroup = 'G' | 'F' | 'C';
export type NbaCounts = Record<NbaMarket, number>;

/** What the model knows about one player BEFORE the game. All totals are over games he actually played (DNP is never a zero). */
export interface NbaPlayerSnapshot {
  playerId: number;
  name: string;
  team: string;
  pos: NbaPosGroup;
  /** team at the end of last season (undefined = no prior-season games) */
  prevTeam?: string;
  /** games played this season / minutes and totals in them */
  gp: number;
  cumMin: number;
  cum: NbaCounts;
  /** last season */
  priorGp: number;
  priorMin: number;
  prior: NbaCounts;
  /** minutes in his most recent games (oldest first, up to 5) */
  recentMinutes: number[];
  /** full counts in his most recent games (up to 10) */
  recentLogs?: Array<{ date: string; minutes: number; counts: NbaCounts }>;
  availability?: AvailabilityStatus;
  inputsSource?: InputsSource;
  /** why he is listed unavailable (injury report text) */
  availabilityNote?: string;
}

/** Walk-forward opponent table: how much each team ALLOWS per game relative to the league (ratio, shrunk). 1 = average. */
export interface NbaTeamFactors {
  team: string;
  gp: number;
  /** allowed-per-game / league average, shrunk toward 1 with oppK pseudo-games */
  factor: NbaCounts;
  source: 'live' | 'none';
}

export interface NbaMarketProjection {
  market: NbaMarket;
  /** shrunk per-minute rate */
  rate: number;
  /** projected minutes */
  pm: number;
  /** rate * pm, before opponent / absence adjustments */
  mu0: number;
  oppFactor: number;
  absFactor: number;
  /** rookie / team-changer level adjustment (1 for veterans) */
  level: number;
  mu: number;
  r: number;
  lines: number[];
  defaultLine: number;
  probs: Record<number, LineProbs>;
  priorSource?: string;
  priorWeight?: number;
  priorRate?: number;
  priorPerGame?: number;
  priorGp?: number;
}

export interface NbaPlayerProjection {
  playerId: number;
  name: string;
  team: string;
  opp: string;
  gameId?: string;
  home?: boolean;
  pos: NbaPosGroup;
  group: NbaGroup;
  pm: number;
  gp: number;
  priorGp: number;
  recentMinutes: number[];
  recentLogs?: { date: string; minutes: number; counts: NbaCounts }[];
  oppSource: NbaTeamFactors['source'];
  /** rotation minutes lost to Out/Doubtful teammates, in units of 100 minutes */
  lostRotation: number;
  markets: Record<NbaMarket, NbaMarketProjection>;
  availability: AvailabilityStatus;
  availabilityNote?: string;
  inputsSource: InputsSource;
}

export interface NbaOddsEntry {
  over?: number | null;
  under?: number | null;
}
export const nbaOddsKey = (market: NbaMarket, playerId: number, line: number) => `${market}|${playerId}|${line}`;

export interface NbaLedgerRow {
  id: string;
  date: string;
  gameId: string;
  market: NbaMarket;
  playerId: number;
  playerName: string;
  team: string;
  opp: string;
  line: number;
  modelMu: number;
  r: number;
  probOver: number;
  overOdds: number | null;
  underOdds: number | null;
  pMarketOver: number | null;
  tag: 'STAB' | 'FADE' | 'PASS';
  side: 'over' | 'under' | null;
  edge: number;
  ev: number | null;
  inputsSource: InputsSource;
  availability: AvailabilityStatus;
  actual: number | null;
  result: 'OVER' | 'UNDER' | 'PUSH' | 'VOID' | null;
  voidReason?: string;
}

export interface NbaSettings {
  edgeThreshold: number;
  maxJuice: number;
  showStabsOnly: boolean;
}

/** One real box-score line, used for grading. */
export interface NbaBoxLine {
  gameId: string;
  date: string;
  playerId: number;
  name?: string;
  minutes: number;
  dnp: boolean;
  actual: NbaCounts;
}

/**
 * One row of the AUTO-LOGGED daily card: what the model projected for a player-market BEFORE the game, at the model's own
 * preferred (median-ish) line. No price is needed or implied; this measures whether the projections are any good.
 */
export interface NbaPrediction extends CardRow {
  market: NbaMarket;
  playerId: number;
  r: number;
  pm: number;
  /** per-minute rate and the multipliers applied (shown in the drawer, kept for diagnosis) */
  rate: number;
  oppF: number;
  absF: number;
  lvl: number;
}
