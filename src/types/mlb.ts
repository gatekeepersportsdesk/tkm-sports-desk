export interface MlbBatterInput {
  id: number;
  name: string;
  team: string;
  slot: number;
  isHome: boolean;
  hand: string;
  seasonBa: number;
  seasonPa?: number;
  seasonAb?: number;
  xba?: number;
  xbaPa?: number;
  recentBa?: number;
  recentAb?: number;
  bbPct?: number;
  recentReal?: boolean;
  oppSp: string;
  oppHand: string;
  confirmed: boolean;
  availability?: 'ACTIVE' | 'NOT_IN_LINEUP' | 'OUT' | 'UNKNOWN';
  inputsSource?: 'REAL' | 'ESTIMATED' | 'UNKNOWN';
  park: number;
  gamePk: number;
  vsLBa?: number;
  vsLAb?: number;
  vsRBa?: number;
  vsRAb?: number;
  bullpenBaa?: number;
  bullpenAb?: number;
  bullpenFatigue?: number;
  tempF?: number;
}

export interface MlbPitcherInput {
  id?: number;
  name: string;
  hand: string;
  /** 0 = unknown (the engine then falls back to league average and the row is EST) */
  kPct: number;
  kBf?: number;
  recentIp?: number;
}

export interface MlbHitProjection {
  raw?: number;
  calP: number;
  rawP: number;
  ba: number;
  ab: number;
  platoon: 'advantage' | 'disadvantage' | 'neutral';
  k: number;
  ip: number;
  total: number;
  spWeight: number;
  splitReal: boolean;
  inputsReal: boolean;
  /** calibrated P(>=1), P(>=2), P(>=3 hits) from the same PA model */
  pAtLeast?: [number, number, number];
}

export interface MlbGateResult {
  call: 'PLAY' | 'PASS';
  reasons: string[];
  warn: string[];
  why: string[];
  slotOnly: boolean;
  edge: number;
  fair: number;
  stake: string;
  calP: number;
  modelP: number;
  platoon: string;
  quality: string;
  ev?: number | null;
  twoWay?: boolean;
  line?: number;
}

export interface MlbGameMatchup {
  gamePk: number;
  away: string;
  home: string;
  status: string;
  live: boolean;
  inning: number;
  park: number;
  confirmed: boolean;
  awaySp: MlbPitcherInput;
  homeSp: MlbPitcherInput;
  batters: MlbBatterInput[];
  /** MLB gameType (R regular, F/D/L/W postseason rounds) */
  gameType?: string;
  /** local calendar date of the slate */
  date?: string;
  /** why batters is empty (lineup not posted yet, etc.) */
  note?: string;
}

export interface MlbLedgerRow {
  date: string;
  gamePk: number;
  id: number;
  name: string;
  team: string;
  slot: number;
  call: 'PLAY' | 'PASS';
  over: string;
  under: string;
  hold: number;
  dec: number;
  modelP: number;
  fairP: number;
  blendedP: number;
  edge: number;
  quality: string;
  hit: number | null;
  result: string;
  void: boolean;
  /** line the over was priced at (legacy rows: 0.5) */
  line?: number;
  ev?: number | null;
  modelLean?: 'OVER' | 'UNDER';
  predictionHit?: boolean | null;
  analysisReason?: string;
  isPredictionOnly?: boolean;
  /** seeded / simulated rows: shown, never counted in any metric */
  demo?: boolean;
}
