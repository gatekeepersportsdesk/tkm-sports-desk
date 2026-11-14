import { AvailabilityStatus, InputsSource } from '../lib/availability';
import { LineProbs } from '../model/dist';

export type NhlMarket = 'sog' | 'pts';

/**
 * Raw season counts for one skater. Rates are derived (and shrunk) inside the
 * engine so the same code path serves live data, the offline seed and tests.
 */
export interface NhlPlayerSnapshot {
  playerId: number;
  name: string;
  team: string;
  pos: 'F' | 'D';
  toiAvg: number;
  /** current season */
  gp: number;
  shots: number;
  /** null when the feed had no points (seed players): the points market stays off */
  points: number | null;
  /** previous season (null / 0 gp when unavailable, e.g. rookies) */
  priorGp?: number;
  priorShots?: number;
  priorPoints?: number | null;
  /** last games, most recent first, from the real game log */
  recentShots: number[];
  recentPoints: number[];
  availability?: AvailabilityStatus;
  inputsSource?: InputsSource;
}

export interface NhlTeamFactors {
  /** opponent shots-allowed ratio vs league, already shrunk by games played */
  sog: number;
  /** opponent goals-allowed ratio vs league, already shrunk by games played */
  pts: number;
  source: 'live' | 'static' | 'none';
}

export interface NhlMarketProjection {
  market: NhlMarket;
  /** shrunk per-game rate before the opponent adjustment */
  mu0: number;
  /** effective sample behind mu0 (games, current + prior weighted) */
  nEff: number;
  oppFactor: number;
  contextFactor?: number;
  contextAdjustments?: Array<{ label: string; impactPct: number }>;
  mu: number;
  r: number;
  lines: number[];
  defaultLine: number;
  /** keyed by line */
  probs: Record<number, LineProbs>;
}

export interface NhlSkaterProjection {
  playerId: number;
  name: string;
  team: string;
  opp: string;
  gameId?: number;
  pos: 'F' | 'D';
  toiAvg: number;
  recentShots: number[];
  recentPoints: number[];
  oppSource: NhlTeamFactors['source'];
  contextAdjustments?: Array<{ label: string; impactPct: number }>;
  contextFactor?: number;
  sog: NhlMarketProjection;
  /** null when the player has no points data */
  pts: NhlMarketProjection | null;
  availability: AvailabilityStatus;
  inputsSource: InputsSource;
}

export interface NhlGameMatchup {
  gameId: number;
  startTimeUtc: string;
  awayTeam: string;
  homeTeam: string;
  venue: string;
}

/** Prices for one market line. Either side may be missing. */
export interface NhlOddsEntry {
  over?: number | null;
  under?: number | null;
}

/** key: `${market}:${playerId}:${line}` */
export type NhlOddsMap = Record<string, NhlOddsEntry>;

export const nhlOddsKey = (market: NhlMarket, playerId: number, line: number) =>
  `${market}:${playerId}:${line}`;

/**
 * One logged prop. Rows are snapshotted BEFORE the game with the model
 * probability and market price, and graded later from the official box score.
 * Nothing is simulated.
 */
export interface NhlLedgerRow {
  id: string;
  date: string;
  gameId: number;
  market: NhlMarket;
  playerId: number;
  playerName: string;
  team: string;
  opp: string;
  line: number;
  modelMu: number;
  r: number;
  /** P(over) conditional on no push */
  probOver: number;
  overOdds: number | null;
  underOdds: number | null;
  /** de-vigged market P(over), null when unpriced */
  pMarketOver: number | null;
  tag: 'STAB' | 'FADE' | 'PASS';
  side: 'over' | 'under' | null;
  edge: number;
  ev: number | null;
  inputsSource: InputsSource;
  availability: AvailabilityStatus;
  /** filled by grading */
  actual: number | null;
  result: 'OVER' | 'UNDER' | 'PUSH' | 'VOID' | null;
  voidReason?: string;
  modelLean?: 'OVER' | 'UNDER';
  predictionHit?: boolean | null;
  analysisReason?: string;
  timeOnIce?: string | null;
  isPredictionOnly?: boolean;
  /** rows created by older versions (random simulator) — never counted */
  demo?: boolean;
}

export interface NhlSettings {
  edgeThreshold: number;
  maxJuice: number;
  showStabsOnly: boolean;
}
