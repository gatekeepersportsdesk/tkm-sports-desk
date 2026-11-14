/**
 * Gatekeep Sports Desk — nflverse ingestion.
 *
 * Pure functions that turn nflverse CSV text into the inputs the NFL
 * receptions model needs. No network or DOM here (the server fetches the
 * files); that keeps every step unit-testable against real data.
 *
 * Walk-forward integrity: everything priced for week W only sees weeks < W.
 *
 * Proxies (README: "trailing offense snap share (proxy for routes)"):
 *   routes_g      = team_dropbacks_g * offense_snap_pct_g
 *   season_tprr   = targets / routes
 *   route_pct     = mean offense_snap_pct over the last 4 games played
 *   season_avg    = receptions / games played
 */
import { NflGameContext, NflPlayerStats } from '../types/nfl';
import { computeStructuralMu, computeWalkForwardRatios, NFL_CONFIG, RatioObservation } from '../model/nfl_engine';

export type CsvRow = Record<string, string>;

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/** RFC4180-style CSV -> array of header-keyed rows. */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) { field += '"'; i++; }
        else inQuotes = false;
      } else field += text[i];
    } else if (c === 34) {
      inQuotes = true;
    } else if (c === 44) {
      row.push(field); field = '';
    } else if (c === 10) {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (c !== 13) {
      field += text[i];
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  const out: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const obj: CsvRow = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    out.push(obj);
  }
  return out;
}

