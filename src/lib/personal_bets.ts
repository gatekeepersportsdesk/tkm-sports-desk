/**
 * Personal Bet Log Engine & Storage
 *
 * Tracks user-placed wagers independently of the automated model daily card.
 * Handles American odds payout calculations, net P&L in units/currency,
 * CSV & JSON imports/exports, and automatic grading against official box score card rows.
 */

import { CardRow } from './card_core';

export type BetSport = 'nba' | 'nhl' | 'nfl' | 'mlb';
export type BetSide = 'OVER' | 'UNDER';
export type BetResult = 'HIT' | 'MISS' | 'PUSH' | 'VOID' | 'PENDING';

export interface PersonalBet {
  id: string;
  date: string; // YYYY-MM-DD
  sport: BetSport;
  player: string;
  team?: string;
  opp?: string;
  market: string; // e.g. 'points', 'rebounds', 'assists', 'receptions', 'shots', 'hits'
  side: BetSide;
  line: number;
  odds: number; // American odds integer e.g. -110, +135
  stake: number; // in units (e.g. 1.0)
  pnl?: number | null; // net units profit/loss once settled: +profit on hit, -stake on miss, 0 on push/void
  result: BetResult;
  actual?: number | null; // actual stat outcome if known
  notes?: string;
  source?: 'manual' | 'desk_action' | 'import_csv' | 'import_json';
  createdAt: number;
  gradedAt?: number | null;
}

export interface PersonalBetsSummary {
  totalBets: number;
  settledBets: number;
  pendingBets: number;
  hits: number;
  misses: number;
  pushes: number;
  voids: number;
  winRate: number; // hits / (hits + misses) * 100 (0-100), ignores pushes & voids
  totalStaked: number; // total units risked on all bets
  settledStaked: number; // units risked on settled bets
  netUnits: number; // total profit / loss in units
  roi: number; // netUnits / settledStaked * 100 (%)
}

export const PERSONAL_BETS_STORAGE_KEY = 'gatekeep_personal_bets_v1';

/**
 * Calculates net profit multiplier per 1 unit staked based on American Odds.
 * e.g. +150 -> 1.50 profit
 * e.g. -110 -> 0.909 profit (100 / 110)
 * e.g. -150 -> 0.667 profit
 */
export function calcAmericanProfitMultiplier(odds: number): number {
  if (odds === 0 || !Number.isFinite(odds)) return 1.0;
  if (odds > 0) {
    return odds / 100;
  }
  return 100 / Math.abs(odds);
}

/**
 * Calculates net P&L (in units) for a given bet.
 * Returns null if the bet is still PENDING.
 */
export function calcBetPnl(bet: Pick<PersonalBet, 'result' | 'odds' | 'stake'>): number | null {
  const stake = Number.isFinite(bet.stake) && bet.stake > 0 ? bet.stake : 1.0;
  const odds = Number.isFinite(bet.odds) && bet.odds !== 0 ? bet.odds : -110;

  switch (bet.result) {
    case 'HIT': {
      const mult = calcAmericanProfitMultiplier(odds);
      return Math.round(stake * mult * 1000) / 1000;
    }
    case 'MISS': {
      return -Math.round(stake * 1000) / 1000;
    }
    case 'PUSH':
    case 'VOID': {
      return 0;
    }
    case 'PENDING':
    default:
      return null;
  }
}

/**
 * Calculates running totals, win rate, and ROI across a collection of bets.
 */
