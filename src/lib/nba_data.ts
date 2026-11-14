/**
 * NBA data layer. All parsing lives here (server.ts only relays), so it is unit-tested.
 *
 * Box scores: the free sportsdataverse ESPN player box-score releases (the SAME source the model was fitted on, so
 * live inputs have exactly the fitted schema). Season label = ENDING year (2027 = 2026-27). Only regular-season rows
 * where the player actually played count toward his rates; a DNP is never a zero (it is a VOID when graded).
 *
 * Schedule and injuries come from ESPN's public site API. Those two endpoints could not be reached from the build
 * sandbox, so their parsers are written defensively against the documented shape and tested on fixtures of that shape;
 * if either feed is missing the desk shows UNKNOWN availability and nothing can qualify.
 */
import { CsvRow, parseCsv } from './nflverse';
import { AvailabilityStatus, fuzzyMatchName } from './availability';
import { parseEspnInjuries } from './nhl_data';
import { gradeActual } from '../model/nhl_engine';
import {
  NbaPlayerSnapshot, NbaPosGroup, NbaCounts, NbaLedgerRow, NbaBoxLine, NBA_MARKETS, zeroCounts
} from '../types/nba';

export interface NbaBoxRow {
  gameId: string;
  date: string; // YYYY-MM-DD
  season: number;
  playerId: number;
  name: string;
  team: string;
  opp: string;
  home: boolean;
  minutes: number;
  dnp: boolean;
  reason: string;
  pos: string;
  counts: NbaCounts;
}

const num = (x: unknown): number => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

export function positionGroup(abbr: string | undefined): NbaPosGroup | null {
  const a = String(abbr || '').toUpperCase();
  if (a === 'G' || a === 'PG' || a === 'SG') return 'G';
  if (a === 'F' || a === 'SF' || a === 'PF') return 'F';
  if (a === 'C') return 'C';
  return null;
}

/** Regular-season rows only (season_type 2). */
export function parseNbaBox(csv: string | CsvRow[]): NbaBoxRow[] {
  const rows = typeof csv === 'string' ? parseCsv(csv) : csv;
  const out: NbaBoxRow[] = [];
  for (const r of rows) {
    if (String(r.season_type) !== '2') continue;
    const id = num(r.athlete_id);
    if (!id || !r.game_id) continue;
    const dnpFlag = String(r.did_not_play).toLowerCase() === 'true';
    const minutes = num(r.minutes);
    out.push({
      gameId: String(r.game_id), date: String(r.game_date).slice(0, 10), season: num(r.season), playerId: id,
      name: String(r.athlete_display_name || ''), team: String(r.team_abbreviation || ''), opp: String(r.opponent_team_abbreviation || ''),
      home: String(r.home_away) === 'home', minutes, dnp: dnpFlag || !(minutes > 0), reason: String(r.reason || ''),
      pos: String(r.athlete_position_abbreviation || ''),
      counts: { pts: num(r.points), reb: num(r.rebounds), ast: num(r.assists), tpm: num(r.three_point_field_goals_made), pra: num(r.points) + num(r.rebounds) + num(r.assists), stl: num(r.steals), blk: num(r.blocks) }
    });
  }
  return out;
}

/** Season label = ENDING year: Oct-Dec belong to the next label (2026-10-26 -> 2027). */
export function nbaSeasonFor(date: string): number {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7));
  return m >= 10 ? y + 1 : y;
}

export interface NbaState {
  players: NbaPlayerSnapshot[];
  /** one row per team per played game: that team as the DEFENDER and what it allowed */
  teamGames: { team: string; allowed: NbaCounts }[];
  lastDate: string | null;
  gamesPlayed: number;
  /** average minutes (shrunk the same way the model's season average is), by player name, for the absence feature */
  avgMinByName: Record<string, number>;
}

const zero = zeroCounts;

/**
 * Build the pre-game snapshots from the current-season rows and last season's rows.
 * A player is on the board only if he appears in the CURRENT season's box scores (played or DNP), because that is the
 * only evidence of his team; his team is the one in his most recent current-season row.
 */
