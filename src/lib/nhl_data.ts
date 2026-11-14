/**
 * NHL live-data layer. The server (server.ts) only relays raw JSON from the
 * official api-web.nhle.com / api.nhle.com and ESPN; ALL parsing lives here so
 * it is unit-tested against fixtures. Every parser is defensive: a missing
 * field degrades the row to ESTIMATED / UNKNOWN, never to a made-up number.
 */
import {
  NhlPlayerSnapshot,
  NhlGameMatchup,
  NhlLedgerRow,
  NhlTeamFactors
} from '../types/nhl';
import { AvailabilityStatus, fuzzyMatchName, normalizeName } from './availability';
import { classifyInputs, buildTeamFactors, TeamRates, gradeActual } from '../model/nhl_engine';

/* ------------------------------------------------------------------ */
/* Teams / seasons                                                     */
/* ------------------------------------------------------------------ */

/** ESPN / UI abbrev -> NHL API tricode */
const NHL_ABBREV: Record<string, string> = {
  SJ: 'SJS', SJS: 'SJS', LA: 'LAK', LAK: 'LAK', TB: 'TBL', TBL: 'TBL',
  NJ: 'NJD', NJD: 'NJD', WAS: 'WSH', WSH: 'WSH', MON: 'MTL', MTL: 'MTL',
  VEG: 'VGK', VGK: 'VGK', LV: 'VGK', UTAH: 'UTA', UTA: 'UTA',
  ANH: 'ANA', ANA: 'ANA', CLS: 'CBJ', CBJ: 'CBJ', CAL: 'CGY', CGY: 'CGY',
  NAS: 'NSH', NSH: 'NSH', WIN: 'WPG', WPG: 'WPG', PHO: 'UTA', ARI: 'UTA'
};

export function normalizeNhlTeam(code: string): string {
  const u = (code || '').toUpperCase();
  return NHL_ABBREV[u] || u;
}

/** "20262027" for any date from Sep 2026 to Aug 2027 (the season rolls over in September). */
export function nhlSeasonFor(dateIso: string): { season: string; prev: string } {
  const [y, m] = dateIso.split('-').map(Number);
  const start = m >= 9 ? y : y - 1;
  return { season: `${start}${start + 1}`, prev: `${start - 1}${start}` };
}

/* ------------------------------------------------------------------ */
/* Skaters                                                             */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};

const nameOf = (p: any): string =>
  `${p?.firstName?.default ?? p?.firstName ?? ''} ${p?.lastName?.default ?? p?.lastName ?? ''}`.trim();

/** "mm:ss" or seconds -> minutes */
export function toiMinutes(v: unknown): number {
  if (typeof v === 'number') return v > 60 ? v / 60 : v; // club-stats gives seconds
  if (typeof v === 'string' && v.includes(':')) {
    const [m, s] = v.split(':').map(Number);
    return (m || 0) + (s || 0) / 60;
  }
  return 0;
}

function toiSeconds(v: unknown): number {
  if (typeof v === 'string' && v.includes(':')) {
    const [m, s] = v.split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
  }
  return typeof v === 'number' ? v : 0;
}

/**
 * Which skaters to load game logs for: highest ice time first (current season,
 * falling back to last season for players with no games yet).
 */
export function selectTopSkaters(rawTeam: { roster?: any; stats?: any; prior?: any }, n = 16): number[] {
  const byId = (arr: any[] | undefined) => {
    const m: Record<number, any> = {};
    for (const s of arr || []) if (s?.playerId !== undefined) m[s.playerId] = s;
    return m;
  };
  const cur = byId(rawTeam.stats?.skaters);
  const pri = byId(rawTeam.prior?.skaters);
  const roster = [...(rawTeam.roster?.forwards || []), ...(rawTeam.roster?.defensemen || [])];
  return roster
    .map((p: any) => {
      const t = toiMinutes(cur[p.id]?.avgTimeOnIcePerGame) || toiMinutes(pri[p.id]?.avgTimeOnIcePerGame) * 0.9;
      return { id: p.id as number, t };
    })
    .filter(x => x.id !== undefined)
    .sort((a, b) => b.t - a.t)
    .slice(0, n)
    .map(x => x.id);
}

export interface NhlTeamPayload {
  team: string;
  roster?: any;
  stats?: any;
  prior?: any;
  /** player id -> raw game-log JSON */
  logs?: Record<string, any>;
}