export function summarizePersonalBets(bets: PersonalBet[]): PersonalBetsSummary {
  let totalBets = bets.length;
  let settledBets = 0;
  let pendingBets = 0;
  let hits = 0;
  let misses = 0;
  let pushes = 0;
  let voids = 0;
  let totalStaked = 0;
  let settledStaked = 0;
  let netUnits = 0;

  for (const b of bets) {
    const stake = Number.isFinite(b.stake) && b.stake > 0 ? b.stake : 1.0;
    totalStaked += stake;

    if (b.result === 'PENDING') {
      pendingBets++;
    } else {
      settledBets++;
      settledStaked += stake;
      if (b.result === 'HIT') hits++;
      else if (b.result === 'MISS') misses++;
      else if (b.result === 'PUSH') pushes++;
      else if (b.result === 'VOID') voids++;

      const pnl = b.pnl ?? calcBetPnl(b);
      if (pnl !== null) {
        netUnits += pnl;
      }
    }
  }

  const decided = hits + misses;
  const winRate = decided > 0 ? (hits / decided) * 100 : 0;
  const roi = settledStaked > 0 ? (netUnits / settledStaked) * 100 : 0;

  return {
    totalBets,
    settledBets,
    pendingBets,
    hits,
    misses,
    pushes,
    voids,
    winRate: Math.round(winRate * 10) / 10,
    totalStaked: Math.round(totalStaked * 100) / 100,
    settledStaked: Math.round(settledStaked * 100) / 100,
    netUnits: Math.round(netUnits * 100) / 100,
    roi: Math.round(roi * 10) / 10
  };
}

/**
 * Loads saved personal bets from localStorage.
 */
export function loadPersonalBets(): PersonalBet[] {
  try {
    const raw = localStorage.getItem(PERSONAL_BETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(b => ({
        ...b,
        pnl: b.pnl !== undefined ? b.pnl : calcBetPnl(b)
      }));
    }
  } catch { /* ignore corrupted */ }
  return [];
}

/**
 * Saves personal bets to localStorage.
 */
export function savePersonalBets(bets: PersonalBet[]): void {
  try {
    localStorage.setItem(PERSONAL_BETS_STORAGE_KEY, JSON.stringify(bets));
  } catch (e) {
    console.error('Failed to save personal bets to localStorage', e);
  }
}

/**
 * Creates a new personal bet object with defaults and calculated fields.
 */