const num = (s: string | undefined): number => {
  if (s === undefined || s === '') return 0;
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

/* -------------------------------------------------------------------------- */
/* Names / teams                                                              */
/* -------------------------------------------------------------------------- */

const TEAM_ALIASES: Record<string, string> = {
  LAR: 'LA', STL: 'LA', WSH: 'WAS', JAC: 'JAX', ARZ: 'ARI', SD: 'LAC', SDG: 'LAC',
  OAK: 'LV', LVR: 'LV', HST: 'HOU', BLT: 'BAL', CLV: 'CLE', SF49: 'SF', GNB: 'GB',
  KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB'
};

/** Canonical NFL team code (nflverse style: LA, WAS, JAX, LV). */
export function normalizeNflTeam(code: string | undefined | null): string {
  const u = (code || '').toUpperCase().trim();
  return TEAM_ALIASES[u] || u;
}

export function normalizePlayerName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[.'’\-]/g, '')
    .replace(/\s+(jr|sr|iii|ii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

interface PlayerWeek {
  gsis: string;
  name: string;
  pos: 'WR' | 'TE';
  team: string;
  week: number;
  snapPct: number | null;
  snaps: number;
  targets: number;
  receptions: number;
  dropbacks: number;
}

export interface PlayerAgg {
  gsis: string;
  name: string;
  pos: 'WR' | 'TE';
  team: string;
  games: number;
  targets: number;
  receptions: number;
  routes: number;
  recentSnapPct: number;
  lastWeek: number;
}

export interface NflverseInputs {
  statsRows: CsvRow[];
  snapRows: CsvRow[];
  /** players.csv rows; used to join snap counts (pfr id) to stats (gsis id) */
  playersRows?: CsvRow[];
}

function isRecvPos(p: string): p is 'WR' | 'TE' {
  return p === 'WR' || p === 'TE';
}

/** team + week -> dropbacks (pass attempts + sacks taken) */
export function teamDropbacks(statsRows: CsvRow[], season: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of statsRows) {
    if (num(r.season) !== season) continue;
    const key = `${normalizeNflTeam(r.team)}|${num(r.week)}`;
    out.set(key, (out.get(key) || 0) + num(r.attempts) + num(r.sacks_suffered));
  }
  return out;
}

/** Build player-week records (WR/TE only) for one season. */
function buildPlayerWeeks(inp: NflverseInputs, season: number): PlayerWeek[] {
  const dropbacks = teamDropbacks(inp.statsRows.filter(r => !r.season_type || r.season_type === 'REG'), season);

  // pfr id -> gsis id
  const pfrToGsis = new Map<string, string>();
  if (inp.playersRows) {
    for (const p of inp.playersRows) {
      if (p.pfr_id && p.gsis_id) pfrToGsis.set(p.pfr_id, p.gsis_id);
    }
  }

  // stats index: gsis|week -> row ; and team|name|week -> row (fallback join)
  const statsById = new Map<string, CsvRow>();
  const statsByName = new Map<string, CsvRow>();
  for (const r of inp.statsRows) {
    if (num(r.season) !== season) continue;
    if (r.season_type && r.season_type !== 'REG') continue;
    const wk = num(r.week);
    statsById.set(`${r.player_id}|${wk}`, r);
    statsByName.set(`${normalizeNflTeam(r.team)}|${normalizePlayerName(r.player_display_name)}|${wk}`, r);
  }

  const out = new Map<string, PlayerWeek>();
  const keyOf = (gsis: string, week: number) => `${gsis}|${week}`;

  // primary: snap rows (they include WR/TE who played but had zero targets)
  for (const s of inp.snapRows) {
    if (num(s.season) !== season) continue;
    if (s.game_type && s.game_type !== 'REG') continue;
    if (!isRecvPos(s.position)) continue;
    const week = num(s.week);
    const team = normalizeNflTeam(s.team);
    const snaps = num(s.offense_snaps);
    if (snaps <= 0) continue;
    let gsis = s.pfr_player_id ? pfrToGsis.get(s.pfr_player_id) : undefined;
    let st = gsis ? statsById.get(`${gsis}|${week}`) : undefined;
    if (!st) {
      st = statsByName.get(`${team}|${normalizePlayerName(s.player)}|${week}`);
      if (st) gsis = st.player_id;
    }
    const id = gsis || `name:${team}:${normalizePlayerName(s.player)}`;
    out.set(keyOf(id, week), {
      gsis: id,
      name: st?.player_display_name || s.player,
      pos: s.position,
      team,
      week,
      snapPct: num(s.offense_pct),
      snaps,
      targets: st ? num(st.targets) : 0,
      receptions: st ? num(st.receptions) : 0,
      dropbacks: dropbacks.get(`${team}|${week}`) || 0
    });
  }

  // secondary: stats rows with targets that snap data missed
  for (const r of inp.statsRows) {
    if (num(r.season) !== season) continue;
    if (r.season_type && r.season_type !== 'REG') continue;
    if (!isRecvPos(r.position)) continue;
    if (num(r.targets) <= 0) continue;
    const week = num(r.week);
    const k = keyOf(r.player_id, week);
    if (out.has(k)) continue;
    // already joined under a name-key id?
    const team = normalizeNflTeam(r.team);
    const nameKey = keyOf(`name:${team}:${normalizePlayerName(r.player_display_name)}`, week);
    if (out.has(nameKey)) continue;
    out.set(k, {
      gsis: r.player_id,
      name: r.player_display_name,
      pos: r.position,
      team,
      week,
      snapPct: null,
      snaps: 0,
      targets: num(r.targets),
      receptions: num(r.receptions),
      dropbacks: dropbacks.get(`${team}|${week}`) || 0
    });
  }
  return Array.from(out.values());
}

/** Aggregate player-weeks strictly before `beforeWeek`. */
function aggregate(weeks: PlayerWeek[], beforeWeek: number): Map<string, PlayerAgg> {
  const byPlayer = new Map<string, PlayerWeek[]>();
  for (const w of weeks) {
    if (w.week >= beforeWeek) continue;
    const arr = byPlayer.get(w.gsis) || [];
    arr.push(w);
    byPlayer.set(w.gsis, arr);
  }
  const out = new Map<string, PlayerAgg>();
  byPlayer.forEach((arr, gsis) => {
    arr.sort((a, b) => a.week - b.week);
    const played = arr.filter(w => w.snaps > 0 || w.targets > 0);
    if (!played.length) return;
    let targets = 0, receptions = 0, routes = 0;
    const pcts: number[] = [];
    for (const w of played) {
      targets += w.targets;
      receptions += w.receptions;
      if (w.snapPct !== null) {
        routes += w.dropbacks * w.snapPct;
        pcts.push(w.snapPct);
      }
    }
    const recent = pcts.slice(-4);
    const last = played[played.length - 1];
    out.set(gsis, {
      gsis,
      name: last.name,
      pos: last.pos,
      team: last.team,
      games: played.length,
      targets,
      receptions,
      routes,
      recentSnapPct: recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0,
      lastWeek: last.week
    });
  });
  return out;
}

/** League TPRR by position from a (prior) season: sum(targets) / sum(routes). */
export function positionTprrPriors(aggs: Map<string, PlayerAgg>, minRoutes = 100): Record<'WR' | 'TE', number> {
  const tot = { WR: { t: 0, r: 0 }, TE: { t: 0, r: 0 } };
  aggs.forEach(a => {
    if (a.routes >= minRoutes) {
      tot[a.pos].t += a.targets;
      tot[a.pos].r += a.routes;
    }
  });
  return {
    WR: tot.WR.r > 0 ? tot.WR.t / tot.WR.r : NFL_CONFIG.league_tprr,
    TE: tot.TE.r > 0 ? tot.TE.t / tot.TE.r : NFL_CONFIG.league_tprr * 0.8
  };
}

export interface BuildReceiversOptions {
  season: number;
  /** price week W; only weeks < W are used */
  week: number;
  current: NflverseInputs;
  prior?: NflverseInputs;
  /** per-position walk-forward ratios (defaults to config priors) */
  ratios?: Partial<Record<'WR' | 'TE', number>>;
  maxPerTeam?: number;
  /** raw injuries.csv rows; when given, listed teammate absences raise each remaining receiver's mu (v1.6) */
  injuriesRows?: CsvRow[];
}

export function buildNflReceiverStats(opts: BuildReceiversOptions): Record<string, NflPlayerStats[]> {
  const curWeeks = buildPlayerWeeks(opts.current, opts.season);
  const cur = aggregate(curWeeks, opts.week);

  let priorAgg: Map<string, PlayerAgg> | null = null;
  let posPrior: Record<'WR' | 'TE', number> = { WR: NFL_CONFIG.league_tprr, TE: NFL_CONFIG.league_tprr * 0.8 };
  if (opts.prior) {
    priorAgg = aggregate(buildPlayerWeeks(opts.prior, opts.season - 1), 99);
    posPrior = positionTprrPriors(priorAgg);
  }

  const absence = opts.injuriesRows
    ? computeAbsenceLoad({ season: opts.season, week: opts.week, statsRows: opts.current.statsRows, injuriesRows: opts.injuriesRows })
    : {};
  const out: Record<string, NflPlayerStats[]> = {};
  cur.forEach(a => {
    if (a.games < 1) return;
    // Only keep players who are real contributors
    if (a.targets < 1 && a.recentSnapPct < 0.25) return;
    const pa = priorAgg?.get(a.gsis);
    const priorTprr = pa && pa.routes >= 100 ? pa.targets / pa.routes : posPrior[a.pos];
    const seasonTprr = a.routes > 0 ? a.targets / a.routes : posPrior[a.pos];
    const stats: NflPlayerStats = {
      name: a.name,
      pos: a.pos,
      team: a.team,
      route_pct: Math.min(1, Math.max(0, a.recentSnapPct)),
      season_tprr: seasonTprr,
      prior_tprr: priorTprr,
      routes: a.routes,
      targets: a.targets,
      receptions: a.receptions,
      games: a.games,
      season_avg: a.games > 0 ? a.receptions / a.games : 0,
      ratio: opts.ratios?.[a.pos] ?? NFL_CONFIG.ratio_prior[a.pos],
      source: 'nflverse',
      asOfWeek: opts.week - 1,
      gsis_id: a.gsis,
      absence_g: absence[a.team] && !absence[a.team].names.includes(a.name) ? absence[a.team].g : 0,
      absence_note: absence[a.team] && !absence[a.team].names.includes(a.name) ? absence[a.team].names.join(', ') : undefined
    };
    (out[a.team] = out[a.team] || []).push(stats);
  });
  const cap = opts.maxPerTeam ?? 12;
  Object.keys(out).forEach(t => {
    out[t].sort((x, y) => y.routes - x.routes);
    out[t] = out[t].slice(0, cap);
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Schedule / lines                                                           */
/* -------------------------------------------------------------------------- */

const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function kickoffLabel(weekday: string, gametime: string): string {
  const short = (weekday || '').slice(0, 3);
  if (!gametime) return short;
  const [h, m] = gametime.split(':').map(Number);
  if (!Number.isFinite(h)) return `${short} ${gametime} ET`;
  const hr12 = ((h + 11) % 12) + 1;
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${short} ${hr12}:${String(m || 0).padStart(2, '0')} ${ap} ET`;
}

/**
 * Epoch ms of an nflverse kickoff (`gameday` YYYY-MM-DD + `gametime` HH:MM, both US Eastern). null when either is missing,
 * so a game with no known kickoff is never treated as "not started yet".
 */
export function easternKickoffMs(gameday: string, gametime: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gameday || '');
  const t = /^(\d{1,2}):(\d{2})/.exec(gametime || '');
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const asUtc = Date.UTC(y, mo - 1, da, h, mi);
  // find the Eastern offset in force at that wall-clock time (handles daylight saving without a tz database in the app)
  for (const off of [4, 5]) {
    const guess = asUtc + off * 3600000;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(guess));
    const g = (k: string) => Number(parts.find(x => x.type === k)?.value);
    if (g('year') === y && g('month') === mo && g('day') === da && g('hour') % 24 === h && g('minute') === mi) return guess;
  }
  return null;
}

/** nflverse spread_line is the HOME team's expected margin (+ = home favored). */
export function buildNflGames(rows: CsvRow[], season: number, week: number): NflGameContext[] {
  const out: NflGameContext[] = [];
  for (const r of rows) {
    if (num(r.season) !== season || num(r.week) !== week) continue;
    if (r.game_type && r.game_type !== 'REG') continue;
    const away = normalizeNflTeam(r.away_team);
    const home = normalizeNflTeam(r.home_team);
    const hasLine = r.spread_line !== '' && r.total_line !== '';
    const spreadLine = num(r.spread_line);
    const total = num(r.total_line);
    const weekday = DAY_ORDER.includes(r.weekday) ? r.weekday : 'Sunday';
    out.push({
      id: `${season}-${week}-${away}@${home}`,
      season,
      week,
      day: weekday as NflGameContext['day'],
      kickoff: kickoffLabel(weekday, r.gametime),
      kickoffAt: easternKickoffMs(r.gameday, r.gametime),
      away,
      home,
      spread_home: -spreadLine,
      implied_total_home: total / 2 + spreadLine / 2,
      spread_away: spreadLine,
      implied_total_away: total / 2 - spreadLine / 2,
      hasLine,
      played: r.home_score !== '' && r.away_score !== ''
    });
  }
  return out;
}

/** First week of the season that still has an unplayed game (else the last week). */
export function currentNflWeek(rows: CsvRow[], season: number): number {
  let last = 1;
  let firstOpen: number | null = null;
  for (const r of rows) {
    if (num(r.season) !== season) continue;
    if (r.game_type && r.game_type !== 'REG') continue;
    const w = num(r.week);
    if (w > last) last = w;
    const played = r.home_score !== '' && r.away_score !== '';
    if (!played && (firstOpen === null || w < firstOpen)) firstOpen = w;
  }
  return firstOpen ?? last;
}

/** Season label for a date: Jan-Feb belong to the previous season. */
export function nflSeasonFor(date: Date = new Date()): number {
  return date.getMonth() <= 1 ? date.getFullYear() - 1 : date.getFullYear();
}


/* -------------------------------------------------------------------------- */
/* Teammate absence (v1.6)                                                    */
/* -------------------------------------------------------------------------- */

export interface AbsenceLoad { lostShare: number; g: number; names: string[] }

/**
 * Per team: the share of its relevant pass-catching targets sitting on players the official injury report lists
 * Out/Doubtful for `week`. Uses ONLY current-season REG stats from weeks before `week` (trailing 4 games) and the
 * report itself, so it is knowable before kickoff. A player counts when he averaged >= absence_min_tavg targets over
 * >= absence_min_games prior games and last played within absence_window_weeks. Inactive players have NO snap-count
 * row, which is why the first version of this feature (keyed on snaps < 10) found almost nothing.
 */
export function computeAbsenceLoad(args: { season: number; week: number; statsRows: CsvRow[]; injuriesRows: CsvRow[] }): Record<string, AbsenceLoad> {
  const { season, week } = args;
  const byPlayer = new Map<string, { week: number; team: string; targets: number; name: string }[]>();
  for (const r of args.statsRows) {
    if (num(r.season) !== season) continue;
    if (r.season_type && r.season_type !== 'REG') continue;
    const wk = num(r.week);
    if (wk >= week) continue;
    const arr = byPlayer.get(r.player_id) || [];
    arr.push({ week: wk, team: normalizeNflTeam(r.team), targets: num(r.targets), name: r.player_display_name });
    byPlayer.set(r.player_id, arr);
  }
  const absentIds = new Set<string>();
  for (const r of args.injuriesRows) {
    if (num(r.season) !== season || num(r.week) !== week) continue;
    const st = (r.report_status || '').trim().toLowerCase();
    if (st === 'out' || st === 'doubtful') absentIds.add(r.gsis_id);
  }
  const tot = new Map<string, number>();
  const lost = new Map<string, number>();
  const names = new Map<string, string[]>();
  byPlayer.forEach((games, pid) => {
    games.sort((a, b) => a.week - b.week);
    const last4 = games.slice(-4);
    if (last4.length < NFL_CONFIG.absence_min_games) return;
    const tavg = last4.reduce((s, g) => s + g.targets, 0) / last4.length;
    if (tavg < NFL_CONFIG.absence_min_tavg) return;
    const lastGame = last4[last4.length - 1];
    if (lastGame.week < week - NFL_CONFIG.absence_window_weeks) return;
    tot.set(lastGame.team, (tot.get(lastGame.team) || 0) + tavg);
    if (absentIds.has(pid)) {
      lost.set(lastGame.team, (lost.get(lastGame.team) || 0) + tavg);
      (names.get(lastGame.team) || names.set(lastGame.team, []).get(lastGame.team)!).push(lastGame.name);
    }
  });
  const out: Record<string, AbsenceLoad> = {};
  lost.forEach((l, team) => {
    const share = Math.min(NFL_CONFIG.absence_clip_share, l / Math.max(1, tot.get(team) || 0));
    out[team] = { lostShare: share, g: -Math.log(1 - share), names: names.get(team) || [] };
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Injuries                                                                   */
/* -------------------------------------------------------------------------- */

export type NflInjuryStatus = 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE';

export interface NflInjuryInfo {
  status: NflInjuryStatus;
  detail: string;
  team: string;
}

/** name (normalized) -> official report status for the given week. */
export function buildNflInjuries(rows: CsvRow[], season: number, week: number): Record<string, NflInjuryInfo> {
  const out: Record<string, NflInjuryInfo> = {};
  for (const r of rows) {
    if (num(r.season) !== season || num(r.week) !== week) continue;
    const st = (r.report_status || '').trim().toLowerCase();
    let status: NflInjuryStatus | null = null;
    if (st === 'out') status = 'OUT';
    else if (st === 'doubtful') status = 'DOUBTFUL';
    else if (st === 'questionable') status = 'QUESTIONABLE';
    if (!status) continue;
    out[normalizePlayerName(r.full_name)] = {
      status,
      detail: [r.report_primary_injury, r.practice_status].filter(Boolean).join(' · '),
      team: normalizeNflTeam(r.team)
    };
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Real grading                                                               */
/* -------------------------------------------------------------------------- */

export interface NflActual { played: boolean; actual: number; team: string }

/**
 * Final receptions for every WR/TE who logged an offensive snap or target in the
 * given week, restricted to teams whose game has a final score. A receiver on a
 * finished game with no row is NOT returned here (caller treats as DNP/void).
 * Keys are normalized player names.
 */
export function buildNflActuals(inp: NflverseInputs, gamesRows: CsvRow[], season: number, week: number): {
  actuals: Record<string, NflActual>;
  finalTeams: string[];
} {
  const finalTeams = new Set<string>();
  for (const r of gamesRows) {
    if (num(r.season) !== season || num(r.week) !== week) continue;
    if (r.home_score === '' || r.away_score === '' || r.home_score === undefined) continue;
    finalTeams.add(normalizeNflTeam(r.home_team));
    finalTeams.add(normalizeNflTeam(r.away_team));
  }
  const actuals: Record<string, NflActual> = {};
  for (const w of buildPlayerWeeks(inp, season)) {
    if (w.week !== week || !finalTeams.has(w.team)) continue;
    if (w.snaps <= 0 && w.targets <= 0) continue;
    actuals[normalizePlayerName(w.name)] = { played: true, actual: w.receptions, team: w.team };
  }
  return { actuals, finalTeams: Array.from(finalTeams) };
}

/* -------------------------------------------------------------------------- */
/* Walk-forward backtest (also drives the live position ratios)              */
/* -------------------------------------------------------------------------- */

export interface BacktestRow {
  season: number;
  week: number;
  name: string;
  pos: 'WR' | 'TE';
  team: string;
  muStructural: number;
  mu: number;
  seasonAvg: number;
  actual: number;
  games: number;
  /** v1.6 multiplier already inside mu (1 = none) */
  absenceFactor: number;
}

/**
 * For each week w in [fromWeek, toWeek], price every WR/TE who played using only
 * data before w, then record the actual receptions. Uses the game lines in
 * games.csv for dropbacks. No market lines exist in nflverse, so this validates
 * the MEAN and DISPERSION of the model, not edge.
 */
export function backtestNfl(args: {
  season: number;
  fromWeek: number;
  toWeek: number;
  current: NflverseInputs;
  prior?: NflverseInputs;
  gamesRows: CsvRow[];
  minGames?: number;
  ratios?: Partial<Record<'WR' | 'TE', number>>;
  /** raw injuries.csv rows (this season); enables the v1.6 teammate-absence factor */
  injuriesRows?: CsvRow[];
}): BacktestRow[] {
  const weeks = buildPlayerWeeks(args.current, args.season);
  const priorAgg = args.prior ? aggregate(buildPlayerWeeks(args.prior, args.season - 1), 99) : null;
  const posPrior = priorAgg ? positionTprrPriors(priorAgg) : { WR: NFL_CONFIG.league_tprr, TE: NFL_CONFIG.league_tprr * 0.8 };

  // game lookup: team|week -> {spread, implied}
  const lineByTeamWeek = new Map<string, { spread: number; implied: number }>();
  for (const r of args.gamesRows) {
    if (num(r.season) !== args.season) continue;
    if (r.game_type && r.game_type !== 'REG') continue;
    if (r.spread_line === '' || r.total_line === '') continue;
    const wk = num(r.week);
    const sl = num(r.spread_line);
    const tot = num(r.total_line);
    lineByTeamWeek.set(`${normalizeNflTeam(r.home_team)}|${wk}`, { spread: -sl, implied: tot / 2 + sl / 2 });
    lineByTeamWeek.set(`${normalizeNflTeam(r.away_team)}|${wk}`, { spread: sl, implied: tot / 2 - sl / 2 });
  }

  const out: BacktestRow[] = [];
  const minGames = args.minGames ?? 2;
  for (let w = args.fromWeek; w <= args.toWeek; w++) {
    const agg = aggregate(weeks, w);
    const absence = args.injuriesRows
      ? computeAbsenceLoad({ season: args.season, week: w, statsRows: args.current.statsRows, injuriesRows: args.injuriesRows })
      : {};
    const actualThisWeek = weeks.filter(pw => pw.week === w && pw.snaps > 0);
    for (const pw of actualThisWeek) {
      const a = agg.get(pw.gsis);
      if (!a || a.games < minGames) continue;
      const line = lineByTeamWeek.get(`${pw.team}|${w}`);
      if (!line) continue;
      const pa = priorAgg?.get(pw.gsis);
      const priorTprr = pa && pa.routes >= 100 ? pa.targets / pa.routes : posPrior[a.pos];
      const seasonTprr = a.routes > 0 ? a.targets / a.routes : posPrior[a.pos];
      const ratio = args.ratios?.[a.pos] ?? NFL_CONFIG.ratio_prior[a.pos];
      const math = computeStructuralMu(
        {
          routes: a.routes,
          season_tprr: seasonTprr,
          prior_tprr: priorTprr,
          receptions: a.receptions,
          targets: a.targets,
          route_pct: a.recentSnapPct,
          walk_forward_ratio: ratio,
          season_avg_receptions: a.receptions / a.games,
          absence_g: absence[pw.team] && !absence[pw.team].names.includes(pw.name) ? absence[pw.team].g : 0
        },
        { spread: line.spread, implied_total: line.implied }
      );
      out.push({
        season: args.season,
        week: w,
        name: pw.name,
        pos: a.pos,
        team: pw.team,
        muStructural: math.muStructural,
        mu: math.finalMu,
        seasonAvg: a.receptions / a.games,
        actual: pw.receptions,
        games: a.games,
        absenceFactor: math.absenceFactor
      });
    }
  }
  return out;
}

/**
 * Live walk-forward ratios: replay weeks 2..W-1 of the CURRENT season and return
 * the decayed, shrunk, clipped actual/predicted ratio per position. Because
 * backtestNfl never lets a week see itself, these ratios are legitimate inputs
 * for week W. (Prior-season replay is deliberately off; see NFL_CONFIG.)
 */
export function computeNflRatiosFromHistory(args: {
  season: number;
  week: number;
  current: NflverseInputs;
  prior?: NflverseInputs;
  gamesRows: CsvRow[];
}): Record<'WR' | 'TE', { ratio: number; n: number }> {
  const obs: RatioObservation[] = [];
  if (args.week > 2) {
    backtestNfl({
      season: args.season,
      fromWeek: 2,
      toWeek: args.week - 1,
      current: args.current,
      prior: args.prior,
      gamesRows: args.gamesRows
    }).forEach(r =>
      obs.push({ pos: r.pos, muStructural: r.muStructural, actual: r.actual, played: true, week: r.week, season: r.season })
    );
  }
  return computeWalkForwardRatios(obs, { season: args.season, week: args.week });
}