export function buildNbaState(current: NbaBoxRow[], prior: NbaBoxRow[]): NbaState {
  const cur = [...current].sort((a, b) => (a.date === b.date ? (a.gameId < b.gameId ? -1 : 1) : a.date < b.date ? -1 : 1));
  const pri = prior;

  const priorAgg = new Map<number, { gp: number; min: number; c: NbaCounts; pos: Record<string, number>; lastTeam: string; lastKey: string }>();
  for (const r of pri) {
    const e = priorAgg.get(r.playerId) ?? { gp: 0, min: 0, c: zero(), pos: {}, lastTeam: '', lastKey: '' };
    const key = r.date + '|' + r.gameId;
    if (key > e.lastKey) { e.lastKey = key; e.lastTeam = r.team; }
    if (r.pos) e.pos[r.pos] = (e.pos[r.pos] || 0) + 1;
    if (!r.dnp) { e.gp++; e.min += r.minutes; for (const m of NBA_MARKETS) e.c[m] += r.counts[m]; }
    priorAgg.set(r.playerId, e);
  }

  const by = new Map<number, NbaBoxRow[]>();
  for (const r of cur) { const a = by.get(r.playerId) ?? []; a.push(r); by.set(r.playerId, a); }

  const players: NbaPlayerSnapshot[] = [];
  const avgMinByName: Record<string, number> = {};
  for (const [id, rs] of by) {
    const played = rs.filter(r => !r.dnp);
    const last = rs[rs.length - 1];
    const pa = priorAgg.get(id);
    const posVotes: Record<string, number> = { ...(pa?.pos ?? {}) };
    for (const r of rs) if (r.pos) posVotes[r.pos] = (posVotes[r.pos] || 0) + 1;
    const grouped: Record<string, number> = {};
    for (const [k, v] of Object.entries(posVotes)) { const g = positionGroup(k); if (g) grouped[g] = (grouped[g] || 0) + v; }
    const pos = (Object.entries(grouped).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'F') as NbaPosGroup;
    const cum = zero(); let cumMin = 0;
    for (const r of played) { cumMin += r.minutes; for (const m of NBA_MARKETS) cum[m] += r.counts[m]; }
    const snap: NbaPlayerSnapshot = {
      playerId: id, name: last.name, team: last.team, pos, prevTeam: pa?.lastTeam || undefined, gp: played.length, cumMin, cum,
      priorGp: pa?.gp ?? 0, priorMin: pa?.min ?? 0, prior: pa?.c ?? zero(),
      recentMinutes: played.slice(-5).map(r => r.minutes),
      recentLogs: played.slice(-10).map(r => ({ date: r.date, minutes: r.minutes, counts: r.counts }))
    };
    players.push(snap);
    const priorAvg = snap.priorGp > 0 ? snap.priorMin / snap.priorGp : 0;
    avgMinByName[snap.name] = snap.gp + snap.priorGp > 0 ? (snap.cumMin + 8 * priorAvg) / (snap.gp + 8) : 0;
  }

  // team-games as defender: group played rows by game, sum each side's production
  const games = new Map<string, Map<string, NbaCounts>>();
  let gamesPlayed = 0; let lastDate: string | null = null;
  for (const r of cur) {
    if (r.dnp) continue;
    if (!lastDate || r.date > lastDate) lastDate = r.date;
    const g = games.get(r.gameId) ?? new Map<string, NbaCounts>();
    const t = g.get(r.team) ?? zero();
    for (const m of NBA_MARKETS) t[m] += r.counts[m];
    g.set(r.team, t); games.set(r.gameId, g);
  }
  const teamGames: NbaState['teamGames'] = [];
  for (const g of games.values()) {
    if (g.size !== 2) continue;
    gamesPlayed++;
    const [a, b] = Array.from(g.entries());
    teamGames.push({ team: a[0], allowed: b[1] }, { team: b[0], allowed: a[1] });
  }
  return { players, teamGames, lastDate, gamesPlayed, avgMinByName };
}

/* ------------------------------ schedule (ESPN) ------------------------------ */

export interface NbaGame {
  gameId: string;
  date: string;
  home: string;
  away: string;
  state: 'pre' | 'in' | 'post' | string;
  completed: boolean;
  postponed: boolean;
  label: string;
}

/** ESPN site API scoreboard: events[].competitions[0].competitors[{homeAway, team.abbreviation}], status.type.{state,completed,name}. */
export function parseEspnNbaScoreboard(json: any): NbaGame[] {
  const out: NbaGame[] = [];
  for (const ev of json?.events || []) {
    const comp = ev?.competitions?.[0];
    const cs: any[] = comp?.competitors || [];
    const home = cs.find(c => c?.homeAway === 'home')?.team?.abbreviation;
    const away = cs.find(c => c?.homeAway === 'away')?.team?.abbreviation;
    if (!ev?.id || !home || !away) continue;
    const st = ev?.status?.type || comp?.status?.type || {};
    const name = String(st.name || '');
    out.push({
      gameId: String(ev.id), date: String(ev.date || comp?.date || '').slice(0, 10), home, away, state: String(st.state || 'pre'),
      completed: !!st.completed, postponed: /postponed|canceled|cancelled/i.test(name + ' ' + (st.description || '')),
      label: `${away} @ ${home}`
    });
  }
  return out;
}