export function createPersonalBet(draft: Partial<PersonalBet>): PersonalBet {
  const id = draft.id || `pb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const date = draft.date || new Date().toISOString().split('T')[0];
  const sport = (draft.sport || 'nba') as BetSport;
  const player = (draft.player || '').trim();
  const market = (draft.market || 'points').trim().toLowerCase();
  const side = draft.side === 'UNDER' ? 'UNDER' : 'OVER';
  const line = Number.isFinite(draft.line) ? Number(draft.line) : 0.5;
  const odds = Number.isFinite(draft.odds) && draft.odds !== 0 ? Number(draft.odds) : -110;
  const stake = Number.isFinite(draft.stake) && (draft.stake as number) > 0 ? Number(draft.stake) : 1.0;
  const result: BetResult = draft.result || 'PENDING';
  const notes = draft.notes || '';
  const actual = draft.actual !== undefined ? draft.actual : null;

  const bet: PersonalBet = {
    id,
    date,
    sport,
    player,
    team: draft.team || '',
    opp: draft.opp || '',
    market,
    side,
    line,
    odds,
    stake,
    result,
    actual,
    notes,
    source: draft.source || 'manual',
    createdAt: draft.createdAt || Date.now(),
    gradedAt: draft.gradedAt || (result !== 'PENDING' ? Date.now() : null),
    pnl: draft.pnl !== undefined ? draft.pnl : null
  };

  bet.pnl = calcBetPnl(bet);
  return bet;
}

/**
 * Normalizes player name for reliable cross-dataset matching.
 * e.g. "Luka Dončić" -> "luka doncic", "P.J. Washington" -> "pj washington"
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+(jr|sr|ii|iii|iv)$/, '')
    .trim();
}

/**
 * Normalizes market string across sports.
 */
export function normalizeMarket(market: string): string {
  const m = market.toLowerCase().trim();
  if (m === 'pts' || m === 'points') return 'points';
  if (m === 'reb' || m === 'rebounds') return 'rebounds';
  if (m === 'ast' || m === 'assists') return 'assists';
  if (m === '3pm' || m === 'threes' || m === 'three_points') return 'threes';
  if (m === 'pra' || m === 'pts+reb+ast') return 'pra';
  if (m === 'stl' || m === 'steals') return 'steals';
  if (m === 'blk' || m === 'blocks') return 'blocks';
  if (m === 'sog' || m === 'shots' || m === 'shots_on_goal') return 'sog';
  if (m === 'nhl_points' || m === 'points_nhl') return 'points';
  if (m === 'receptions' || m === 'rec') return 'receptions';
  if (m === 'hits' || m === '0.5_hits') return 'hits';
  return m;
}

/**
 * Grades a single bet against a known actual stat.
 */
export function gradeSingleBet(
  bet: PersonalBet,
  actual: number,
  isDnp: boolean = false
): PersonalBet {
  if (isDnp) {
    return {
      ...bet,
      result: 'VOID',
      actual: null,
      pnl: 0,
      gradedAt: Date.now()
    };
  }

  let result: BetResult = 'PENDING';
  if (bet.side === 'OVER') {
    if (actual > bet.line) result = 'HIT';
    else if (actual < bet.line) result = 'MISS';
    else result = 'PUSH';
  } else {
    if (actual < bet.line) result = 'HIT';
    else if (actual > bet.line) result = 'MISS';
    else result = 'PUSH';
  }

  const pnl = calcBetPnl({ result, odds: bet.odds, stake: bet.stake });

  return {
    ...bet,
    result,
    actual,
    pnl,
    gradedAt: Date.now()
  };
}

/**
 * Reconciles and auto-grades personal bets against graded CardRows from any sport.
 * Only updates bets that are currently 'PENDING' or previously graded against an older line.
 */
export function reconcileBetsWithCardRows(
  bets: PersonalBet[],
  cardRows: CardRow[]
): { updatedBets: PersonalBet[]; gradedCount: number } {
  if (!bets.length || !cardRows.length) {
    return { updatedBets: bets, gradedCount: 0 };
  }

  let gradedCount = 0;
  const updatedBets = bets.map(bet => {
    // If already settled and locked, keep it unless user wants to re-check
    if (bet.result !== 'PENDING') return bet;

    const normBetName = normalizeName(bet.player);
    const normBetMkt = normalizeMarket(bet.market);

    // Look for matching card row with final outcome
    const match = cardRows.find(cr => {
      if (cr.date !== bet.date) return false;
      if (normalizeMarket(cr.market) !== normBetMkt) return false;
      const normCrName = normalizeName(cr.name);
      return normCrName === normBetName || normCrName.includes(normBetName) || normBetName.includes(normCrName);
    });

    if (match && match.result !== null) {
      if (match.result === 'VOID') {
        gradedCount++;
        return gradeSingleBet(bet, 0, true);
      }
      if (match.actual !== null) {
        gradedCount++;
        return gradeSingleBet(bet, match.actual, false);
      }
    }

    return bet;
  });

  return { updatedBets, gradedCount };
}

/**
 * Generates CSV string for personal bets export.
 */
export function exportBetsToCsv(bets: PersonalBet[]): string {
  const headers = ['id', 'date', 'sport', 'player', 'team', 'opp', 'market', 'side', 'line', 'odds', 'stake', 'result', 'actual', 'pnl', 'notes'];
  const rows = bets.map(b => [
    b.id,
    b.date,
    b.sport,
    `"${(b.player || '').replace(/"/g, '""')}"`,
    b.team || '',
    b.opp || '',
    b.market,
    b.side,
    b.line,
    b.odds > 0 ? `+${b.odds}` : b.odds,
    b.stake,
    b.result,
    b.actual != null ? b.actual : '',
    b.pnl != null ? b.pnl : '',
    `"${(b.notes || '').replace(/"/g, '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Generates JSON string for personal bets export.
 */
export function exportBetsToJson(bets: PersonalBet[]): string {
  return JSON.stringify(bets, null, 2);
}

/**
 * Normalizes American or Decimal odds into integer American odds.
 * e.g. -110 -> -110, "+135" -> 135, 1.91 (decimal) -> -110, 2.50 (decimal) -> +150
 */
export function normalizeOdds(rawOdds: unknown): number {
  if (rawOdds == null) return -110;
  if (typeof rawOdds === 'string') {
    const s = rawOdds.trim();
    if (s.toLowerCase() === 'even' || s.toLowerCase() === 'ev') return 100;
    const clean = s.replace('+', '').trim();
    const num = parseFloat(clean);
    if (!isNaN(num)) {
      return normalizeOdds(num);
    }
    return -110;
  }
  if (typeof rawOdds === 'number' && Number.isFinite(rawOdds)) {
    // If between 1.01 and 30, it is likely decimal odds (e.g. 1.91, 2.50)
    if (rawOdds >= 1.01 && rawOdds <= 30.0) {
      if (rawOdds >= 2.0) {
        return Math.round((rawOdds - 1) * 100);
      } else if (rawOdds > 1.0) {
        return Math.round(-100 / (rawOdds - 1));
      }
    }
    return Math.round(rawOdds);
  }
  return -110;
}

/**
 * Normalizes sport string to valid BetSport ('nba' | 'nhl' | 'nfl' | 'mlb').
 */
export function normalizeSport(rawSport: unknown): BetSport {
  if (!rawSport || typeof rawSport !== 'string') return 'nba';
  const s = rawSport.toLowerCase().trim();
  if (s.includes('nhl') || s.includes('hockey')) return 'nhl';
  if (s.includes('nfl') || s.includes('football')) return 'nfl';
  if (s.includes('mlb') || s.includes('baseball')) return 'mlb';
  return 'nba';
}

/**
 * Flexible case-insensitive property getter for JSON/Object bet records.
 * Strips whitespace, underscores, and hyphens so "Player Name", "player_name", "playerName", "PLAYER" all match.
 */
function getItemValue(item: Record<string, any>, ...keys: string[]): any {
  if (!item || typeof item !== 'object') return undefined;
  for (const k of keys) {
    if (item[k] !== undefined && item[k] !== null) return item[k];
  }
  const itemKeys = Object.keys(item);
  for (const target of keys) {
    const targetClean = target.toLowerCase().replace(/[\s_\-]/g, '');
    const found = itemKeys.find(k => k.toLowerCase().replace(/[\s_\-]/g, '') === targetClean);
    if (found && item[found] !== undefined && item[found] !== null) {
      return item[found];
    }
  }
  return undefined;
}

/**
 * Parses CSV upload into personal bets.
 * Handles BOM, flexible header names, and quoted fields.
 */
export function parseBetsFromCsv(csvText: string): { bets: PersonalBet[]; errors: string[] } {
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { bets: [], errors: ['CSV contains no data rows. Expected headers and at least one bet row.'] };
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));

  const findCol = (...aliases: string[]) => {
    return headers.findIndex(h => aliases.includes(h));
  };

  const colDate = findCol('date', 'game_date', 'gamedate', 'day');
  const colPlayer = findCol('player', 'name', 'athlete', 'player_name', 'playername', 'target');
  const colSport = findCol('sport', 'league', 'category');
  const colMarket = findCol('market', 'prop', 'stat', 'stat_type', 'type');
  const colSide = findCol('side', 'lean', 'pick', 'direction', 'over_under', 'ou');
  const colLine = findCol('line', 'threshold', 'total', 'target', 'value');
  const colOdds = findCol('odds', 'price', 'american_odds', 'americanodds');
  const colStake = findCol('stake', 'units', 'risk', 'amount', 'size');
  const colNotes = findCol('notes', 'note', 'comment', 'description');
  const colResult = findCol('result', 'status', 'outcome');

  if (colPlayer === -1) {
    return { bets: [], errors: ['Missing required "player" column in CSV header. Found: ' + headers.join(', ')] };
  }

  const bets: PersonalBet[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Simple CSV parser respecting quoted commas
    const cols: string[] = [];
    let insideQuote = false;
    let curr = '';
    for (let charIdx = 0; charIdx < rawLine.length; charIdx++) {
      const char = rawLine[charIdx];
      if (char === '"' || char === "'") {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        cols.push(curr.trim().replace(/^["']|["']$/g, ''));
        curr = '';
      } else {
        curr += char;
      }
    }
    cols.push(curr.trim().replace(/^["']|["']$/g, ''));

    const playerName = (cols[colPlayer] || '').trim();
    if (!playerName) {
      errors.push(`Row ${i + 1}: Skipped row with empty player name.`);
      continue;
    }

    const rawSport = colSport !== -1 ? cols[colSport] : 'nba';
    const sport = normalizeSport(rawSport);

    const rawSide = colSide !== -1 ? (cols[colSide] || '').toUpperCase().trim() : 'OVER';
    const side: BetSide = rawSide.startsWith('U') ? 'UNDER' : 'OVER';

    const rawLineVal = colLine !== -1 ? parseFloat(cols[colLine].replace(/[^0-9.-]/g, '')) : 0.5;
    const line = !isNaN(rawLineVal) ? rawLineVal : 0.5;

    let odds = -110;
    if (colOdds !== -1 && cols[colOdds]) {
      odds = normalizeOdds(cols[colOdds]);
    }

    let stake = 1.0;
    if (colStake !== -1 && cols[colStake]) {
      const parsedStake = parseFloat(cols[colStake].replace(/[^0-9.-]/g, ''));
      if (!isNaN(parsedStake) && parsedStake > 0) stake = parsedStake;
    }

    const date = colDate !== -1 && cols[colDate] ? cols[colDate].trim() : new Date().toISOString().split('T')[0];
    const market = colMarket !== -1 && cols[colMarket] ? normalizeMarket(cols[colMarket]) : 'points';
    const notes = colNotes !== -1 ? cols[colNotes] || '' : '';

    let result: BetResult = 'PENDING';
    if (colResult !== -1 && cols[colResult]) {
      const r = cols[colResult].toUpperCase().trim();
      if (['HIT', 'WIN', 'W', 'WON'].includes(r)) result = 'HIT';
      else if (['MISS', 'LOSS', 'L', 'LOST'].includes(r)) result = 'MISS';
      else if (['PUSH', 'TIE', 'P'].includes(r)) result = 'PUSH';
      else if (['VOID', 'DNP', 'CANCELED', 'CANCELLED', 'V'].includes(r)) result = 'VOID';
    }

    bets.push(createPersonalBet({
      date,
      sport,
      player: playerName,
      market,
      side,
      line,
      odds,
      stake,
      result,
      notes,
      source: 'import_csv'
    }));
  }

  return { bets, errors };
}

/**
 * Sanitizes loose JSON text by stripping JS comments, trailing commas, and unquoted identifiers.
 */
function cleanLooseJson(str: string): string {
  // Strip block comments /* ... */ and line comments // ...
  let s = str.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  // Strip trailing commas before closing braces/brackets
  s = s.replace(/,(\s*[\]}])/g, '$1');
  return s.trim();
}

/**
 * Parses JSON upload into personal bets.
 * Supports:
 * - Direct arrays: [ { ... } ]
 * - Wrapped objects: { "bets": [...] }, { "personal_bets": [...] }, { "data": [...] }, { "picks": [...] }, etc.
 * - Date-grouped objects: { "2026-11-06": [ ... ], "2026-11-07": [ ... ] }
 * - Single bet object: { "player": "...", ... }
 * - Object map of bets: { "b1": { ... }, "b2": { ... } }
 * - Newline-delimited JSON (NDJSON / JSONL)
 * - Flexible property casing & aliases (name, player_name, prop, odds, price, units, etc.)
 */
export function parseBetsFromJson(jsonText: string): { bets: PersonalBet[]; errors: string[] } {
  // 1. Strip UTF-8 BOM & leading/trailing whitespace
  const clean = jsonText.replace(/^\uFEFF/, '').trim();
  if (!clean) {
    return { bets: [], errors: ['File or JSON content is empty (0 bytes). Please provide valid bet data.'] };
  }

  let parsed: any;
  let itemsArray: any[] = [];
  const errors: string[] = [];

  // 2. Try JSON.parse with loose cleaning fallback
  try {
    parsed = JSON.parse(clean);
  } catch (initialErr) {
    try {
      const looseClean = cleanLooseJson(clean);
      parsed = JSON.parse(looseClean);
    } catch {
      try {
        // Evaluate JavaScript object literal safely (e.g. unquoted keys or single quotes)
        const sanitized = cleanLooseJson(clean);
        parsed = new Function('return (' + sanitized + ')')();
      } catch {
        // Try NDJSON / JSONL (one JSON object per line)
        const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
        const lineParsed: any[] = [];
        let isNdjson = lines.length > 0;
        for (const line of lines) {
          const lineTrimmed = line.trim();
          if (!lineTrimmed) continue;
          try {
            lineParsed.push(JSON.parse(lineTrimmed));
          } catch {
            try {
              lineParsed.push(new Function('return (' + cleanLooseJson(lineTrimmed) + ')')());
            } catch {
              isNdjson = false;
              break;
            }
          }
        }

        if (isNdjson && lineParsed.length > 0) {
          parsed = lineParsed;
        } else {
          return {
            bets: [],
            errors: [`JSON Parse error: ${(initialErr as Error).message}. Verify file syntax.`]
          };
        }
      }
    }
  }

  // 3. Extract items array from parsed structure
  if (Array.isArray(parsed)) {
    itemsArray = parsed;
  } else if (parsed && typeof parsed === 'object') {
    // Check known container property names (case-insensitive)
    const knownKeys = [
      'bets', 'personal_bets', 'personalbets', 'personal', 'data', 'picks', 'wagers',
      'my_bets', 'mybets', 'props', 'items', 'rows', 'records', 'results', 'list', 'entries',
      'tickets', 'plays'
    ];
    let foundArray: any[] | null = null;
    for (const k of Object.keys(parsed)) {
      if (knownKeys.includes(k.toLowerCase().replace(/[\s_\-]/g, '')) && Array.isArray(parsed[k])) {
        foundArray = parsed[k];
        break;
      }
    }

    // Check if any property in the object is an array of objects
    if (!foundArray) {
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
          foundArray = val;
          break;
        }
      }
    }

    // Check if the object values are multiple arrays of objects (e.g. grouped by date: { "2026-11-06": [...], "2026-11-07": [...] })
    if (!foundArray) {
      const allArrays = Object.values(parsed).filter(val => Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') as any[][];
      if (allArrays.length > 0) {
        foundArray = allArrays.flat();
      }
    }

    // Check if the object itself is a single bet object
    if (!foundArray) {
      const hasPlayer = getItemValue(parsed, 'player', 'name', 'athlete', 'playerName', 'player_name', 'selection');
      if (hasPlayer) {
        foundArray = [parsed];
      }
    }

    // Check if the object is a dictionary of bets: { "1": { player: ... }, "2": { player: ... } }
    if (!foundArray) {
      const values = Object.values(parsed);
      if (values.length > 0 && values.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
        const anyHasPlayer = values.some((v: any) => getItemValue(v, 'player', 'name', 'athlete', 'playerName', 'selection'));
        if (anyHasPlayer) {
          foundArray = values;
        }
      }
    }

    if (foundArray) {
      itemsArray = foundArray;
    } else {
      return {
        bets: [],
        errors: [
          'No bet items found in JSON. Expected an array of bets (e.g. `[{ "player": "...", "market": "points", "line": 24.5 }]`) or an object with a "bets", "personal_bets", or "data" list.'
        ]
      };
    }
  } else {
    return { bets: [], errors: ['Invalid JSON format: expected an array or object of bets.'] };
  }

  if (itemsArray.length === 0) {
    return {
      bets: [],
      errors: ['JSON array contains 0 bet items. No bets to import.']
    };
  }

  const bets: PersonalBet[] = [];

  for (let i = 0; i < itemsArray.length; i++) {
    const item = itemsArray[i];
    if (!item || typeof item !== 'object') {
      errors.push(`Item ${i + 1}: Skipped invalid item (not an object).`);
      continue;
    }

    const player = getItemValue(
      item,
      'player', 'name', 'playerName', 'player_name',
      'athlete', 'athlete_name', 'target', 'pick_player',
      'selection', 'who', 'title', 'player_display_name'
    );

    if (!player || typeof player !== 'string' || !player.trim()) {
      errors.push(`Item ${i + 1}: Missing player name (expected "player" or "name").`);
      continue;
    }

    const rawSport = getItemValue(item, 'sport', 'league', 'category');
    const sport = normalizeSport(rawSport);

    const rawMarket = getItemValue(item, 'market', 'prop', 'stat', 'stat_type', 'type') || 'points';
    const market = normalizeMarket(String(rawMarket));

    const rawSide = getItemValue(item, 'side', 'pick', 'direction', 'over_under', 'ou') || 'OVER';
    const side: BetSide = String(rawSide).toUpperCase().trim().startsWith('U') ? 'UNDER' : 'OVER';

    const rawLine = getItemValue(item, 'line', 'threshold', 'total', 'value', 'target');
    let line = 0.5;
    if (rawLine !== undefined && rawLine !== null) {
      const parsedLine = parseFloat(String(rawLine).replace(/[^0-9.-]/g, ''));
      if (!isNaN(parsedLine)) line = parsedLine;
    }

    const rawOdds = getItemValue(item, 'odds', 'price', 'american_odds', 'americanOdds');
    const odds = normalizeOdds(rawOdds);

    const rawStake = getItemValue(item, 'stake', 'units', 'amount', 'risk', 'size');
    let stake = 1.0;
    if (rawStake !== undefined && rawStake !== null) {
      const parsedStake = parseFloat(String(rawStake).replace(/[^0-9.-]/g, ''));
      if (!isNaN(parsedStake) && parsedStake > 0) stake = parsedStake;
    }

    let date = getItemValue(item, 'date', 'game_date', 'gameDate', 'day');
    if (typeof date === 'string' && date.includes('T')) {
      date = date.split('T')[0];
    }
    if (!date || typeof date !== 'string' || !date.trim()) {
      date = new Date().toISOString().split('T')[0];
    }

    const team = getItemValue(item, 'team', 'player_team', 'tm');
    const opp = getItemValue(item, 'opp', 'opponent', 'vs', 'matchup');
    const notes = getItemValue(item, 'notes', 'note', 'comment', 'description');

    const rawResult = getItemValue(item, 'result', 'status', 'outcome');
    let result: BetResult = 'PENDING';
    if (rawResult && typeof rawResult === 'string') {
      const r = rawResult.toUpperCase().trim();
      if (['HIT', 'WIN', 'W', 'WON'].includes(r)) result = 'HIT';
      else if (['MISS', 'LOSS', 'L', 'LOST'].includes(r)) result = 'MISS';
      else if (['PUSH', 'TIE', 'P'].includes(r)) result = 'PUSH';
      else if (['VOID', 'DNP', 'CANCELED', 'CANCELLED', 'V'].includes(r)) result = 'VOID';
    }

    const rawActual = getItemValue(item, 'actual', 'score', 'outcome_stat', 'stat_actual');
    let actual: number | null = null;
    if (rawActual !== undefined && rawActual !== null) {
      const parsedActual = parseFloat(String(rawActual).replace(/[^0-9.-]/g, ''));
      if (!isNaN(parsedActual)) actual = parsedActual;
    }

    const rawPnl = getItemValue(item, 'pnl', 'profit', 'net_units', 'netUnits');
    let pnl: number | null = null;
    if (rawPnl !== undefined && rawPnl !== null) {
      const parsedPnl = parseFloat(String(rawPnl).replace(/[^0-9.-]/g, ''));
      if (!isNaN(parsedPnl)) pnl = parsedPnl;
    }

    bets.push(createPersonalBet({
      id: getItemValue(item, 'id'),
      date: String(date).trim(),
      sport,
      player: String(player).trim(),
      team: team ? String(team).trim() : undefined,
      opp: opp ? String(opp).trim() : undefined,
      market,
      side,
      line,
      odds,
      stake,
      result,
      actual,
      notes: notes ? String(notes).trim() : undefined,
      source: 'import_json',
      pnl: pnl !== null ? pnl : undefined
    }));
  }

  return { bets, errors };
}