/** Build skater snapshots for one team from the raw relayed payload. */
export function parseNhlTeamPayload(raw: NhlTeamPayload, limit = 16): NhlPlayerSnapshot[] {
  if (!raw?.roster) return [];
  const cur: Record<number, any> = {};
  for (const s of raw.stats?.skaters || []) cur[s.playerId] = s;
  const pri: Record<number, any> = {};
  for (const s of raw.prior?.skaters || []) pri[s.playerId] = s;
  const live = Object.keys(cur).length > 0 || Object.keys(pri).length > 0;
  const team = normalizeNhlTeam(raw.team);

  const mk = (p: any, pos: 'F' | 'D'): NhlPlayerSnapshot | null => {
    const id = p?.id;
    if (id === undefined) return null;
    const c = cur[id];
    const q = pri[id];
    const log: any[] = raw.logs?.[String(id)]?.gameLog || [];
    const recentShots = log.slice(0, 10).map(g => num(g.shots));
    const recentPoints = log.slice(0, 10).map(g => (g.points !== undefined ? num(g.points) : num(g.goals) + num(g.assists)));
    const toi = toiMinutes(c?.avgTimeOnIcePerGame) || toiMinutes(q?.avgTimeOnIcePerGame);
    const snap: NhlPlayerSnapshot = {
      playerId: id,
      name: nameOf(p),
      team,
      pos,
      toiAvg: Math.round(toi * 10) / 10,
      gp: num(c?.gamesPlayed),
      shots: num(c?.shots),
      points: c ? (c.points !== undefined ? num(c.points) : num(c.goals) + num(c.assists)) : q ? 0 : null,
      priorGp: num(q?.gamesPlayed),
      priorShots: num(q?.shots),
      priorPoints: q ? (q.points !== undefined ? num(q.points) : num(q.goals) + num(q.assists)) : null,
      recentShots,
      recentPoints
    };
    // a player with no stats at all has no points data either
    if (!c && !q) snap.points = null;
    snap.inputsSource = classifyInputs(snap, live);
    return snap;
  };

  const all: NhlPlayerSnapshot[] = [];
  for (const p of raw.roster.forwards || []) { const s = mk(p, 'F'); if (s) all.push(s); }
  for (const p of raw.roster.defensemen || []) { const s = mk(p, 'D'); if (s) all.push(s); }
  return all.sort((a, b) => b.toiAvg - a.toiAvg).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Team opponent table                                                 */
/* ------------------------------------------------------------------ */

const keyName = (s: string) => normalizeName(String(s || '')).replace(/\s+/g, ' ');

/**
 * standings/now supplies tricode, GP and goals against; the stats REST team
 * summary supplies shots against per game (joined on the full team name).
 */
export function parseNhlTeamTable(standings: any, summary: any): Record<string, TeamRates> {
  const shotsByName: Record<string, number> = {};
  for (const t of summary?.data || []) {
    const v = num(t.shotsAgainstPerGame);
    if (t.teamFullName && v > 0) shotsByName[keyName(t.teamFullName)] = v;
  }
  const out: Record<string, TeamRates> = {};
  for (const t of standings?.standings || []) {
    const abbr = t?.teamAbbrev?.default ?? t?.teamAbbrev;
    const gp = num(t.gamesPlayed);
    if (!abbr || gp <= 0) continue;
    const full = keyName(t?.teamName?.default ?? '');
    out[normalizeNhlTeam(String(abbr))] = {
      gp,
      goalsAgainstPerGame: t.goalAgainst !== undefined ? num(t.goalAgainst) / gp : null,
      shotsAgainstPerGame: shotsByName[full] ?? null
    };
  }
  return out;
}

export function parseNhlFactors(standings: any, summary: any): Record<string, NhlTeamFactors> {
  return buildTeamFactors(parseNhlTeamTable(standings, summary));
}

/* ------------------------------------------------------------------ */
/* Injuries (ESPN)                                                     */
/* ------------------------------------------------------------------ */

export interface NhlInjury {
  name: string;
  status: AvailabilityStatus;
  detail: string;
}

export function mapEspnStatus(s: string): AvailabilityStatus {
  const t = (s || '').toLowerCase();
  if (/injured reserve|\bir\b|ltir/.test(t)) return 'IR';
  if (/\bout\b|suspend/.test(t)) return 'OUT';
  if (/doubtful/.test(t)) return 'DOUBTFUL';
  if (/day|question|probable|game.time/.test(t)) return 'QUESTIONABLE';
  return 'QUESTIONABLE'; // listed at all = not a clean bill of health
}

export function parseEspnInjuries(json: any): NhlInjury[] {
  const out: NhlInjury[] = [];
  for (const team of json?.injuries || []) {
    for (const inj of team?.injuries || []) {
      const name = inj?.athlete?.displayName || inj?.athlete?.fullName;
      if (!name) continue;
      out.push({
        name,
        status: mapEspnStatus(inj?.status || inj?.type?.description || ''),
        detail: String(inj?.shortComment || inj?.type?.description || inj?.status || '')
      });
    }
  }
  return out;
}

/**
 * Attach availability. With a loaded feed: listed -> that status, not listed ->
 * ACTIVE. Feed failed -> UNKNOWN, and the gate will refuse to qualify the row.
 */
export function applyInjuries(
  players: NhlPlayerSnapshot[],
  injuries: NhlInjury[] | null
): NhlPlayerSnapshot[] {
  return players.map(p => {
    if (injuries === null) return { ...p, availability: 'UNKNOWN' as AvailabilityStatus };
    const hit = injuries.find(i => fuzzyMatchName(p.name, i.name));
    return { ...p, availability: (hit ? hit.status : 'ACTIVE') as AvailabilityStatus };
  });
}

/* ------------------------------------------------------------------ */
/* Box scores + grading                                                */
/* ------------------------------------------------------------------ */

export interface NhlBoxResult {
  final: boolean;
  voided: boolean;
  players: Record<string, { sog: number; points: number; toiSec: number }>;
}

export function parseNhlBoxscore(box: any): NhlBoxResult {
  const state = String(box?.gameState || '').toUpperCase();
  const sched = String(box?.gameScheduleState || '').toUpperCase();
  const voided = ['PPD', 'CNCL', 'SUSP'].includes(sched);
  const players: NhlBoxResult['players'] = {};
  for (const side of ['awayTeam', 'homeTeam'] as const) {
    const grp = box?.playerByGameStats?.[side] || {};
    for (const p of [...(grp.forwards || []), ...(grp.defense || [])]) {
      if (p?.playerId === undefined) continue;
      players[String(p.playerId)] = {
        sog: num(p.sog),
        points: p.points !== undefined ? num(p.points) : num(p.goals) + num(p.assists),
        toiSec: toiSeconds(p.toi)
      };
    }
  }
  return { final: (state === 'OFF' || state === 'FINAL') && !voided, voided, players };
}

export function gradeNhlLedger(
  rows: NhlLedgerRow[],
  boxes: Record<string, NhlBoxResult | undefined>
): { rows: NhlLedgerRow[]; graded: number; pending: number; voided: number } {
  let graded = 0, pending = 0, voided = 0;
  const out = rows.map(r => {
    if (r.result !== null || r.demo) return r;
    const box = boxes[String(r.gameId)];
    if (!box) { pending++; return r; }
    if (box.voided) {
      voided++;
      return {
        ...r,
        result: 'VOID' as const,
        voidReason: 'Game postponed / cancelled',
        predictionHit: null,
        analysisReason: 'VOID: Game postponed or cancelled.'
      };
    }
    if (!box.final) { pending++; return r; }
    const p = box.players[String(r.playerId)];
    // not dressed (scratched) -> book rules void the prop
    if (!p || p.toiSec <= 0) {
      voided++;
      return {
        ...r,
        result: 'VOID' as const,
        voidReason: 'Did not play',
        predictionHit: null,
        analysisReason: `VOID: ${r.playerName} did not dress / logged 0 TOI.`
      };
    }
    graded++;
    const actual = r.market === 'sog' ? p.sog : p.points;
    const result = gradeActual(actual, r.line);
    const modelLean: 'OVER' | 'UNDER' = r.modelLean ?? (r.side ? (r.side.toUpperCase() as 'OVER' | 'UNDER') : (r.modelMu >= r.line ? 'OVER' : 'UNDER'));
    const predictionHit = result === 'PUSH' ? null : (result === modelLean);
    const diff = actual - r.line;
    const mkt = r.market === 'sog' ? 'SOG' : 'PTS';
    const toiMin = Math.floor(p.toiSec / 60);
    const toiSec = p.toiSec % 60;
    const toi = `${toiMin}:${toiSec < 10 ? '0' : ''}${toiSec}`;

    let analysisReason = '';
    if (result === 'PUSH') {
      analysisReason = `PUSH: Actual (${actual} ${mkt}) landed exactly on the line of ${r.line} in ${toi} TOI (Model μ ${r.modelMu.toFixed(2)}).`;
    } else if (predictionHit) {
      if (modelLean === 'OVER') {
        analysisReason = `WON (OVER): Model projected ${r.modelMu.toFixed(2)} vs line ${r.line}. Cleared by +${diff.toFixed(1)} (${actual} in ${toi} TOI). Top-six ice time and offensive volume supported over.`;
      } else {
        analysisReason = `WON (UNDER): Model projected ${r.modelMu.toFixed(2)} vs line ${r.line}. Stayed under by ${Math.abs(diff).toFixed(1)} (${actual} in ${toi} TOI). Opponent shot suppression kept volume contained.`;
      }
    } else {
      if (modelLean === 'OVER') {
        const toiNote = p.toiSec < 840 ? ` Limited ice time (${toi}) capped opportunities.` : ` Low shooting percentage/conversion despite ${toi} TOI.`;
        analysisReason = `LOST (OVER): Model projected ${r.modelMu.toFixed(2)} vs line ${r.line}. Short by ${Math.abs(diff).toFixed(1)} (${actual} in ${toi} TOI).${toiNote}`;
      } else {
        analysisReason = `LOST (UNDER): Model projected ${r.modelMu.toFixed(2)} vs line ${r.line}. Exceeded by +${diff.toFixed(1)} (${actual} in ${toi} TOI). Heavy power play time or high-event pace led to surge.`;
      }
    }

    return {
      ...r,
      actual,
      result,
      modelLean,
      predictionHit,
      analysisReason,
      timeOnIce: toi
    };
  });
  return { rows: out, graded, pending, voided };
}

/* ------------------------------------------------------------------ */
/* Client fetchers                                                     */
/* ------------------------------------------------------------------ */

export async function fetchNhlSchedule(dateStr: string): Promise<NhlGameMatchup[]> {
  try {
    const res = await fetch(`/api/nhl/schedule?date=${dateStr}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.games || []).map((g: any) => ({
      gameId: g.gameId,
      startTimeUtc: g.startTimeUtc,
      awayTeam: normalizeNhlTeam(g.awayTeam),
      homeTeam: normalizeNhlTeam(g.homeTeam),
      venue: g.venue || ''
    }));
  } catch (e) {
    console.warn('NHL schedule fetch failed', e);
    return [];
  }
}

export async function fetchNhlTeam(team: string, date: string): Promise<NhlPlayerSnapshot[]> {
  try {
    const res = await fetch(`/api/nhl/team/${normalizeNhlTeam(team)}?date=${date}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseNhlTeamPayload(await res.json());
  } catch (e) {
    console.warn('NHL team fetch failed for', team, e);
    return [];
  }
}

export async function fetchNhlFactors(): Promise<Record<string, NhlTeamFactors> | null> {
  try {
    const res = await fetch('/api/nhl/teams');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const f = parseNhlFactors(d.standings, d.summary);
    return Object.keys(f).length ? f : null;
  } catch (e) {
    console.warn('NHL team table fetch failed', e);
    return null;
  }
}

export async function fetchNhlInjuries(): Promise<NhlInjury[] | null> {
  try {
    const res = await fetch('/api/nhl/injuries');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = parseEspnInjuries(await res.json());
    return list;
  } catch (e) {
    console.warn('NHL injuries fetch failed', e);
    return null;
  }
}

export async function fetchNhlBoxes(gameIds: number[]): Promise<Record<string, NhlBoxResult> | null> {
  if (!gameIds.length) return {};
  try {
    const res = await fetch(`/api/nhl/boxscores?gameIds=${gameIds.join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out: Record<string, NhlBoxResult> = {};
    for (const [id, v] of Object.entries<any>(data.games || {})) if (v) out[id] = parseNhlBoxscore(v);
    return out;
  } catch (e) {
    console.warn('NHL box fetch failed', e);
    return null;
  }
}
