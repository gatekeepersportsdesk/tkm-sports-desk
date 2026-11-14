export interface NflPlayerStats {
  name: string;
  pos: 'WR' | 'TE';
  team: string;
  route_pct: number;
  season_tprr: number;
  prior_tprr: number;
  routes: number;
  targets: number;
  receptions: number;
  games: number;
  season_avg: number;
  ratio: number;
  /** where these inputs came from: live nflverse, the hand-typed seed, or a guess */
  source?: 'nflverse' | 'seed' | 'estimated';
  /** last completed week included in the stats */
  asOfWeek?: number;
  gsis_id?: string;
  /** -ln(1 - lost target share) from teammates the official report lists Out/Doubtful (v1.6) */
  absence_g?: number;
  /** names behind absence_g, for display */
  absence_note?: string;
}

export interface NflGameContext {
  id: string;
  season: number;
  week: number;
  day: 'Thursday' | 'Sunday' | 'Monday' | 'Friday' | 'Saturday' | 'Tuesday' | 'Wednesday';
  kickoff: string;
  /** kickoff as epoch ms (nflverse gameday + gametime, Eastern); null/absent = unknown, never treated as not-started */
  kickoffAt?: number | null;
  away: string;
  home: string;
  spread_home: number;
  implied_total_home: number;
  spread_away: number;
  implied_total_away: number;
  /** false when the schedule has no spread / total yet (do not price off defaults) */
  hasLine?: boolean;
  played?: boolean;
}

export interface NflPropSnapshot {
  id: string;
  season: number;
  week: number;
  book: string;
  kind: 'pre' | 'open' | 'close';
  timestamp: string;
  player: string;
  pos: 'WR' | 'TE';
  team: string;
  gameKey: string;
  line: number;
  overOdds: string;
  underOdds: string;
  mu: number;
  /** multiplier already inside mu from listed teammate absences (1 = none) */
  absenceFactor?: number;
  muStructural: number;
  muAdapted: number;
  dropbacks: number;
  shrunkTprr: number;
  shrunkCatchRate: number;
  seasonAvg: number;
  priorSource?: string;
  priorWeight?: number;
  priorAvg?: number;
  priorGames?: number;
  alpha: number;
  p_over: number;
  p_under: number;
  fair_over: number;
  fair_under: number;
  lean: 'OVER' | 'UNDER';
  edge: number;
  cardStatus: 'BET' | 'PASS' | 'OFF';
  cardReason: string;
  oddsOffered: number;
  /** EV per 1u at the price offered for the recommended side (null when unpriced) */
  ev?: number | null;
  /** false when only one side of the market was entered */
  twoWay?: boolean;
  /** false when no line / odds were entered (row is model-only, never BET) */
  hasMarket?: boolean;
  p_push?: number;
  availability?: 'ACTIVE' | 'QUESTIONABLE' | 'DOUBTFUL' | 'OUT' | 'IR' | 'INACTIVE' | 'SCRATCHED' | 'NOT_IN_LINEUP' | 'UNKNOWN';
  inputsSource?: 'REAL' | 'ESTIMATED' | 'UNKNOWN';
  /** official injury-report detail, when listed */
  availabilityNote?: string;
  /** price was typed in / imported (true) vs model-only baseline row (false) */
  fromUser?: boolean;
  predictionHit?: boolean | null;
  analysisReason?: string;
}

export interface NflBetRecord {
  snapshot_id: string;
  side: 'over' | 'under';
  stake: number;
  odds_taken: number;
  placed_at: string;
}

export interface NflActualRecord {
  played: boolean;
  actual: number;
}