/* ------------------------------ availability ------------------------------ */

export { parseEspnInjuries as parseEspnNbaInjuries };

export interface NbaInjury { name: string; status: AvailabilityStatus; detail: string }

/** null feed => UNKNOWN for everyone (cannot qualify). Listed => the mapped status; unlisted => ACTIVE. */
export function applyNbaInjuries(players: NbaPlayerSnapshot[], injuries: NbaInjury[] | null): NbaPlayerSnapshot[] {
  return players.map(p => {
    if (injuries === null) return { ...p, availability: 'UNKNOWN' as AvailabilityStatus, availabilityNote: 'No injury feed' };
    const hit = injuries.find(i => fuzzyMatchName(p.name, i.name));
    return { ...p, availability: (hit ? hit.status : 'ACTIVE') as AvailabilityStatus, availabilityNote: hit?.detail };
  });
}

/* --------------------------------- grading --------------------------------- */

export function boxLinesFor(rows: NbaBoxRow[], dates: string[]): NbaBoxLine[] {
  const want = new Set(dates);
  return rows.filter(r => want.has(r.date)).map(r => ({
    gameId: r.gameId, date: r.date, playerId: r.playerId, minutes: r.minutes, dnp: r.dnp, actual: r.counts
  }));
}

/**
 * Grade pending ledger rows from real box lines. A player with no minutes is a VOID (never a zero); a game that never
 * shows up in the box data more than `staleDays` after its date is a VOID too (postponed / cancelled), otherwise pending.
 */
export function gradeNbaLedger(
  rows: NbaLedgerRow[], lines: NbaBoxLine[], today: string, staleDays = 7
): { rows: NbaLedgerRow[]; graded: number; pending: number; voided: number } {
  const byGame = new Map<string, Map<number, NbaBoxLine>>();
  for (const l of lines) {
    const m = byGame.get(l.gameId) ?? new Map<number, NbaBoxLine>();
    m.set(l.playerId, l);
    byGame.set(l.gameId, m);
  }
  let graded = 0, pending = 0, voided = 0;
  const age = (d: string) => Math.floor((Date.parse(today) - Date.parse(d)) / 86400000);
  const out = rows.map(r => {
    if (r.result !== null) return r;
    const g = byGame.get(r.gameId);
    if (!g) {
      if (age(r.date) > staleDays) { voided++; return { ...r, result: 'VOID' as const, voidReason: 'Game never appeared in box scores (postponed / cancelled?)' }; }
      pending++; return r;
    }
    const l = g.get(r.playerId);
    if (!l || l.dnp || !(l.minutes > 0)) { voided++; return { ...r, result: 'VOID' as const, voidReason: 'Did not play' }; }
    graded++;
    const actual = l.actual[r.market];
    return { ...r, actual, result: gradeActual(actual, r.line) };
  });
  return { rows: out, graded, pending, voided };
}

/* ------------------------------ browser fetchers ------------------------------ */

export async function fetchNbaState(date: string): Promise<(NbaState & { season: number; priorLoaded: boolean }) | null> {
  try {
    const res = await fetch(`/api/nba/state?date=${date}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) { console.warn('NBA state fetch failed', e); return null; }
}

export async function fetchNbaSchedule(date: string): Promise<NbaGame[] | null> {
  try {
    const res = await fetch(`/api/nba/schedule?date=${date}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseEspnNbaScoreboard(await res.json());
  } catch (e) { console.warn('NBA schedule fetch failed', e); return null; }
}

/** null = feed failed (everyone UNKNOWN, nothing can qualify). */
export async function fetchNbaInjuries(): Promise<NbaInjury[] | null> {
  try {
    const res = await fetch('/api/nba/injuries');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseEspnInjuries(await res.json()) as NbaInjury[];
  } catch (e) { console.warn('NBA injuries fetch failed', e); return null; }
}

export async function fetchNbaActuals(dates: string[]): Promise<NbaBoxLine[] | null> {
  try {
    const res = await fetch(`/api/nba/actuals?dates=${dates.join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).lines as NbaBoxLine[];
  } catch (e) { console.warn('NBA actuals fetch failed', e); return null; }
}
